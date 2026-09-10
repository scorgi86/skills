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
  const required = options.child ? ["runtime", "workload", "mode"]
    : options.baseline || options.current ? ["baseline", "current", "workload", "output"] : ["runtime", "workload", "output"];
  for (const key of required) if (!options[key]) throw new Error(`Provide --${key}`);
  for (const key of ["runs", "warmup"]) { options[key] = Number(options[key]); if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`${key} must be a positive integer`); }
  if (options.runs % 2) throw new Error("runs must be even so execution order can be balanced");
  if ((options.baseline || options.current) && options.runs < 6) throw new Error("A/B runs must be at least 6");
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

async function runStage(runtime, stage, request) {
  const runner = require(path.join(runtime, `scripts/steps/step-${stage}/src/runner.js`))[`runStage${stage}`];
  const ast = require(path.join(runtime, "scripts/shared/ast/src/batch/batch.js")).runAstBatch;
  const evidence = require(path.join(runtime, "scripts/shared/evidence/src/collection/source_evidence.js")).runEvidenceChecks;
  const operations = { astMs: 0, evidenceMs: 0 };
  const started = performance.now();
  const result = await runner(request, {
    async runAstBatch(input) { const start = performance.now(); try { return await ast(input); } finally { operations.astMs += performance.now() - start; } },
    runEvidenceChecks(input) { const start = performance.now(); try { return evidence(input); } finally { operations.evidenceMs += performance.now() - start; } },
  });
  const wallMs = performance.now() - started;
  const quality = {
    ast: result.ast?.results || [], sourceEvidence: result.sourceEvidence || result.evidence || null,
    ownership: result.ownership || result.ownershipGraph || result.ownershipObservations || null,
    status: result.status, partialReason: result.partialReason || result.partialReasons || result.limitations || null,
  };
  return { result, metrics: { stage, wallMs, ...operations, residualMs: wallMs - operations.astMs - operations.evidenceMs,
    files: result.ast?.stats?.uniqueFiles || 0, queries: result.ast?.stats?.queries || 0,
    sourceChecks: result.sourceEvidence?.checks?.length || result.evidence?.checks?.length || 0,
    cacheHits: result.ast?.stats?.cacheHits || 0, cacheMisses: result.ast?.stats?.cacheMisses || 0,
    semanticDigest: digest(JSON.stringify(semantic(result))), qualityDigest: digest(JSON.stringify(semantic(quality))) } };
}

async function childSample(options) {
  const runtime = path.resolve(options.runtime), workload = JSON.parse(fs.readFileSync(path.resolve(options.workload), "utf8"));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "parallel-ast-")), outputRoot = path.join(parent, "inventory");
  fs.mkdirSync(outputRoot);
  try {
    const route = require(path.join(runtime, "scripts/flows/full-flow/src/stage_pipeline.js")).withRuntimeAstCache;
    const analyzeFiles = require(path.join(runtime, "scripts/shared/ast/src/analysis/analysis.js")).analyzeFiles;
    const compileQueryPlan = require(path.join(runtime, "scripts/shared/ast/src/batch/batch.js")).compileQueryPlan;
    const firstTransition = path.join(outputRoot, "stage0.json");
    transition(runtime, firstTransition, workload.repositoryScope, workload.target);
    const stage1Request = route({ ...workload.stage1, transitionArtifact: firstTransition, repositoryScope: workload.repositoryScope, ast: { ...workload.stage1.ast, concurrency: options.mode } }, outputRoot);
    if (options.scenario && options.scenario !== "cold") {
      const stage2Ast = route({ ...workload.stage2, repositoryScope: workload.repositoryScope,
        ast: { ...workload.stage2.ast, concurrency: options.mode } }, outputRoot).ast;
      const files = [...new Set([...compileQueryPlan(stage1Request.ast).uniqueFiles, ...compileQueryPlan(stage2Ast).uniqueFiles])].sort();
      const selected = options.scenario === "warm" ? files : files.filter((_, index) => index % 2 === 0);
      await analyzeFiles(selected, { cache: stage1Request.ast.cache, concurrency: 1 });
    }
    const first = await runStage(runtime, 1, stage1Request);
    const secondTransition = path.join(outputRoot, "stage1.json");
    const create = require(path.join(runtime, "scripts/shared/artifacts/src/canonical/result.js")).createCanonicalStageResult;
    fs.writeFileSync(secondTransition, JSON.stringify(create({ facts: first.result, factsPrepared: true, input: stage1Request })));
    const stage2Request = route({ ...workload.stage2, transitionArtifact: secondTransition, repositoryScope: workload.repositoryScope, ast: { ...workload.stage2.ast, concurrency: options.mode } }, outputRoot);
    delete stage2Request.ownershipGraphArtifact; delete stage2Request.boundaryArtifact;
    const second = await runStage(runtime, 2, stage2Request);
    return { mode: options.mode, stages: [first.metrics, second.metrics], maxRssKiB: process.resourceUsage().maxRSS, maxRssBytes: process.resourceUsage().maxRSS * 1024 };
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
}

