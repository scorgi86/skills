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

const { candidatesFromAst, candidatesFromSourceEvidence } = require("../../../shared/evidence/src/canonicalization/candidate_adapters.js");
const { canonicalizeStage2Candidates } = require("../../../shared/evidence/src/canonicalization/canonicalize.js");

const { normalizeCapabilities } = require("../../../shared/dto/src/capability_contract.js");

const { evaluateStage2Coverage } = require("./coverage_gate.js");

const { applySafeBudget } = require("../../../shared/output/src/measure_context.js");

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
  for (const node of request.ownershipGraphNodes || []) nodes.set(nodeId(node), node);
  const edgeId = (edge) => String(edge.id || `${edge.from}:${edge.relation}:${edge.to}`);
  const edges = new Map((base.edges || []).map((edge) => [edgeId(edge), edge]));
  // A later source-confirmed observation replaces the earlier candidate edge.
  for (const edge of request.ownershipGraphCandidates || []) edges.set(edgeId(edge), edge);
  return buildOwnershipGraph({ ...base, maxOrder: request.ownershipGraphMaxOrder ?? base.maxOrder, nodes: [...nodes.values()], edges: [...edges.values()] });
}

function runStage2(request, dependencies = {}) {
  if (Number(request && request.stage) !== 2) throw new Error("stage2_runner accepts only stage: 2");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  const budgets = normalizeBudgets(request, { factsBytes: DEFAULT_STAGE2_BUDGET, summaryBytes: 24 * 1024, evidenceBytes: 48 * 1024, reportBytes: 64 * 1024 });
  const transition = extractTransition(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
    const priorScope = JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8")).summary?.repositoryScope;
    const repositoryScope = request.repositoryScope || priorScope;
  const previous = JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const boundaries = [...(previous.facts || []).filter((item) => item.kind === "boundary").map(({ kind, boundaryKind, ...item }) => ({ ...item, kind: boundaryKind })), ...(request.boundaryCandidates || [])];
  const ownershipGraph = advanceOwnershipGraph(readOwnershipGraphArtifact(request.ownershipGraphArtifact), request);
  const ast = (dependencies.runAstBatch || runAstBatch)(request.ast || {});
  const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({ ...(request.evidence || { checks: [] }), retainAllMatches: true });
  const canonicalized = canonicalizeStage2Candidates([...candidatesFromAst(ast, request.repository || ""), ...candidatesFromSourceEvidence(sourceEvidence, request.repository || "")], {repositoryScope, exclusions: request.exclusions});
  const astResults = Array.isArray(ast.results) ? ast.results : [];
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
  facts.repositoryScope = repositoryScope;
    facts.repository = request.repository;
    facts.exclusions = request.exclusions;
    facts.runtime.projection = request.projection || {};
  facts.runtime.source = request.source || null;
  facts.runtime.cache = request.cache || { enabled: false, mode: "not-configured" };
  facts.runtime.report = request.report || {};
  facts.canonicalEvidence = canonicalized.evidence;
  facts.metrics = canonicalized.metrics;
  facts.boundaries = boundaries;
  facts.ownershipGraph = ownershipGraph;
  if (ownershipGraph) facts.quality.ownershipGraph = validateOwnershipGraph(ownershipGraph);
  facts.runtime.boundarySource = "canonical-transition";
  facts.quality.coverageGate = evaluateStage2Coverage(facts, { requirePlan: true });
  applySafeBudget(facts, budgets.factsBytes, DEFAULT_STAGE2_BUDGET, 8192);
  facts.quality.coverageGate = evaluateStage2Coverage(facts, { requirePlan: true });
  applySafeBudget(facts, budgets.factsBytes, DEFAULT_STAGE2_BUDGET, 8192);
  if (!facts.quality.coverageGate.ok) facts.status = "partial";
  return require("../../../shared/artifacts/src/canonical/facts.js").prepareFacts(facts);
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

module.exports = { DEFAULT_STAGE2_BUDGET, advanceOwnershipGraph, buildStage2Summary, parseArgs, readOwnershipGraphArtifact, runStage2 };
