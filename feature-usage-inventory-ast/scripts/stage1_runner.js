#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runAstBatch } = require("./ast/batch");
const { extractTransition } = require("./extract_stage_transition");
const { applySafeBudget, measureValue } = require("./measure_context");
const { runEvidenceChecks } = require("./source_evidence");
const { createStageFacts, normalizeBudgets } = require("./stage_facts");
const { normalizeCapabilities } = require("./capability_contract");
const { evaluateStage1Coverage } = require("./stage1_coverage_gate");
const { normalizeBoundaryCandidates } = require("./boundary_candidates");
const { buildOwnershipGraph } = require("./ownership_graph");

const DEFAULT_STAGE1_BUDGETS = Object.freeze({ factsBytes: 64 * 1024, summaryBytes: 8 * 1024, evidenceBytes: 32 * 1024, reportBytes: 48 * 1024 });

function compactSymbol(value) {
  return value && { uid: value.uid, name: value.name, kind: value.kind, filePath: value.filePath, startLine: value.startLine, endLine: value.endLine };
}

function compactRelations(values, limit = 12) {
  return (Array.isArray(values) ? values : []).slice(0, limit).map(compactSymbol);
}

function parseJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch (_) {
    const start = trimmed.lastIndexOf("\n{");
    if (start >= 0) return JSON.parse(trimmed.slice(start + 1));
    throw new Error("GitNexus did not return JSON");
  }
}

function projectGraphContext(raw, seed) {
  const symbol = raw && raw.symbol;
  const incoming = raw && raw.incoming || {};
  const outgoing = raw && raw.outgoing || {};
  const candidates = [...compactRelations(incoming.calls), ...compactRelations(incoming.accesses), ...compactRelations(outgoing.calls), ...compactRelations(outgoing.has_method)];
  return {
    status: raw && raw.status === "found" ? "candidate" : "unresolved",
    seed,
    symbol: compactSymbol(symbol),
    epistemic: raw && raw.epistemic || "unknown",
    incoming: { calls: compactRelations(incoming.calls), accesses: compactRelations(incoming.accesses) },
    outgoing: { calls: compactRelations(outgoing.calls), has_method: compactRelations(outgoing.has_method) },
    candidateCount: candidates.length,
  };
}

function gitNexusInvocation(config) {
  const args = ["context"];
  if (config.repo) args.push("--repo", String(config.repo));
  if (config.file) args.push("--file", String(config.file));
  if (config.limit) args.push("--limit", String(config.limit));
  args.push(String(config.seed));
  if (config.runnerPath) return { command: process.execPath, args: [path.resolve(config.runnerPath), ...args], shell: false };
  const command = config.command || "gitnexus";
  return { command, args, shell: /\.(?:cmd|bat)$/i.test(command) };
}

function runGitNexusContext(config = {}, dependencies = {}) {
  if (config.enabled === false || !config.seed) return { status: "tool-unavailable", reason: config.reason || "not-configured", requests: [] };
  const invoke = dependencies.spawnSync || spawnSync;
  const call = gitNexusInvocation(config);
  const result = invoke(call.command, call.args, { cwd: config.cwd, encoding: "utf8", windowsHide: true, shell: call.shell, timeout: config.timeoutMs || 15000 });
  const request = { seed: config.seed, command: call.command, args: call.args, status: "candidate" };
  if (result.error || result.status !== 0) {
    request.status = "tool-unavailable";
    request.reason = result.error ? result.error.message : String(result.stderr || result.stdout || "GitNexus context failed").trim();
    return { status: "tool-unavailable", reason: request.reason, requests: [request] };
  }
  try {
    const context = projectGraphContext(parseJson(result.stdout), config.seed);
    request.status = context.status;
    return { status: context.status, requests: [request], context };
  } catch (error) {
    request.status = "unresolved";
    request.reason = error.message;
    return { status: "unresolved", reason: error.message, requests: [request] };
  }
}

function sourceAnchor(sourceEvidence, references = []) {
  for (const reference of references) {
    const check = (sourceEvidence.checks || []).find((item) => item.id === reference);
    const group = check && (check.groups || []).find((item) => item.firstAnchor);
    if (group && group.firstAnchor) return group.firstAnchor;
    const match = check && check.matches && check.matches[0];
    if (match) return { file: match.file, line: match.line };
  }
  return null;
}

function confirmationAnchor(confirmation) {
  if (!confirmation || typeof confirmation !== "object") return null;
  const file = confirmation.file || confirmation.path;
  const line = Number(confirmation.line || confirmation.startLine);
  return file && Number.isFinite(line) && line > 0 ? { file, line } : null;
}

