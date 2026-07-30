"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildSummary, runStage5 } = require("./stage5_runner");

test("stage 5 retains full observations after bounded exact-name coverage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "critical-stage5-"));
  const source = path.join(root, "model.js");
  fs.writeFileSync(source, "renderShadow();\nrenderShadow();\n");
  const transition = path.join(root, "stage4.md");
  fs.writeFileSync(transition, ["- target: feature", "- scope: fixture", "- stage: 4", "- status: closed", "- confirmed evidence: state", "- candidate evidence: renderer", "- dictionary/graph/path state: ready", "- skipped/forbidden: none", "- open checks: paths", "- next stage: 5"].join("\n"));
  const result = runStage5({ stage: 5, transitionArtifact: transition, checks: [{ id: "path", file: source, pattern: "renderShadow" }], nameCoverage: { id: "renderer", scope: root, terms: ["renderShadow"] } }, {
    findExactNameCoverage: () => ({ id: "renderer", engine: "fixture", scope: root, terms: ["renderShadow"], filesScanned: 4, matchingFileCount: 1, matchingFiles: [source], fileDigest: "all", matchingFileDigest: "matches", query: {} }),
  });
  assert.equal(result.nameCoverage.filesScanned, 4);
  assert.equal(result.nameCoverage.totalMatches, 2);
  assert.equal(result.nameCoverage.fullObservationCount, 2);
  assert.equal(result.sourceEvidence.checks.find((check) => check.id === "renderer").fullMatches.length, 2);
  assert.equal(result.sourceEvidence.checks.find((check) => check.id === "renderer").spec.patterns.length, 1);
  const summary = buildSummary(result, path.join(root, "facts.json"));
  assert.equal(Object.hasOwn(summary, "sourceEvidence"), false);
  assert.equal(summary.nameCoverage.fullObservationCount, 2);
});
