"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { analyzeFiles } = require("../shared/ast/src/analysis/analysis.js");
const { compileQueryPlan, runAstBatch } = require("../shared/ast/src/batch/batch.js");
const { createIdentity } = require("../shared/ast/src/cache/identity.js");
const { readEntry } = require("../shared/ast/src/cache/storage.js");
const { parserOptions, swcVersion } = require("../shared/ast/src/parsing/parser.js");

const median = values => { const sorted = [...values].sort((a, b) => a - b), m = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; };
const timed = fn => { const start = performance.now(), value = fn(); return { value, ms: performance.now() - start }; };
const timedAsync = async fn => { const start = performance.now(), value = await fn(); return { value, ms: performance.now() - start }; };

function cacheParts(files, cache) {
  const source = timed(() => files.map(file => fs.readFileSync(file)));
  const identities = timed(() => files.map((file, index) => createIdentity(source.value[index], file,
    { name: "@swc/core", version: swcVersion, options: parserOptions(file) })));
  const serialized = timed(() => identities.value.map(identity => fs.readFileSync(path.join(cache, `${identity.key}.json`), "utf8")));
  const parsed = timed(() => serialized.value.map(JSON.parse));
  const validated = timed(() => identities.value.map(identity => readEntry(cache, identity)));
  return { sourceReadMs: source.ms, identityMs: identities.ms, fileCacheReadMs: serialized.ms,
    fileCacheParseMs: parsed.ms, fileCacheReadParseValidateMs: validated.ms,
    fileCacheBytes: serialized.value.reduce((sum, value) => sum + Buffer.byteLength(value), 0) };
}

function queryCacheParts(cache) {
  const directory = path.join(cache, "query-results");
  const files = fs.readdirSync(directory).filter(file => file.endsWith(".json"));
  const serialized = timed(() => files.map(file => fs.readFileSync(path.join(directory, file), "utf8")));
  const parsed = timed(() => serialized.value.map(JSON.parse));
  return { queryEntries: files.length, queryCacheReadMs: serialized.ms, queryCacheParseMs: parsed.ms,
    queryCacheBytes: serialized.value.reduce((sum, value) => sum + Buffer.byteLength(value), 0) };
}

async function sample(request, cache) {
  const files = compileQueryPlan(request).uniqueFiles;
  const sequential = await timedAsync(() => analyzeFiles(files, { cache, concurrency: 1 }));
  const analysis = await timedAsync(() => analyzeFiles(files, { cache, concurrency: 2 }));
  const postAnalysis = await timedAsync(() => runAstBatch(request, { analyzeFiles: async () => analysis.value }));
  const fullSequential = await timedAsync(() => runAstBatch({ ...request, concurrency: 1 }));
  const full = await timedAsync(() => runAstBatch(request));
  return { files: files.length, queries: request.queries.length, analysisSequentialMs: sequential.ms, analysisParallelMs: analysis.ms,
    analysisResultBytes: Buffer.byteLength(JSON.stringify(analysis.value.results)), postAnalysisMs: postAnalysis.ms,
    fullSequentialBatchMs: fullSequential.ms, fullParallelBatchMs: full.ms, ...cacheParts(files, cache), ...queryCacheParts(cache) };
}

async function main(argv = process.argv.slice(2)) {
  const arg = name => { const index = argv.indexOf(name); return index < 0 ? null : argv[index + 1]; };
  const input = path.resolve(arg("--input") || path.join(__dirname, "../../references/benchmarks/internal-shadows-stage12-workload-20260909.json"));
  const output = path.resolve(arg("--output") || path.join(__dirname, "../../references/benchmarks/internal-shadows-ast-cache-hit-profile-20260910.json"));
  const runs = Number(arg("--runs") || 15), bytes = fs.readFileSync(input), workload = JSON.parse(bytes);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ast-hit-profile-"));
  try {
    const stages = [];
    for (const stage of [1, 2]) {
      const cache = path.join(root, `stage-${stage}`), source = workload[`stage${stage}`].ast;
      const request = { ...source, cache, concurrency: 2 };
      await runAstBatch(request);
      await sample(request, cache);
      const samples = [];
      for (let index = 0; index < runs; index++) samples.push(await sample(request, cache));
      const metrics = Object.keys(samples[0]).filter(key => key.endsWith("Ms") || key.endsWith("Bytes") || ["files", "queries", "queryEntries"].includes(key));
      stages.push({ stage, medians: Object.fromEntries(metrics.map(key => [key, median(samples.map(row => row[key]))])), samples });
    }
    const result = { schemaVersion: "ast-cache-hit-profile/1.0.0", generatedAt: new Date().toISOString(),
      methodology: { workload: input, workloadDigest: crypto.createHash("sha256").update(bytes).digest("hex"), concurrency: 2, warmup: 1, runs,
        note: "Component probes overlap and are not additive; fullBatch includes analysis and post-analysis." },
      environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model || "unknown" }, stages };
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (require.main === module) void main();
module.exports = { cacheParts, median, queryCacheParts, sample };
