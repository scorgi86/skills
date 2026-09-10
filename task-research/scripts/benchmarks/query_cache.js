"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("node:child_process");

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = sorted.length / 2; return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2; };

function parseArgs(argv) {
  const options = { runs: 6, warmup: 1 };
  for (let index = 0; index < argv.length; index += 2) options[argv[index].replace(/^--/, "")] = argv[index + 1];
  for (const key of ["runtime", "workload", ...(options.child ? ["mode"] : ["output"])]) if (!options[key]) throw new Error(`Provide --${key}`);
  for (const key of ["runs", "warmup"]) { options[key] = Number(options[key]); if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`${key} must be a positive integer`); }
  if (options.runs % 2) throw new Error("runs must be even so execution order can be balanced");
  if (options.child && !["baseline", "current"].includes(options.mode)) throw new Error("mode must be baseline or current");
  return options;
}

function semantic(value) {
  const copy = JSON.parse(JSON.stringify(value));
  (function visit(item) {
    if (!item || typeof item !== "object") return;
    for (const key of ["elapsedMs", "cacheHits", "cacheMisses", "output", "metrics", "measurements", "warnings", "summary"]) delete item[key];
    for (const child of Object.values(item)) visit(child);
  })(copy);
  return copy;
}

function transition(runtime, file, scope, target) {
  const create = require(path.join(runtime, "scripts/shared/artifacts/src/canonical/result.js")).createCanonicalStageResult;
  const fields = { target, scope: "declared repositories", stage: "0", status: "closed", "confirmed evidence": "scope", "candidate evidence": "file candidates", "dictionary/graph/path state": "ready", "skipped/forbidden": "none", "open checks": "stages 1-7", "next stage": "1" };
  fs.writeFileSync(file, JSON.stringify(create({ facts: { stage: 0, status: "closed", repositoryScope: scope, transition: { fields } } })));
}

async function runPair(runtime, workload, outputRoot, queryCacheEnabled, measured) {
  fs.mkdirSync(outputRoot, { recursive: true });
  const route = require(path.join(runtime, "scripts/flows/full-flow/src/stage_pipeline.js")).withRuntimeAstCache;
  const create = require(path.join(runtime, "scripts/shared/artifacts/src/canonical/result.js")).createCanonicalStageResult;
  const events = [], stages = [];
  let transitionArtifact = path.join(outputRoot, "stage0.json");
  transition(runtime, transitionArtifact, workload.repositoryScope, workload.target);
  for (const stage of [1, 2]) {
    const runner = require(path.join(runtime, `scripts/steps/step-${stage}/src/runner.js`))[`runStage${stage}`];
    const ast = require(path.join(runtime, "scripts/shared/ast/src/batch/batch.js")).runAstBatch;
    const evidence = require(path.join(runtime, "scripts/shared/evidence/src/collection/source_evidence.js")).runEvidenceChecks;
    const requestSource = workload[`stage${stage}`];
    const request = route({ ...requestSource, transitionArtifact, repositoryScope: workload.repositoryScope,
      ast: { ...requestSource.ast, concurrency: 2 } }, outputRoot);
    delete request.ownershipGraphArtifact; delete request.boundaryArtifact;
    const started = performance.now();
    let astMs = 0, evidenceMs = 0;
    const result = await runner(request, {
      async runAstBatch(input) { const start = performance.now(); const value = await ast(input, { queryCacheEnabled, queryCacheObserver: event => { if (measured) events.push(event); } }); astMs += performance.now() - start; return value; },
      runEvidenceChecks(...args) { const start = performance.now(); const value = evidence(...args); evidenceMs += performance.now() - start; return value; }
    });
    const wallMs = performance.now() - started;
    if (measured) stages.push({ stage, wallMs, astMs, evidenceMs, residualMs: wallMs - astMs - evidenceMs,
      semanticDigest: digest(JSON.stringify(semantic(result))), fileCacheHits: result.ast?.stats?.cacheHits || 0, fileCacheMisses: result.ast?.stats?.cacheMisses || 0 });
    transitionArtifact = path.join(outputRoot, `stage${stage}.json`);
    fs.writeFileSync(transitionArtifact, JSON.stringify(create({ facts: result, factsPrepared: true, input: request })));
  }
  return { stages, events };
}

async function childSample(options) {
  const runtime = path.resolve(options.runtime), workload = JSON.parse(fs.readFileSync(path.resolve(options.workload), "utf8"));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "query-cache-benchmark-"));
  try {
    const enabled = options.mode === "current";
    await runPair(runtime, workload, path.join(parent, "seed"), enabled, false);
    const measured = await runPair(runtime, workload, path.join(parent, "repeat"), enabled, true);
    const queryDirectory = path.join(parent, ".runtime-cache", "ast");
    const cacheBytes = fs.existsSync(queryDirectory) ? fs.readdirSync(queryDirectory, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".json")).reduce((sum, entry) => sum + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0) : 0;
    return { mode: options.mode, ...measured, pairWallMs: measured.stages.reduce((sum, stage) => sum + stage.wallMs, 0),
      runQueryCalls: measured.events.filter(event => event.ranQuery).length, runQueryMs: measured.events.reduce((sum, event) => sum + (event.runQueryMs || 0), 0),
      maxRssKiB: process.resourceUsage().maxRSS, cacheBytes };
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
}

