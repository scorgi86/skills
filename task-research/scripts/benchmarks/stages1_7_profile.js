"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("node:child_process");

function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function operationMedians(values) {
  const kinds = [...new Set(values.flatMap(value => value.operations.map(item => item.kind)))].sort();
  return Object.fromEntries(kinds.map(kind => [kind, median(values.map(value => unionDuration(value.operations.filter(item => item.kind === kind), value.wallMs)))]));
}
function parseArgs(argv) {
  const options = { warmup: 1, runs: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--runtime", "--requests", "--output", "--compare", "--warmup", "--runs"].includes(key) || !argv[index + 1]) throw new Error(`Unknown or incomplete option: ${key}`);
    options[key.slice(2)] = argv[++index];
  }
  for (const key of ["runtime", "requests", "output"]) if (!options[key]) throw new Error(`Provide --${key}`);
  for (const key of ["warmup", "runs"]) { options[key] = Number(options[key]); if (!Number.isInteger(options[key]) || options[key] < (key === "runs" ? 1 : 0)) throw new Error(`${key} must be a valid count`); }
  return options;
}
function filesDigest(directory, names) {
  return digest(names.sort().map(name => `${name}\0${digest(fs.readFileSync(path.join(directory, name)))}`).join("\n"));
}
function gitSignature(root) {
  const run = args => spawnSync("git", ["-C", root, ...args], { encoding: null, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const head = run(["rev-parse", "HEAD"]);
  if (head.status !== 0) throw new Error(`Cannot capture repository HEAD: ${path.resolve(root)}`);
  const changed = run(["diff", "--binary", "HEAD", "--", "."]);
  const untracked = run(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (changed.status !== 0 || untracked.status !== 0) throw new Error(`Cannot capture repository state: ${path.resolve(root)}`);
  const entries = untracked.stdout.toString("utf8").split("\0").filter(Boolean).sort().map(name => {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    const content = stat.isSymbolicLink() ? Buffer.from(fs.readlinkSync(file)) : fs.readFileSync(file);
    return Buffer.concat([Buffer.from(`${name}\0${stat.isSymbolicLink() ? "link" : "file"}\0`), content]);
  });
  return { root: path.resolve(root), head: head.stdout.toString("utf8").trim(), worktreeDigest: digest(Buffer.concat([changed.stdout, ...entries])) };
}
function semantic(value) {
  const copy = JSON.parse(JSON.stringify(value));
  const visit = item => {
    if (!item || typeof item !== "object") return;
    for (const key of ["elapsedMs", "cacheHits", "cacheMisses", "metrics", "output"]) delete item[key];
    for (const child of Object.values(item)) visit(child);
  };
  visit(copy);
  if (copy.ast) delete copy.ast.warnings;
  return copy;
}
function stageSemantic(runtime, value) {
  const facts = require(path.join(runtime, "scripts/shared/artifacts/src/canonical/facts.js")).canonicalFacts(value);
  return semantic({ stage: value.stage, status: value.status, transition: value.transition, facts, canonicalEvidence: value.canonicalEvidence || [] });
}
function transition(directory, repositoryScope, runtime) {
  const { createCanonicalStageResult } = require(path.join(runtime, "scripts/shared/artifacts/src/canonical/result.js"));
  const fields = { target: "internal shadows", scope: "declared repositories", stage: "0", status: "closed", "confirmed evidence": "scope", "candidate evidence": "file candidates", "dictionary/graph/path state": "ready", "skipped/forbidden": "none", "open checks": "stages 1-7", "next stage": "1" };
  const file = path.join(directory, "transition.json");
  const facts = { stage: 0, status: "closed", repositoryScope, transition: { fields }, boundaries: [{
    id: "sdkjs-webapps-shadow", kind: "format-owner", producerRepo: "sdkjs", consumerRepos: ["web-apps"],
    searchTerms: ["ShapeShadowSettings", "ShapeShadowMenu", "asc_getShadow", "asc_putShadow"]
  }] };
  fs.writeFileSync(file, JSON.stringify(createCanonicalStageResult({ facts })));
  return file;
}
function readRequest(directory, stage, transitionArtifact, repositoryScope) {
  const request = JSON.parse(fs.readFileSync(path.join(directory, `stage-${stage}-request.json`), "utf8"));
  request.transitionArtifact = transitionArtifact;
  request.repositoryScope = repositoryScope;
  if (stage === 2) delete request.ownershipGraphArtifact;
  if (stage >= 5) request.capabilities = (request.capabilities || []).map(item => item.status === "checked-no-usage" ? { ...item, status: "reference-only" } : item);
  if (stage === 6) { request.mode = "feature-reference"; request.featureReference = { target: "internal shadows", referenceEntity: "outer shadow", capabilities: request.capabilities }; request.openChecks = []; }
  return request;
}
function stage7ModelName(directory) {
  return ["stage-7-v4-report-model.json", "stage-7-report-model-v3.json", "stage-7-report-model-v2.json", "stage-7-report-model.json"].find(name => fs.existsSync(path.join(directory, name))) || "stage-7-v4-report-model.json";
}
function createSampleLayout() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "stage-profile-"));
  const outputRoot = path.join(parent, "inventory");
  fs.mkdirSync(outputRoot);
  return { parent, outputRoot };
}
async function runSample(runtime, requests, repositoryScope) {
  const sample = createSampleLayout(), sampleRoot = sample.outputRoot;
  try {
    const transitionArtifact = transition(sampleRoot, repositoryScope, runtime);
    const stages = [];
    for (let stage = 1; stage <= 6; stage += 1) {
      const module = require(path.join(runtime, `scripts/steps/step-${stage}/src/runner.js`));
      const runner = module[`runStage${stage}`];
      let request = readRequest(requests, stage, transitionArtifact, repositoryScope);
      let route;
      try { route = require(path.join(runtime, "scripts/flows/full-flow/src/stage_pipeline.js")).withRuntimeAstCache; } catch { route = null; }
      if (route && stage <= 2) request = route(request, sampleRoot);
      const operations = [];
      const dependencies = {};
      if (stage <= 2) {
        const ast = require(path.join(runtime, "scripts/shared/ast/src/batch/batch.js")).runAstBatch;
        dependencies.runAstBatch = async input => { const start = performance.now(); const result = await ast(input); operations.push({ kind: "ast", start, end: performance.now() }); return result; };
      }
      if (stage <= 5) {
        const evidence = require(path.join(runtime, "scripts/shared/evidence/src/collection/source_evidence.js")).runEvidenceChecks;
        dependencies.runEvidenceChecks = input => { const start = performance.now(); const result = evidence(input); operations.push({ kind: "evidence", start, end: performance.now() }); return result; };
      }
      if (stage === 2) {
        const coverage = require(path.join(runtime, "scripts/steps/step-2/src/coverage_gate.js")).evaluateStage2Coverage;
        const budget = require(path.join(runtime, "scripts/shared/output/src/measure_context.js")).applySafeBudget;
        const prepare = require(path.join(runtime, "scripts/shared/artifacts/src/canonical/facts.js")).prepareFacts;
        const measured = (kind, fn) => (...args) => { const started = performance.now(); const result = fn(...args); operations.push({ kind, start: started, end: performance.now() }); return result; };
        dependencies.evaluateStage2Coverage = measured("coverage", coverage);
        dependencies.applySafeBudget = measured("budget", budget);
        dependencies.prepareFacts = measured("canonical-preparation", prepare);
      }
      const start = performance.now();
      const result = await runner(request, dependencies);
      const end = performance.now();
      const projection = stageSemantic(runtime, result);
      stages.push({ stage, wallMs: end - start, operations: operations.map(item => ({ kind: item.kind, startMs: item.start - start, endMs: item.end - start })), semanticDigest: digest(JSON.stringify(projection)) });
    }
    const model = JSON.parse(fs.readFileSync(path.join(requests, stage7ModelName(requests)), "utf8"));
    model.capabilities = (model.capabilities || []).map(item => item.status === "checked-no-usage" ? { ...item, status: "reference-only" } : item);
    const normalize = require(path.join(runtime, "scripts/shared/report/src/model/normalization.js")).normalizeReportModel;
    const validate = require(path.join(runtime, "scripts/shared/report/src/model/validation.js")).validateReportModel;
    const start = performance.now(), normalized = normalize(model), validation = validate(normalized), end = performance.now();
    stages.push({ stage: 7, wallMs: end - start, operations: [], semanticDigest: digest(JSON.stringify(semantic({ normalized, validation }))) });
    return stages;
  } finally { fs.rmSync(sample.parent, { recursive: true, force: true }); }
}
function unionDuration(intervals, wall) {
  const sorted = intervals.map(item => [Math.max(0, item.startMs), Math.min(wall, item.endMs)]).filter(([a, b]) => b >= a).sort((a, b) => a[0] - b[0]);
  let total = 0, current = null;
  for (const interval of sorted) { if (!current || interval[0] > current[1]) { if (current) total += current[1] - current[0]; current = interval; } else current[1] = Math.max(current[1], interval[1]); }
  if (current) total += current[1] - current[0];
  if (total > wall) throw new Error("Nested operation duration exceeds stage wall time");
  return total;
}
function compareSignature(current, baseline) {
  for (const key of ["harnessDigest", "requestDigest", "environmentDigest", "targetRepositoriesDigest", "workloadDigest"]) if (current.signature[key] !== baseline.signature?.[key]) throw new Error(`Incomparable profile: ${key} differs`);
}
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv), runtime = path.resolve(options.runtime), requests = path.resolve(options.requests), output = path.resolve(options.output);
  const requestNames = Array.from({ length: 6 }, (_, index) => `stage-${index + 1}-request.json`).concat(stage7ModelName(requests));
  const stage0 = JSON.parse(fs.readFileSync(path.join(requests, "stage-0-request.json"), "utf8"));
  const repositoryScope = stage0.repositoryScope || { repositories: (stage0.repos || []).map((repo, index) => ({ id: repo.id, root: repo.path, role: index === 0 ? "producer" : "consumer" })) };
  if (!repositoryScope.repositories.length) throw new Error("Stage 0 request must declare repositoryScope or repos");
  const targetRepositories = repositoryScope.repositories.map(repo => gitSignature(repo.root));
  const harnessDigest = digest(fs.readFileSync(__filename));
  const workload = { warmup: options.warmup, runs: options.runs, cache: "clean Stage 1 then shared Stage 2 per sample" };
  const signature = {
    harnessDigest,
    requestDigest: filesDigest(requests, requestNames.concat("stage-0-request.json")),
    environmentDigest: digest(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model || "unknown" })),
    targetRepositoriesDigest: digest(JSON.stringify(targetRepositories)),
    workloadDigest: digest(JSON.stringify(workload)),
    implementationDigest: filesDigest(runtime, ["scripts/flows/full-flow/src/stage_pipeline.js", "scripts/steps/step-1/src/runner.js", "scripts/steps/step-2/src/runner.js", "scripts/shared/artifacts/src/stage_artifact_v4.js", "scripts/shared/artifacts/src/canonical/result.js"])
  };
  const inputBefore = signature.requestDigest;
  for (let i = 0; i < options.warmup; i += 1) await runSample(runtime, requests, repositoryScope);
  const samples = [];
  for (let index = 0; index < options.runs; index += 1) samples.push(await runSample(runtime, requests, repositoryScope));
  if (filesDigest(requests, requestNames.concat("stage-0-request.json")) !== inputBefore) throw new Error("Benchmark modified its request pack");
  const stages = Array.from({ length: 7 }, (_, index) => { const stage = index + 1, values = samples.map(sample => sample.find(item => item.stage === stage)); return { stage, samplesMs: values.map(item => item.wallMs), medianMs: median(values.map(item => item.wallMs)), semanticDigests: [...new Set(values.map(item => item.semanticDigest))], operationMediansMs: stage === 2 ? operationMedians(values) : undefined, residualMedianMs: stage === 2 ? median(values.map(item => item.wallMs - unionDuration(item.operations, item.wallMs))) : undefined }; });
  const unstable = stages.filter(item => item.semanticDigests.length !== 1);
  if (unstable.length) throw new Error(`Semantic projection changed between samples: ${unstable.map(item => `stage ${item.stage} (${item.semanticDigests.join(",")})`).join("; ")}`);
  const profile = { schemaVersion: "stage-profile/1.0.0", signature, targetRepositories, workload, stages, stage1And2MedianMs: median(samples.map(sample => sample[0].wallMs + sample[1].wallMs)) };
  if (options.compare) { const baseline = JSON.parse(fs.readFileSync(path.resolve(options.compare), "utf8")); compareSignature(profile, baseline); for (const stage of stages) if (stage.semanticDigests[0] !== baseline.stages[stage.stage - 1]?.semanticDigests?.[0]) throw new Error(`Incomparable profile: stage ${stage.stage} semantic projection differs`); profile.comparison = { stage1And2GainPercent: (baseline.stage1And2MedianMs - profile.stage1And2MedianMs) / baseline.stage1And2MedianMs * 100, stage2ResidualGainPercent: (baseline.stages[1].residualMedianMs - profile.stages[1].residualMedianMs) / baseline.stages[1].residualMedianMs * 100 }; }
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(profile, null, 2)}\n`); process.stdout.write(`${JSON.stringify(profile)}\n`);
}
if (require.main === module) void main();
module.exports = { compareSignature, createSampleLayout, digest, gitSignature, median, operationMedians, parseArgs, runSample, semantic, stage7ModelName, stageSemantic, unionDuration };
