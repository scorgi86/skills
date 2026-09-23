"use strict";

const fs = require("fs");

const path = require("path");

const { buildOwnershipGraph, validateOwnershipGraph } = require("../../../shared/ownership/src/ownership_graph.js");

const { buildStageSummary } = require("../../../shared/output/src/summary/stage_summary.js");
const { createStageFacts } = require("../../../shared/output/src/stage_facts.js");
const { normalizeBudgets } = require("../../../shared/output/src/summary/budget.js");

const { extractTransition } = require("../../../shared/dto/src/extract_stage_transition.js");

const { runAstBatch } = require("../../../shared/ast/src/batch/batch.js");

const { runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");

const { normalizeCapabilities } = require("../../../shared/dto/src/capability_contract.js");

const { evaluateStage2Coverage } = require("./coverage_gate.js");

const { applySafeBudget } = require("../../../shared/output/src/measure_context.js");
const { transitionForRequest } = require("../../../state/src/session/inventory_session.js");
const { SourceSnapshotStore } = require("../../../shared/evidence/src/source_snapshot.js");
const { validateSourceAnchor } = require("../../../shared/evidence/src/canonicalization/source_anchor.js");
const crypto = require("node:crypto");

const DEFAULT_STAGE2_BUDGET = 96 * 1024;

function readOwnershipGraphArtifact(file) {
  if (!file) return null;
  const data = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return data.ownershipGraph || data;
}

function advanceOwnershipGraph(prior, request = {}) {
  if (!prior && !request.ownershipGraph) return null;
  const base = prior || request.ownershipGraph;
  const nodeId = (node) => String(node.id || String(node.entity).trim().replace(/\s+/g, " ").toLowerCase());
  const nodes = new Map((base.nodes || base.seedNodes || []).map((node) => [nodeId(node), node]));
  for (const node of request.ownershipGraphNodes || []) if (!nodes.has(nodeId(node))) nodes.set(nodeId(node), node);
  const edgeId = (edge) => String(edge.id || `${edge.from}:${edge.relation}:${edge.to}`);
  const edges = new Map((base.edges || []).map((edge) => [edgeId(edge), edge]));
  // A later source-confirmed observation replaces the earlier candidate edge.
  for (const edge of request.ownershipGraphCandidates || []) edges.set(edgeId(edge), edge);
  return buildOwnershipGraph({ ...base, maxOrder: request.ownershipGraphMaxOrder ?? base.maxOrder, nodes: [...nodes.values()], edges: [...edges.values()] });
}

function confirmedOwnershipDelta(discovery) {
  const edges = discovery?.edges.filter(edge => edge.status === "confirmed") || [];
  const ids = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  return { edges, nodes: (discovery?.nodes || []).filter(node => ids.has(node.id)) };
}

async function runStage2(request, dependencies = {}, context = null) {
  if (Number(request && request.stage) !== 2) throw new Error("stage2_runner accepts only stage: 2");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  const evaluateCoverage = dependencies.evaluateStage2Coverage || evaluateStage2Coverage;
  const finalizeBudget = dependencies.applySafeBudget || applySafeBudget;
  const prepareCanonicalFacts = dependencies.prepareFacts || require("../../../shared/artifacts/src/canonical/facts.js").prepareFacts;
  const budgets = normalizeBudgets(request, { factsBytes: DEFAULT_STAGE2_BUDGET, summaryBytes: 24 * 1024, evidenceBytes: 48 * 1024, reportBytes: 64 * 1024 });
  const previous = transitionForRequest(context, request) || JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const transition = extractTransition(previous);
    const priorScope = previous.summary?.repositoryScope;
    const repositoryScope = request.repositoryScope || priorScope;
  const sourceSnapshots = dependencies.sourceSnapshots || new SourceSnapshotStore();
  if(request.searchFromStage1===true&&request.dictionary!==undefined)throw new Error("Automatic Stage 2 conflicts with manual dictionary rows");
  const priorBoundaries = [...(previous.facts || []).filter((item) => item.kind === "boundary").map(({ kind, boundaryKind, ...item }) => ({ ...item, kind: boundaryKind })), ...(request.boundaryCandidates || [])];
  const priorGraph = readOwnershipGraphArtifact(request.ownershipGraphArtifact) || request.ownershipGraph || null;
  const exhausted = request.searchFromStage1 === true && request.frontierExhausted === true;
  const ast = await (dependencies.runAstBatch || runAstBatch)(request.ast || {});
  const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({ ...(request.evidence || { checks: [] }), retainAllMatches: true }, { sourceSnapshots });
  const discovery = request.searchFromStage1 === true && !exhausted
    ? require("../../step-1/src/owner_discovery.js").discoverOwnerCandidates(ast, { ...request, ownerDiscovery: { mode: "delta" } }, previous, sourceSnapshots)
    : null;
  const boundaryDiscovery = request.searchFromStage1 === true
    ? require("./boundary_discovery.js").discoverBoundaries(ast, request.boundaryDiscovery, sourceSnapshots)
    : { status: "complete", reasons: [], boundaries: [] };
  const boundaries = require("./boundary_discovery.js").mergeBoundaries(priorBoundaries, boundaryDiscovery.boundaries);
  const confirmedDelta = confirmedOwnershipDelta(discovery);
  const ownershipGraph = discovery ? advanceOwnershipGraph(priorGraph, { ownershipGraphMaxOrder: request.ownershipGraphMaxOrder,
    ownershipGraphNodes: confirmedDelta.nodes, ownershipGraphCandidates: confirmedDelta.edges }) : advanceOwnershipGraph(null, request);
  const astResults = Array.isArray(ast.results) ? ast.results : [];
  let valueFlowResult=null;
  if(request.valueFlow?.enabled===true){
    const relationRows=astResults.filter(row=>String(row.id).startsWith("value-flow-")).flatMap(row=>row.details||[]);
    const valueFlow=require("../../../shared/value-flow/src/value_flow.js"),edges=valueFlow.buildValueFlow(relationRows,request.valueFlow.roots,repositoryScope);
    valueFlowResult={edges,obligations:valueFlow.buildObligationTree(edges)};
  }
  const quality = {
      astFilesParsedOnce: Object.values(ast.stats.parseCounts || {}).every((count) => count === 1),
      astPlanCompiledBeforeParse: Boolean(ast.plan && ast.plan.compiledBeforeParse),
      astLateQueries: ast.plan ? ast.plan.lateQueries : null,
      astGroupsScanned: astResults.reduce((sum, result) => sum + result.coverage.groupsScanned, 0),
      astGroupsMatched: astResults.reduce((sum, result) => sum + result.coverage.groupsMatched, 0),
      astDetailsRequested: astResults.reduce((sum, result) => sum + (result.coverage.detailsRequested || 0), 0),
      astDetailsReturned: astResults.reduce((sum, result) => sum + (result.coverage.detailsReturned || 0), 0),
      astDetailsSuppressed: astResults.reduce((sum, result) => sum + (result.coverage.detailsSuppressed || 0), 0),
      astDetailEvidenceSuppressed: astResults.reduce((sum, result) => sum + (result.coverage.detailEvidenceSuppressed || 0), 0),
      sourceChecks: sourceEvidence.checks.length,
      emptyChecksAreCandidates: sourceEvidence.checks.filter((check) => check.status === "candidate-empty").length,
  };
  const facts = createStageFacts({ stage: 2, status: ast.status === "partial" ? "partial" : "candidate", transition, ast, sourceEvidence, quality, budgets, capabilities: normalizeCapabilities(request.capabilities || []) });
  if(valueFlowResult){facts.valueFlowEdges=valueFlowResult.edges;facts.pathObligations=valueFlowResult.obligations;facts.canonicalEvidence=[...(facts.canonicalEvidence||[]),...facts.valueFlowEdges.filter(row=>row.status==="source-confirmed").map(row=>({id:`${row.id}:source`,status:"source-confirmed",repository:row.repository,file:row.file,line:row.line,endLine:row.endLine,sourceHash:row.sourceHash,sourceFragment:row.sourceFragment,confirmation:{status:"source-confirmed",evidenceRefs:[row.id],sourceHash:row.sourceHash,line:row.line,endLine:row.endLine,sourceFragment:row.sourceFragment}}))];facts.summary={...(facts.summary||{}),valueFlow:{edges:facts.valueFlowEdges.length,obligations:facts.pathObligations.length,unresolved:facts.valueFlowEdges.filter(row=>row.status==="unresolved").length}};}
  facts.repositoryScope = repositoryScope;
    facts.repository = request.repository;
    facts.exclusions = request.exclusions;
    facts.runtime.projection = request.projection || {};
  facts.runtime.source = request.source || null;
  facts.runtime.cache = request.cache || { enabled: false, mode: "not-configured" };
  facts.runtime.report = request.report || {};
  facts.runtime.autoStage2 = request.searchFromStage1 === true;
  facts.runtime.frontierExhausted = exhausted;
  facts.runtime.ownershipFrontier = request.ownershipFrontier || [];
  facts.boundaries = boundaries;
  facts.boundaryDiscovery = boundaryDiscovery;
  facts.ownershipGraph = ownershipGraph;
  if (discovery) {
    facts.ownership = { groups: discovery.groups };
    facts.ownerDiscovery = { generatedIds: discovery.groups.map(row => row.id), unresolved: discovery.unresolved,
      exhaustedSeeds: discovery.exhaustedSeeds, advancedSeeds: discovery.advancedSeeds, limitReachedSeeds: discovery.limitReachedSeeds, reviewDigest: discovery.reviewDigest };
    facts.canonicalEvidence = discovery.evidenceCandidates;
  }
  if (ownershipGraph) facts.quality.ownershipGraph = validateOwnershipGraph(ownershipGraph);
  facts.runtime.boundarySource = "canonical-transition";
  facts.quality.coverageGate = evaluateCoverage(facts, { requirePlan: true });
  if(request.searchFromStage1===true&&boundaryDiscovery.status==="complete"&&facts.quality.coverageGate.ok){
    const groups=new Map();
    for(const boundary of boundaryDiscovery.boundaries){
      const confirmation=boundary.confirmation,snapshot=confirmation?.file&&sourceSnapshots.get(confirmation.file);
      if(confirmation?.status!=="source-confirmed"||!snapshot||!validateSourceAnchor(confirmation,snapshot).ok)continue;
      const evidenceId=`${boundary.id}:dictionary-source`,key=`${boundary.producerRepo}\0${boundary.searchTerms[0]}`;
      const row=groups.get(key)||{producerRepo:boundary.producerRepo,term:boundary.searchTerms[0],consumerRepos:[],searchTerms:[],aliases:[],evidenceRefs:[]};
      row.consumerRepos.push(...boundary.consumerRepos||[]);row.searchTerms.push(...boundary.searchTerms||[]);row.aliases.push(...boundary.aliases||[]);row.evidenceRefs.push(evidenceId);groups.set(key,row);
      facts.canonicalEvidence=[...(facts.canonicalEvidence||[]),{id:evidenceId,status:"source-confirmed",repository:boundary.producerRepo,...confirmation}];
    }
    facts.dictionary=[...groups.values()].map(row=>({...row,id:`dictionary-${crypto.createHash("sha256").update(JSON.stringify([row.producerRepo,row.term])).digest("hex").slice(0,16)}`,name:row.term,status:"confirmed",consumerRepos:[...new Set(row.consumerRepos)].sort(),searchTerms:[...new Set(row.searchTerms)].sort(),aliases:[...new Set(row.aliases)].sort(),evidenceRefs:[...new Set(row.evidenceRefs)].sort()})).sort((a,b)=>a.id.localeCompare(b.id));
  }
  finalizeBudget(facts, budgets.factsBytes, DEFAULT_STAGE2_BUDGET, 8192);
  facts.summary = { ...(facts.summary || {}), frontierStatus: facts.quality.coverageGate.decision?.frontierStatus, boundaryDiscovery: { status: boundaryDiscovery.status, reasons: boundaryDiscovery.reasons, candidates: boundaryDiscovery.boundaries.length } };
  if (!facts.quality.coverageGate.ok) facts.status = "partial";
  if(dependencies.deferCanonicalization)return facts;
  const prepared=prepareCanonicalFacts(facts,{sourceSnapshots});
  if(valueFlowResult&&prepared.evidenceIdMap)prepared.valueFlowEdges=(prepared.valueFlowEdges||[]).map(edge=>({...edge,evidenceRefs:[...new Set((edge.evidenceRefs||[]).flatMap(ref=>prepared.evidenceIdMap[ref]||[]))].sort()}));
  return prepared;
}

function buildStage2Summary(facts, artifact = null) {
  return buildStageSummary(facts, { artifact, projection: facts.runtime && facts.runtime.projection });
}

function parseArgs(argv) {
  const options = { stdout: "full" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--request", "--output", "--pretty", "--debug", "--stdout"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if (arg === "--pretty" || arg === "--debug") options[arg.slice(2)] = true;
    else {
      if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++index];
    }
  }
  if (!options.request) throw new Error("Provide --request <json-file>");
  if (!["full", "summary"].includes(options.stdout)) throw new Error("stdout must be full or summary");
  if (options.stdout === "summary" && !options.output) throw new Error("--stdout summary requires --output so full producer facts remain available");
  return options;
}

module.exports = { DEFAULT_STAGE2_BUDGET, advanceOwnershipGraph, buildStage2Summary, confirmedOwnershipDelta, parseArgs, readOwnershipGraphArtifact, runStage2 };
