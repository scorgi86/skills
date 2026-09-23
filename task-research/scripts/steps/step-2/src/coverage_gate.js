"use strict";

const { decodeHumanFields } = require("../../../shared/output/src/human_report_codec.js");

function astQueries(value) {
  return value && value.ast && (value.ast.queries || value.ast.results) || [];
}

function sourceChecks(value) {
  return value && value.sourceEvidence && (value.sourceEvidence.checks || value.sourceEvidence) || [];
}

function decideStage2(value) {
  if (value.runtime?.autoStage2 && value.boundaryDiscovery?.status === "partial") return { status: "partial", frontierStatus: "open", reasons: value.boundaryDiscovery.reasons || ["boundary discovery is incomplete"] };
  const graph = value.ownershipGraph;
  if (!graph && !value.runtime?.autoStage2) return { status: "closed", frontierStatus: "open", reasons: [] };
  const graphQuality = graph ? require("../../../shared/ownership/src/ownership_graph.js").validateOwnershipGraph(graph) : { ok: false, errors: ["ownershipGraph is missing"] };
  if (!graphQuality.ok) return { status: "blocked", frontierStatus: "open", reasons: graphQuality.errors.map(reason => `ownershipGraph: ${reason}`) };
  if (value.runtime?.frontierExhausted === true) return { status: "closed", frontierStatus: "exhausted", reasons: [] };
  const discovery = value.ownerDiscovery;
  if (!discovery) return { status: "closed", frontierStatus: "open", reasons: [] };
  const blocking = require("../../step-1/src/stage1_coverage_gate.js").blockingOwnerUnresolved(discovery.unresolved);
  if (blocking.length) return { status: "partial", frontierStatus: "open", reasons: [...new Set(blocking.map(row => row.reason))] };
  const groups = value.ownership?.groups || value.ownership || [];
  const candidates = groups.filter(row => row.status !== "confirmed");
  if (candidates.length) return { status: "partial", frontierStatus: "open", reasons: candidates.map(row => `${row.id}: not source-confirmed`) };
  const frontier = value.runtime?.ownershipFrontier || [];
  const key = row => `${row.repository}\0${row.entity || row.seed}`;
  const completed = new Set([...(discovery.exhaustedSeeds || []), ...(discovery.advancedSeeds || [])].map(key));
  const missing = frontier.filter(row => !completed.has(key(row)));
  if (missing.length) return { status: "partial", frontierStatus: "open", reasons: missing.map(row => `${row.repository}:${row.entity}: frontier search incomplete`) };
  const exhausted = frontier.length > 0 && (discovery.exhaustedSeeds || []).length === frontier.length && !(discovery.generatedIds || []).length;
  return { status: "closed", frontierStatus: exhausted ? "exhausted" : "advanced", reasons: [] };
}

function evaluateStage2Coverage(input, options = {}) {
  const errors = [];
  const warnings = [];
  let value;
  try { value = decodeHumanFields(input); } catch (error) {
    return { schemaVersion: "1.0.0", status: "blocked", ok: false, errors: [error.message], warnings };
  }
  if (Number(value.stage) !== 2) errors.push("Coverage gate requires stage 2 data");
  const decision = decideStage2(value);
  if (decision.status !== "closed") errors.push(...decision.reasons);
  const ownership = value.ownershipGraph
    ? require("../../../shared/ownership/src/ownership_graph.js").validateOwnershipGraph(value.ownershipGraph)
    : value.quality?.ownershipGraph;
  if (ownership && (ownership.ok === false || ownership.errors?.length)) {
    errors.push(...(ownership.errors?.length ? ownership.errors : ["validation failed"]).map(error => `ownershipGraph: ${error}`));
  }

  const stats = value.ast && value.ast.stats || {};
  const parseCounts = Object.values(stats.parseCounts || {});
  if (parseCounts.some((count) => count !== 1)) errors.push("Every parsed file must have parse count 1");
  if (stats.failed > 0) errors.push(`AST parse failures: ${stats.failed}`);
  const plan = value.ast && value.ast.plan || value.runtime && value.runtime.plan || null;
  if (plan && plan.compiledBeforeParse !== true) errors.push("AST plan was not compiled before parse");
  if (plan && Number(plan.lateQueries || 0) !== 0) errors.push(`AST late queries: ${plan.lateQueries}`);
  if (!plan && options.requirePlan) errors.push("AST plan metadata is missing");
  if (value.runtime?.autoStage2 && !astQueries(value).length) errors.push("Automatic Stage 2 search requires non-empty AST queries");

  for (const query of astQueries(value)) {
    const id = query.id || query.command || "<query>";
    const coverage = query.coverage || {};
    if ((coverage.detailsRequested || 0) !== (coverage.detailsReturned || 0)) errors.push(`${id}: requested and returned details differ`);
    if ((coverage.detailsSuppressed || 0) !== 0) errors.push(`${id}: details were suppressed`);
    if ((coverage.detailEvidenceSuppressed || 0) !== 0) errors.push(`${id}: detail evidence was suppressed`);
    const matched = coverage.groupsMatched ?? query.groupsAvailable ?? 0;
    if (matched > 0 && !query.groupDigest) errors.push(`${id}: group digest is missing`);
    for (const group of query.groups || []) if (!group.firstAnchor && !group.example) errors.push(`${id}/${group.key || "<group>"}: first anchor is missing`);
  }

  for (const check of sourceChecks(value)) {
    const id = check.id || "<check>";
    const groupsTotal = check.groupsTotal || (check.groups || []).length;
    if (groupsTotal > 0 && !check.groupDigest) errors.push(`${id}: source group digest is missing`);
    for (const group of check.groups || []) if (!group.firstAnchor) errors.push(`${id}/${group.key || "<group>"}: source first anchor is missing`);
    if (check.status === "candidate-empty") warnings.push(`${id}: empty source result remains candidate-only`);
  }

  const output = value.output || null;
  if (output && output.overflow === true) errors.push("Output budget overflow");
  if (output && output.bounded === false) errors.push("Output is not bounded");
  return {
    schemaVersion: "1.0.0",
    status: errors.length ? decision.status === "partial" ? "partial" : "blocked" : "passed",
    ok: errors.length === 0,
    checks: { parseFiles: parseCounts.length, astQueries: astQueries(value).length, sourceChecks: sourceChecks(value).length },
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    decision,
  };
}

module.exports = { decideStage2, evaluateStage2Coverage };