function confirmationWithFreshness(confirmation, sourceRoot, fileCache = new Map()) {
  if (!confirmation || typeof confirmation !== "object") return null;
  const result = { ...confirmation };
  const anchor = confirmationAnchor(result);
  if (!anchor) return result;
  const file = path.isAbsolute(anchor.file) ? anchor.file : sourceRoot ? path.resolve(sourceRoot, anchor.file) : null;
  if (!file || !fs.existsSync(file)) return result;
  const lines = fileCache.get(file) || (() => {
    const loaded = fs.readFileSync(file, "utf8").split(/\r?\n/);
    fileCache.set(file, loaded);
    return loaded;
  })();
  const start = Math.max(0, anchor.line - 2);
  const fragment = lines.slice(start, anchor.line + 1).join("\n");
  result.freshness = {
    algorithm: "sha256",
    fragmentHash: crypto.createHash("sha256").update(fragment).digest("hex"),
    radius: 1,
  };
  return result;
}

function isConfirmedOwnership(group) {
  return /^(confirmed|подтвержденное использование)$/i.test(String(group && group.status || ""));
}

function normalizeOwnership(request, sourceEvidence, freshnessFileCache = new Map()) {
  const ownership = request.ownership || {};
  const groups = Array.isArray(ownership.groups) ? ownership.groups : [];
  return {
    expectedIds: [...new Set(ownership.expectedIds || [])],
    groups: groups.map((group, index) => {
      const confirmation = confirmationWithFreshness(group.confirmation, request.sourceRoot, freshnessFileCache);
      const status = group.status || "candidate";
      return {
        id: group.id || `ownership-${index + 1}`,
        order: group.order || "уточнить",
        role: group.role || "владелец/контейнер",
        object: group.object || "",
        relation: group.relation || "",
        evidenceRefs: [...new Set(group.evidenceRefs || [])],
        // A confirmed finding keeps the reviewer-selected source location.
        anchor: isConfirmedOwnership({ status }) ? confirmationAnchor(confirmation) || group.anchor || sourceAnchor(sourceEvidence, group.evidenceRefs) : group.anchor || sourceAnchor(sourceEvidence, group.evidenceRefs),
        status,
        required: group.required !== false,
        confirmation,
      };
    }),
  };
}

function summaryDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function rawSummary(facts, artifact = null) {
  const summary = {
    schemaVersion: "1.0.0",
    stage: 1,
    status: facts.status,
    artifact,
    graph: {
      status: facts.gitnexus && facts.gitnexus.status || "unknown",
      requests: (facts.gitnexus && facts.gitnexus.requests || []).length,
      seed: facts.gitnexus && facts.gitnexus.context && facts.gitnexus.context.seed || null,
      symbol: facts.gitnexus && facts.gitnexus.context && facts.gitnexus.context.symbol || null,
      candidateCount: facts.gitnexus && facts.gitnexus.context && facts.gitnexus.context.candidateCount || 0,
      limitation: facts.gitnexus && facts.gitnexus.reason || null,
    },
    ast: {
      planId: facts.ast && facts.ast.plan && facts.ast.plan.id || null,
      parsedFiles: facts.ast && facts.ast.stats && facts.ast.stats.uniqueFiles || 0,
      queries: (facts.ast && facts.ast.results || []).map((item) => ({ id: item.id, groups: item.coverage && item.coverage.groupsMatched || 0, digest: item.groupDigest })),
    },
    source: (facts.sourceEvidence && facts.sourceEvidence.checks || []).map((item) => ({ id: item.id, status: item.status, groups: item.groupsTotal, digest: item.groupDigest })),
    ownership: (facts.ownership && facts.ownership.groups || []).map((item) => ({ id: item.id, order: item.order, role: item.role, object: item.object, relation: item.relation, status: item.status, anchor: item.anchor })),
    ownershipGraph: facts.ownershipGraph ? { nodes: facts.ownershipGraph.nodes.length, edges: facts.ownershipGraph.edges.length, frontier: facts.ownershipGraph.frontier } : null,
    boundaries: (facts.boundaries || []).map((item) => ({ id: item.id, kind: item.kind, symbol: item.symbol, relation: item.relation, anchor: item.anchor, consumerRepos: item.consumerRepos, status: item.status })),
    coverage: facts.quality && facts.quality.coverageGate || null,
    measurements: { facts: facts.measurements && facts.measurements.facts || measureValue(facts) },
  };
  summary.digest = summaryDigest(summary);
  return summary;
}

function buildStage1Summary(facts, artifact = null) {
  const summary = rawSummary(facts, artifact);
  const budget = facts.runtime && facts.runtime.budgets && facts.runtime.budgets.summaryBytes || DEFAULT_STAGE1_BUDGETS.summaryBytes;
  const measured = measureValue(summary);
  if (measured.bytes > budget) {
    return { schemaVersion: "1.0.0", stage: 1, status: "partial", artifact, reason: "summary-budget-overflow", digest: summary.digest, output: { bytes: measured.bytes, budget, bounded: false, overflow: true, estimatedTokens: measured.estimatedTokens } };
  }
  summary.output = { bytes: measured.bytes, budget, bounded: true, overflow: false, estimatedTokens: measured.estimatedTokens };
  return summary;
}

