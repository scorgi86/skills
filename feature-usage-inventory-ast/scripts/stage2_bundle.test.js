const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildStage2Bundle } = require("./stage2_bundle");
const { queryStageArtifacts } = require("./query_stage_artifacts");
const { validateStageBundle } = require("./validate_stage_bundle");
const { parseArgs: parseRunnerArgs } = require("./stage2_runner");

const fixture = path.resolve(__dirname, "../fixtures/prototype/high-fanout.js");

function facts() {
  return {
    schemaVersion: "2.0.0",
    stage: 2,
    status: "candidate",
    runtime: {
      planId: "qp-bundle-test",
      budgets: { factsBytes: 1024 * 1024, summaryBytes: 24576, evidenceBytes: 65536, reportBytes: 65536 },
      source: { repository: "fixture", gitHead: "abc123" },
      cache: { enabled: false, mode: "no-cache" },
    },
    transition: { fields: {
      target: "internal shadows",
      scope: "fixture",
      stage: "1",
      status: "complete",
      "confirmed evidence": "seed",
      "candidate evidence": "owners",
      "dictionary/graph/path state": "ready",
      "skipped/forbidden": "old artifacts",
      "open checks": "source confirmation",
      "next stage": "2",
    } },
    ast: {
      plan: { id: "qp-bundle-test", compiledBeforeParse: true, lateQueries: 0 },
      stats: { parseCounts: { [fixture]: 1 }, failed: 0 },
      results: [{
        id: "shadow-owner",
        command: "find",
        status: "candidate",
        groupDigest: "digest-ast",
        coverage: { groupsScanned: 1, groupsMatched: 1, groupsReturned: 1, detailsRequested: 1, detailsReturned: 1, detailsSuppressed: 0, detailEvidenceSuppressed: 0 },
        semanticGroups: [{ key: "internal-key", owner: "Shape", relation: "field-write", field: "innerShdw", target: "CInnerShdw", items: 1, evidence: 1, example: { file: fixture, line: 4 } }],
      }],
    },
    sourceEvidence: { checks: [{ id: "shadow-source", status: "candidate", filesScanned: 1, totalMatches: 1, returned: 1, truncated: false, groupDigest: "digest-source", groupsTotal: 1, groups: [{ key: "source-key", firstAnchor: { file: fixture, line: 4 } }], matches: [{ file: fixture, line: 4, snippet: "this.shadow = value" }], fullMatches: [{ file: fixture, line: 4, snippet: "this.shadow = value", patternId: "shadow", groupKey: "source-key" }], spec: { entries: [fixture], patterns: [{ id: "shadow", value: "shadow", regex: false, caseSensitive: false }], excludeDirs: [], excludeFilePatterns: [], followSymlinks: false } }] },
    quality: { coverageGate: { status: "passed", ok: true, errors: [], warnings: [] } },
    output: { bounded: true, overflow: false },
  };
}

test("stage 2 bundle is deterministic, linked and queryable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-bundle-test-"));
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  const firstSummary = buildStage2Bundle(facts(), first);
  const secondSummary = buildStage2Bundle(facts(), second);
  assert.ok(firstSummary.stdoutBytes < 4096);
  assert.equal(firstSummary.findings, 1);
  assert.equal(validateStageBundle(first).ok, true);
  for (const relative of ["report.md", "findings.jsonl", "evidence.jsonl.gz", "checks.json", "source-observations.jsonl.gz", "coverage.json", "transition.json", "validation.json", "manifest.json"]) {
    assert.deepEqual(fs.readFileSync(path.join(first, relative)), fs.readFileSync(path.join(second, relative)), relative);
  }
  const report = fs.readFileSync(path.join(first, "report.md"), "utf8");
  assert.match(report, /```mermaid/);
  assert.match(report, /\.\/manifest\.json/);
  assert.doesNotMatch(report, /internal-key|source-key|fn-[a-f0-9]+|ev-[a-f0-9]+/);
  const queried = queryStageArtifacts({ bundle: first, owner: "Shape", field: "innerShdw", limit: 10, includeEvidence: true });
  assert.equal(queried.totalMatched, 1);
  assert.ok(queried.evidence.length >= 1);
  assert.equal(queried.freshness.current, 1);
  assert.equal(JSON.stringify(queried).includes("internal-key"), false);
  const observations = require("node:zlib").gunzipSync(fs.readFileSync(path.join(first, "source-observations.jsonl.gz"))).toString("utf8").trim().split("\n").map(JSON.parse);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].source.line, 4);
});

test("bundle builder refuses overwrite and validator detects tampering", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-bundle-safety-"));
  const output = path.join(root, "bundle");
  buildStage2Bundle(facts(), output);
  assert.throws(() => buildStage2Bundle(facts(), output), /already exists/);
  fs.appendFileSync(path.join(output, "coverage.json"), " ");
  const checked = validateStageBundle(output);
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((item) => /mismatch/.test(item)));
});

test("stage2 runner accepts an approved bundle destination as the persistence route", () => {
  const options = parseRunnerArgs(["--request", "request.json", "--bundle", "new-bundle", "--stdout", "summary"]);
  assert.equal(options.bundle, "new-bundle");
  assert.equal(options.stdout, "summary");
  assert.throws(() => parseRunnerArgs(["--request", "request.json", "--stdout", "summary"]), /requires --output or --bundle/);
});
