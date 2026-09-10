"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { runEvidenceChecks } = require("../shared/evidence/src/collection/source_evidence.js");
const { SourceSnapshotStore } = require("../shared/evidence/src/source_snapshot.js");
const { prepareFacts } = require("../shared/artifacts/src/canonical/facts.js");

const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function confirmedEvidence(sourceEvidence) {
  return { ...sourceEvidence, checks: sourceEvidence.checks.map(check => ({ ...check,
    fullMatches: (check.fullMatches || check.matches || []).map(match => ({ ...match, status: "source-confirmed",
      confirmation: { status: "source-confirmed", evidenceRefs: [check.id], sourceHash: match.sourceHash,
        line: match.line, endLine: match.endLine, sourceFragment: match.sourceFragment } }))
  })) };
}

function sample(workload, mode) {
  let reads = 0;
  const makeStore = () => new SourceSnapshotStore({ readFileSync(file) { reads += 1; return fs.readFileSync(file); } });
  const shared = makeStore();
  const started = performance.now();
  const sourceEvidence = confirmedEvidence(runEvidenceChecks({ ...workload.stage1.evidence, retainAllMatches: true }, { sourceSnapshots: shared }));
  const result = prepareFacts({ stage: 1, status: "candidate", repository: "sdkjs",
    repositoryScope: workload.repositoryScope, sourceEvidence }, { sourceSnapshots: mode === "shared" ? shared : makeStore() });
  return { wallMs: performance.now() - started, reads, semanticDigest: digest(result) };
}

function main(argv = process.argv.slice(2)) {
  const inputAt = argv.indexOf("--input"), outputAt = argv.indexOf("--output");
  const input = path.resolve(inputAt >= 0 ? argv[inputAt + 1] : path.join(__dirname, "../../references/benchmarks/internal-shadows-stage12-workload-20260909.json"));
  const output = outputAt >= 0 ? path.resolve(argv[outputAt + 1]) : null;
  const workload = JSON.parse(fs.readFileSync(input, "utf8"));
  for (let index = 0; index < 2; index++) { sample(workload, "isolated"); sample(workload, "shared"); }
  const samples = { isolated: [], shared: [] };
  for (let index = 0; index < 12; index++) {
    const order = index % 2 ? ["shared", "isolated"] : ["isolated", "shared"];
    for (const mode of order) samples[mode].push(sample(workload, mode));
  }
  const summary = Object.fromEntries(Object.entries(samples).map(([mode, rows]) => [mode, {
    medianWallMs: median(rows.map(row => row.wallMs)), medianReads: median(rows.map(row => row.reads)),
    semanticDigests: [...new Set(rows.map(row => row.semanticDigest))]
  }]));
  const result = { schemaVersion: "1.0.0", measuredAt: new Date().toISOString(), input,
    inputDigest: digest(workload), environment: { node: process.version, platform: process.platform, arch: process.arch },
    method: "2 warmups; 12 alternating samples per mode; isolated uses separate collection/canonicalization stores; shared uses one stage-scoped store",
    summary, gainPercent: (summary.isolated.medianWallMs - summary.shared.medianWallMs) / summary.isolated.medianWallMs * 100,
    semanticEqual: summary.isolated.semanticDigests.length === 1 && summary.shared.semanticDigests.length === 1
      && summary.isolated.semanticDigests[0] === summary.shared.semanticDigests[0], samples };
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, text); }
  process.stdout.write(text);
}

if (require.main === module) main();
module.exports = { confirmedEvidence, main, sample };
