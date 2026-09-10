"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { runAstBatch } = require("../shared/ast/src/batch/batch.js");
const { runEvidenceChecks } = require("../shared/evidence/src/collection/source_evidence.js");
const { SourceSnapshotStore } = require("../shared/evidence/src/source_snapshot.js");
const { prepareFacts } = require("../shared/artifacts/src/canonical/facts.js");
const canonical = require("../shared/evidence/index.js").stage2_canonicalize;
const { remapEvidenceReferences } = require("../shared/evidence/src/canonicalization/canonicalize.js");

const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const median = values => { const sorted = [...values].sort((a, b) => a - b), m = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; };
const timed = fn => { const start = performance.now(), value = fn(); return { value, ms: performance.now() - start }; };

function candidates(facts) {
  const repository = facts.repository || "", parts = [];
  parts.push(...facts.canonicalEvidence || [], ...canonical.candidatesFromSourceEvidence(facts.sourceEvidence, repository));
  if ([1, 2].includes(Number(facts.stage))) parts.push(...canonical.candidatesFromAst(facts.ast, repository),
    ...canonical.candidatesFromGitNexus(facts.gitnexus, repository), ...canonical.candidatesFromBoundaries(facts.boundaries, repository),
    ...canonical.candidatesFromOwnership(facts.ownership, repository), ...canonical.candidatesFromOwnership(facts.ownershipGraph, repository));
  return parts;
}

function sample(facts) {
  const adapted = timed(() => candidates(facts));
  let reads = 0, readMs = 0;
  const snapshots = new SourceSnapshotStore({ readFileSync(file) { const start = performance.now(); const bytes = fs.readFileSync(file); readMs += performance.now() - start; reads += 1; return bytes; } });
  const normalized = timed(() => canonical.canonicalizeStage2Candidates(adapted.value, { repositoryScope: facts.repositoryScope, exclusions: facts.exclusions, sourceSnapshots: snapshots }));
  const remapped = timed(() => remapEvidenceReferences(facts, normalized.value.evidenceIdMap));
  const prepared = timed(() => prepareFacts(facts, { sourceSnapshots: new SourceSnapshotStore() }));
  const serialized = timed(() => JSON.stringify(prepared.value));
  return { candidateCount: adapted.value.length, evidenceCount: normalized.value.evidence.length, adapterMs: adapted.ms,
    canonicalizeMs: normalized.ms, sourceReads: reads, sourceReadMs: readMs, remapMs: remapped.ms,
    prepareFactsMs: prepared.ms, serializeMs: serialized.ms, semanticDigest: digest(prepared.value) };
}

async function buildFacts(workload, stage, cache) {
  const request = workload[`stage${stage}`];
  const ast = await runAstBatch({ ...request.ast, concurrency: 2, cache });
  const sourceEvidence = runEvidenceChecks({ ...(request.evidence || { checks: [] }), retainAllMatches: true });
  return { ...request, stage, repository: "sdkjs", repositoryScope: workload.repositoryScope, ast, sourceEvidence };
}

async function main(argv = process.argv.slice(2)) {
  const at = name => { const index = argv.indexOf(name); return index < 0 ? null : argv[index + 1]; };
  const input = path.resolve(at("--input") || path.join(__dirname, "../../references/benchmarks/internal-shadows-stage12-workload-20260909.json"));
  const output = path.resolve(at("--output") || path.join(__dirname, "../../references/benchmarks/internal-shadows-canonicalization-profile-20260910.json"));
  const runs = Number(at("--runs") || 15), bytes = fs.readFileSync(input), workload = JSON.parse(bytes);
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-profile-"));
  try {
    const stages = [];
    for (const stage of [1, 2]) {
      const facts = await buildFacts(workload, stage, path.join(cacheRoot, "ast"));
      sample(facts);
      const samples = Array.from({ length: runs }, () => sample(facts));
      const metrics = ["adapterMs", "canonicalizeMs", "sourceReads", "sourceReadMs", "remapMs", "prepareFactsMs", "serializeMs"];
      stages.push({ stage, candidateCount: samples[0].candidateCount, evidenceCount: samples[0].evidenceCount,
        medians: Object.fromEntries(metrics.map(key => [key, median(samples.map(row => row[key]))])),
        semanticDigests: [...new Set(samples.map(row => row.semanticDigest))], samples });
    }
    const result = { schemaVersion: "canonicalization-profile/1.0.0", generatedAt: new Date().toISOString(),
      methodology: { workload: input, workloadDigest: crypto.createHash("sha256").update(bytes).digest("hex"), warmup: 1, runs,
        note: "Component measurements overlap; they are not additive. AST/evidence collection prepares fixed inputs and is outside samples." },
      environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model || "unknown" }, stages };
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { fs.rmSync(cacheRoot, { recursive: true, force: true }); }
}

if (require.main === module) void main();
module.exports = { candidates, median, sample };