function resolveRequest(request) {
  if (!request || !request.extends) return request;
  const base = JSON.parse(fs.readFileSync(path.resolve(request.extends), "utf8"));
  const result = { ...base, ...request };
  if (base.evidence || request.evidence) result.evidence = { ...(base.evidence || {}), ...(request.evidence || {}), checks: [...(base.evidence && base.evidence.checks || []), ...(request.evidence && request.evidence.checks || [])] };
  result.boundaries = request.boundaries || base.boundaries || [];
  delete result.extends;
  return result;
}

function runStage1(request, dependencies = {}) {
  if (Number(request && request.stage) !== 1) throw new Error("stage1_runner accepts only stage: 1");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  const budgets = normalizeBudgets(request, DEFAULT_STAGE1_BUDGETS);
  const transition = extractTransition(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const ast = (dependencies.runAstBatch || runAstBatch)(request.ast || {});
  const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({ ...(request.evidence || { checks: [] }), retainAllMatches: true });
  const gitnexus = (dependencies.runGitNexusContext || runGitNexusContext)(request.gitnexus || {}, dependencies);
  const ownership = normalizeOwnership(request, sourceEvidence, new Map());
  const quality = {
    astFilesParsedOnce: Object.values(ast.stats && ast.stats.parseCounts || {}).every((count) => count === 1),
    astPlanCompiledBeforeParse: Boolean(ast.plan && ast.plan.compiledBeforeParse),
    astLateQueries: ast.plan ? ast.plan.lateQueries : null,
    graphRequests: (gitnexus.requests || []).length,
    sourceChecks: sourceEvidence.checks.length,
    emptyChecksAreCandidates: sourceEvidence.checks.filter((check) => check.status === "candidate-empty").length,
  };
  const facts = createStageFacts({ stage: 1, status: ast.status === "partial" ? "partial" : "candidate", transition, ast, sourceEvidence, quality, budgets, capabilities: normalizeCapabilities(request.capabilities || []) });
  facts.runtime.contract = "stage-1-facts";
  facts.runtime.graph = request.gitnexus ? { configured: true } : { configured: false };
  facts.gitnexus = gitnexus;
  facts.ownership = ownership;
  facts.ownershipGraph = request.ownershipGraph ? buildOwnershipGraph(request.ownershipGraph) : null;
  facts.boundaries = normalizeBoundaryCandidates(request, ownership, sourceEvidence);
  facts.coverageContract = request.coverageContract || null;
  facts.claimLedger = request.claimLedger || null;
  facts.observations = Array.isArray(request.observations) ? request.observations : [];
  applySafeBudget(facts, budgets.factsBytes, DEFAULT_STAGE1_BUDGETS.factsBytes, 8192);
  facts.quality.summary = buildStage1Summary(facts).output;
  facts.quality.coverageGate = evaluateStage1Coverage(facts);
  if (!facts.quality.coverageGate.ok) facts.status = "partial";
  applySafeBudget(facts, budgets.factsBytes, DEFAULT_STAGE1_BUDGETS.factsBytes, 8192);
  facts.quality.summary = buildStage1Summary(facts).output;
  facts.quality.coverageGate = evaluateStage1Coverage(facts);
  if (!facts.quality.coverageGate.ok) facts.status = "partial";
  return facts;
}

function parseArgs(argv) {
  const options = { stdout: "full" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!['--request', '--output', '--bundle', '--pretty', '--stdout'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if (arg === '--pretty') options.pretty = true;
    else {
      if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++index];
    }
  }
  if (!options.request) throw new Error("Provide --request <json-file>");
  if (!["full", "summary"].includes(options.stdout)) throw new Error("stdout must be full or summary");
  if (options.stdout === "summary" && !options.output && !options.bundle) throw new Error("--stdout summary requires --output or --bundle");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const request = resolveRequest(JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8")));
    const facts = runStage1(request);
    const text = `${JSON.stringify(facts, null, options.pretty ? 2 : 0)}\n`;
    const artifact = options.output ? path.resolve(options.output) : null;
    if (artifact) fs.writeFileSync(artifact, text);
    if (options.bundle) {
      const { buildStage1Bundle } = require("./stage1_bundle");
      process.stdout.write(`${JSON.stringify(buildStage1Bundle(facts, options.bundle))}\n`);
      return;
    }
    const output = options.stdout === "summary" ? buildStage1Summary(facts, artifact) : facts;
    process.stdout.write(`${JSON.stringify(output, null, options.pretty ? 2 : 0)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

module.exports = { DEFAULT_STAGE1_BUDGETS, buildStage1Summary, confirmationWithFreshness, gitNexusInvocation, normalizeOwnership, projectGraphContext, resolveRequest, runGitNexusContext, runStage1 };
if (require.main === module) main();
