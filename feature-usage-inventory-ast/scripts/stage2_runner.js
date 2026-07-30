#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { runAstBatch } = require("./ast/batch");
const { extractTransition } = require("./extract_stage_transition");
const { applySafeBudget } = require("./measure_context");
const { runEvidenceChecks } = require("./source_evidence");
const { buildStageSummary, createStageFacts, normalizeBudgets } = require("./stage_facts");
const { normalizeCapabilities } = require("./capability_contract");
const { evaluateStage2Coverage } = require("./coverage_gate");
const { buildOwnershipGraph, validateOwnershipGraph } = require("./ownership_graph");

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
  const boundaryArtifact = request.boundaryArtifact ? JSON.parse(fs.readFileSync(path.resolve(request.boundaryArtifact), "utf8")) : null;
  const boundaries = boundaryArtifact ? (boundaryArtifact.candidates || []) : (request.boundaryCandidates || []);
  const ownershipGraph = advanceOwnershipGraph(readOwnershipGraphArtifact(request.ownershipGraphArtifact), request);
  const ast = (dependencies.runAstBatch || runAstBatch)(request.ast || {});
  const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({ ...(request.evidence || { checks: [] }), retainAllMatches: true });
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
  facts.runtime.projection = request.projection || {};
  facts.runtime.source = request.source || null;
  facts.runtime.cache = request.cache || { enabled: false, mode: "not-configured" };
  facts.runtime.report = request.report || {};
  facts.boundaries = boundaries;
  facts.ownershipGraph = ownershipGraph;
  if (ownershipGraph) facts.quality.ownershipGraph = validateOwnershipGraph(ownershipGraph);
  facts.runtime.boundaryArtifact = request.boundaryArtifact || null;
  facts.quality.coverageGate = evaluateStage2Coverage(facts, { requirePlan: true });
  if (facts.quality.ownershipGraph && !facts.quality.ownershipGraph.ok) facts.quality.coverageGate.errors.push(...facts.quality.ownershipGraph.errors.map((error) => `ownershipGraph: ${error}`));
  applySafeBudget(facts, budgets.factsBytes, DEFAULT_STAGE2_BUDGET, 8192);
  facts.quality.coverageGate = evaluateStage2Coverage(facts, { requirePlan: true });
  if (facts.quality.ownershipGraph && !facts.quality.ownershipGraph.ok) facts.quality.coverageGate.errors.push(...facts.quality.ownershipGraph.errors.map((error) => `ownershipGraph: ${error}`));
  applySafeBudget(facts, budgets.factsBytes, DEFAULT_STAGE2_BUDGET, 8192);
  if (!facts.quality.coverageGate.ok) facts.status = "partial";
  return facts;
}

function buildStage2Summary(facts, artifact = null) {
  return buildStageSummary(facts, { artifact, projection: facts.runtime && facts.runtime.projection });
}

function parseArgs(argv) {
  const options = { stdout: "full" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--request", "--output", "--bundle", "--pretty", "--debug", "--stdout"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if (arg === "--pretty" || arg === "--debug") options[arg.slice(2)] = true;
    else {
      if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++index];
    }
  }
  if (!options.request) throw new Error("Provide --request <json-file>");
  if (!["full", "summary"].includes(options.stdout)) throw new Error("stdout must be full or summary");
  if (options.stdout === "summary" && !options.output && !options.bundle) throw new Error("--stdout summary requires --output or --bundle so full facts remain available");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const request = JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8"));
    const facts = runStage2(request);
    const fullText = `${JSON.stringify(facts, null, options.pretty ? 2 : 0)}\n`;
    const artifact = options.output ? path.resolve(options.output) : null;
    if (artifact) fs.writeFileSync(artifact, fullText);
    if (options.bundle) {
      const { buildStage2Bundle } = require("./stage2_bundle");
      const summary = buildStage2Bundle(facts, options.bundle);
      process.stdout.write(`${JSON.stringify(options.debug ? { ...summary, facts } : summary, null, options.pretty ? 2 : 0)}\n`);
      return;
    }
    const stdoutValue = options.stdout === "summary" ? buildStage2Summary(facts, artifact) : facts;
    process.stdout.write(`${JSON.stringify(stdoutValue, null, options.pretty ? 2 : 0)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { DEFAULT_STAGE2_BUDGET, advanceOwnershipGraph, buildStage2Summary, parseArgs, readOwnershipGraphArtifact, runStage2 };