function runChild(runtime, workload, mode, scenario) {
  const args = [__filename, "--child", "1", "--runtime", runtime, "--workload", workload, "--mode", String(mode)];
  if (scenario) args.push("--scenario", scenario);
  const result = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Parallel AST sample failed for concurrency ${mode}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function summarize(samples) {
  return [1, 2].map((stage, index) => {
    const rows = samples.map(sample => sample.stages[index]);
    return { stage, wallMs: median(rows.map(row => row.wallMs)), astMs: median(rows.map(row => row.astMs)), evidenceMs: median(rows.map(row => row.evidenceMs)), residualMs: median(rows.map(row => row.residualMs)),
      files: [...new Set(rows.map(row => row.files))], queries: [...new Set(rows.map(row => row.queries))], sourceChecks: [...new Set(rows.map(row => row.sourceChecks))],
      cacheHits: [...new Set(rows.map(row => row.cacheHits))], cacheMisses: [...new Set(rows.map(row => row.cacheMisses))],
      semanticDigests: [...new Set(rows.map(row => row.semanticDigest))], qualityDigests: [...new Set(rows.map(row => row.qualityDigest))] };
  });
}

const combinedAst = summary => summary.reduce((sum, stage) => sum + stage.astMs, 0);
const gain = (baseline, current) => (baseline - current) / baseline * 100;
const implementationFiles = [
  "scripts/shared/ast/src/analysis/analysis.js", "scripts/shared/ast/src/analysis/parallel_analysis.js", "scripts/shared/ast/src/analysis/analysis_worker.js",
  "scripts/shared/ast/src/batch/batch.js", "scripts/shared/ast/src/prototype_ast.js", "scripts/steps/step-1/src/runner.js", "scripts/steps/step-2/src/runner.js",
  "scripts/flows/full-flow/src/stage_pipeline.js", "scripts/cli/src/commands/ast_batch.js", "scripts/cli/src/commands/prototype_ast.js",
  "scripts/cli/src/commands/stage1_runner.js", "scripts/cli/src/commands/stage2_runner.js",
];
function implementationDigest(runtime) {
  return digest(implementationFiles.map(file => `${file}\0${digest(fs.readFileSync(path.join(runtime, file)))}`).join("\n"));
}

function comparable(left, right) {
  return left.every((stage, index) => {
    const other = right[index];
    return stage.semanticDigests.length === 1 && other.semanticDigests.length === 1
      && stage.semanticDigests[0] === other.semanticDigests[0]
      && stage.qualityDigests.length === 1 && other.qualityDigests.length === 1
      && stage.qualityDigests[0] === other.qualityDigests[0]
      && JSON.stringify({ files: stage.files, queries: stage.queries, sourceChecks: stage.sourceChecks, cacheHits: stage.cacheHits, cacheMisses: stage.cacheMisses })
        === JSON.stringify({ files: other.files, queries: other.queries, sourceChecks: other.sourceChecks, cacheHits: other.cacheHits, cacheMisses: other.cacheMisses });
  });
}

function gitState(root) {
  const run = args => spawnSync("git", ["-C", root, ...args], { encoding: null, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const head = run(["rev-parse", "HEAD"]), diff = run(["diff", "--binary", "HEAD", "--", "."]), untracked = run(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (head.status || diff.status || untracked.status) throw new Error(`Cannot capture repository state: ${root}`);
  const extra = untracked.stdout.toString("utf8").split("\0").filter(Boolean).sort().flatMap(name => [Buffer.from(`${name}\0`), fs.readFileSync(path.join(root, name))]);
  return { root: path.resolve(root), head: head.stdout.toString("utf8").trim(), worktreeDigest: digest(Buffer.concat([diff.stdout, ...extra])) };
}

async function runAb(options) {
  const baseline = path.resolve(options.baseline), current = path.resolve(options.current), workload = path.resolve(options.workload);
  const scenarios = ["warm", "cold", "mixed"], series = [];
  for (let seriesIndex = 0; seriesIndex < 2; seriesIndex += 1) {
    const rows = {};
    for (const scenario of scenarios) {
      for (let count = 0; count < options.warmup; count += 1) {
        runChild(baseline, workload, 2, scenario); runChild(current, workload, 2, scenario);
        if (scenario === "cold") runChild(current, workload, 1, scenario);
      }
      const a = [], b = [], sequential = [];
      for (let round = 0; round < options.runs; round += 1) {
        const order = (seriesIndex + round) % 2 ? [current, baseline] : [baseline, current];
        for (const runtime of order) (runtime === baseline ? a : b).push(runChild(runtime, workload, 2, scenario));
        if (scenario === "cold") sequential.push(runChild(current, workload, 1, scenario));
        process.stderr.write(`series ${seriesIndex + 1} ${scenario}: ${round + 1}/${options.runs}\n`);
      }
      rows[scenario] = { baseline: { samples: a, summary: summarize(a) }, current: { samples: b, summary: summarize(b) },
        ...(scenario === "cold" ? { currentSequential: { samples: sequential, summary: summarize(sequential) } } : {}) };
    }
    series.push({ scenarios: rows });
  }
  const comparisons = series.map((row, index) => {
    const warm = row.scenarios.warm, cold = row.scenarios.cold, mixed = row.scenarios.mixed;
    return { series: index + 1,
      comparable: scenarios.every(name => comparable(row.scenarios[name].baseline.summary, row.scenarios[name].current.summary)),
      warmGainPercent: gain(combinedAst(warm.baseline.summary), combinedAst(warm.current.summary)),
      mixedGainPercent: gain(combinedAst(mixed.baseline.summary), combinedAst(mixed.current.summary)),
      coldGainPercent: gain(combinedAst(cold.baseline.summary), combinedAst(cold.current.summary)),
      currentColdParallelGainPercent: gain(combinedAst(cold.currentSequential.summary), combinedAst(cold.current.summary)) };
  });
  const workloadBytes = fs.readFileSync(workload), workloadData = JSON.parse(workloadBytes);
  const result = { schemaVersion: "parallel-ast-ab/1.0.0", generatedAt: new Date().toISOString(),
    methodology: { modes: ["warm", "cold", "mixed"], concurrency: 2, coldSequentialControl: 1, series: 2,
      warmup: options.warmup, measuredRuns: options.runs, execution: "isolated child and cache per sample; A/B alternated with reversed series start; seeding excluded from measured runner interval" },
    provenance: { baseline, current, baselineCommit: "e761e44", harnessDigest: digest(fs.readFileSync(__filename)), workloadDigest: digest(workloadBytes),
      baselineImplementationDigest: implementationDigest(baseline), currentImplementationDigest: implementationDigest(current),
      repositories: workloadData.repositoryScope.repositories.map(repository => gitState(repository.root)),
      environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model || "unknown" } },
    comparisons, series };
  fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ comparisons })}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.child) { process.stdout.write(`${JSON.stringify(await childSample({ ...options, mode: Number(options.mode) }))}\n`); return; }
  if (options.baseline || options.current) { await runAb(options); return; }
  const runtime = path.resolve(options.runtime), workloadPath = path.resolve(options.workload), workloadBytes = fs.readFileSync(workloadPath), workload = JSON.parse(workloadBytes), modes = [1, 2, 4];
  const series = [];
  for (let seriesIndex = 0; seriesIndex < 2; seriesIndex += 1) {
    for (const mode of modes) for (let count = 0; count < options.warmup; count += 1) runChild(runtime, workloadPath, mode);
    const samples = Object.fromEntries(modes.map(mode => [mode, []]));
    for (let round = 0; round < options.runs; round += 1) {
      const offset = round % modes.length, rotated = [...modes.slice(offset), ...modes.slice(0, offset)];
      const order = seriesIndex ? [...rotated].reverse() : rotated;
      for (const mode of order) samples[mode].push(runChild(runtime, workloadPath, mode));
      process.stderr.write(`series ${seriesIndex + 1}: ${round + 1}/${options.runs}\n`);
    }
    series.push({ modes: Object.fromEntries(modes.map(mode => [mode, { samples: samples[mode], summary: summarize(samples[mode]), maxRssKiB: median(samples[mode].map(sample => sample.maxRssKiB)) }])) });
  }
  const result = { schemaVersion: "parallel-ast-benchmark/1.0.0", generatedAt: new Date().toISOString(), methodology: { modes, series: 2, warmup: options.warmup, measuredRuns: options.runs, sampleIsolation: "one child process and one unique cold cache per mode/sample", rss: "child process.resourceUsage().maxRSS; KiB and normalized bytes; diagnostic only" }, provenance: { harnessDigest: digest(fs.readFileSync(__filename)), workloadDigest: digest(workloadBytes), implementationDigest: implementationDigest(runtime), repositories: workload.repositoryScope.repositories.map(repository => gitState(repository.root)), environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model || "unknown" } }, series };
  fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) void main();
module.exports = { childSample, combinedAst, comparable, digest, gain, implementationDigest, median, parseArgs, semantic, summarize };