function runChild(runtime, workload, mode) {
  const child = spawnSync(process.execPath, [__filename, "--child", "1", "--runtime", runtime, "--workload", workload, "--mode", mode], { encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (child.status !== 0) throw new Error(`Query-cache sample failed: ${child.stderr || child.stdout}`);
  return JSON.parse(child.stdout);
}

function summarize(samples) {
  return { pairMedianMs: median(samples.map(sample => sample.pairWallMs)), stage1MedianMs: median(samples.map(sample => sample.stages[0].wallMs)), stage2MedianMs: median(samples.map(sample => sample.stages[1].wallMs)),
    stageMedians: [0, 1].map(index => ({ stage: index + 1, astMs: median(samples.map(sample => sample.stages[index].astMs)),
      evidenceMs: median(samples.map(sample => sample.stages[index].evidenceMs)), residualMs: median(samples.map(sample => sample.stages[index].residualMs)) })),
    eventCounts: Object.fromEntries(["hit", "miss", "failed", "ineligible"].map(status => [status, samples.map(sample => sample.events.filter(event => event.status === status).length)])),
    runQueryCalls: samples.map(sample => sample.runQueryCalls), runQueryMedianMs: median(samples.map(sample => sample.runQueryMs)),
    semanticDigests: [...new Set(samples.flatMap(sample => sample.stages.map(stage => `${stage.stage}:${stage.semanticDigest}`)))], maxRssKiB: median(samples.map(sample => sample.maxRssKiB)), cacheBytes: median(samples.map(sample => sample.cacheBytes)) };
}

function decide(series) {
  const gains = series.map(item => (item.modes.baseline.summary.pairMedianMs - item.modes.current.summary.pairMedianMs) / item.modes.baseline.summary.pairMedianMs * 100);
  const semantic = series.every(item => JSON.stringify(item.modes.baseline.summary.semanticDigests) === JSON.stringify(item.modes.current.summary.semanticDigests));
  return { result: semantic && gains.every(gain => gain >= 5) ? "retain" : "remove", gainsPercent: gains, semanticEqual: semantic };
}

function gitState(root) {
  const run = args => spawnSync("git", ["-C", root, ...args], { encoding: null, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const head = run(["rev-parse", "HEAD"]), diff = run(["diff", "--binary", "HEAD", "--", "."]), untracked = run(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (head.status || diff.status || untracked.status) throw new Error(`Cannot capture repository state: ${root}`);
  const extra = untracked.stdout.toString("utf8").split("\0").filter(Boolean).sort().flatMap(name => [Buffer.from(`${name}\0`), fs.readFileSync(path.join(root, name))]);
  return { root: path.resolve(root), head: head.stdout.toString("utf8").trim(), worktreeDigest: digest(Buffer.concat([diff.stdout, ...extra])) };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.child) { process.stdout.write(`${JSON.stringify(await childSample(options))}\n`); return; }
  const runtime = path.resolve(options.runtime), workloadPath = path.resolve(options.workload), workloadBytes = fs.readFileSync(workloadPath), workload = JSON.parse(workloadBytes), modes = ["baseline", "current"], series = [];
  for (let seriesIndex = 0; seriesIndex < 2; seriesIndex += 1) {
    for (const mode of modes) for (let count = 0; count < options.warmup; count += 1) runChild(runtime, workloadPath, mode);
    const samples = { baseline: [], current: [] };
    for (let round = 0; round < options.runs; round += 1) {
      const order = (round + seriesIndex) % 2 ? [...modes].reverse() : modes;
      for (const mode of order) samples[mode].push(runChild(runtime, workloadPath, mode));
      process.stderr.write(`series ${seriesIndex + 1}: ${round + 1}/${options.runs}\n`);
    }
    series.push({ modes: Object.fromEntries(modes.map(mode => [mode, { samples: samples[mode], summary: summarize(samples[mode]) }])) });
  }
  const implementationFiles = ["scripts/shared/ast/src/analysis/analysis.js", "scripts/shared/ast/src/analysis/analysis_worker.js", "scripts/shared/ast/src/batch/batch.js", "scripts/shared/ast/src/query-cache/identity.js", "scripts/shared/ast/src/query-cache/storage.js"];
  const result = { schemaVersion: "query-cache-benchmark/1.0.0", generatedAt: new Date().toISOString(), methodology: { concurrency: 2, modes, series: 2, warmup: options.warmup, measuredRuns: options.runs, fileCache: "enabled and warmed by a seed sibling in both modes", sampleIsolation: "unique child process and parent directory per sample" }, provenance: { harnessDigest: digest(fs.readFileSync(__filename)), workloadDigest: digest(workloadBytes), implementationDigest: digest(implementationFiles.map(file => `${file}\0${digest(fs.readFileSync(path.join(runtime, file)))}`).join("\n")), repositories: workload.repositoryScope.repositories.map(repository => gitState(repository.root)), environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model || "unknown" } }, series };
  result.decision = decide(series);
  fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) void main();
module.exports = { childSample, decide, median, parseArgs, semantic, summarize };
