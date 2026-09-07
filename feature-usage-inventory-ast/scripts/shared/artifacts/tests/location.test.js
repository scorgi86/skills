"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { writeStageArtifact } = require("../src/stage_artifact_v4.js");
const { queryStageArtifacts } = require("../src/query_stage_artifacts.js");
test("structured limitations survive Stage0 and canonicalization without stringification", t => {
  const { runStage0, render } = require("../../../steps/step-0/src/runner.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "limitations-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const limitation = { id: "sandbox", statement: "Index unavailable", detail: "EPERM", status: "partial" };
  const facts = runStage0({ stage: 0, target: "x", scanSeeds: false, seeds: { direct: ["x"] }, repositoryScope: { repositories: [{ id: "r", root, role: "source" }] }, limitations: [limitation] });
  assert.deepEqual(facts.limitations, [limitation]);
  const { canonical } = writeStageArtifact({ outputDir: root, facts, input: {} });
  assert.equal(canonical.facts.find(row => row.id === "sandbox").detail, "EPERM");
  assert.doesNotMatch(render(facts), /\[object Object\]/);
  assert.throws(() => runStage0({ stage: 0, target: "x", scanSeeds: false, seeds: { direct: ["x"] }, repositoryScope: facts.repositoryScope, limitations: [42] }), /limitation/);
});
test("artifact query accepts root, canonical directory and canonical files equally", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-location-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeStageArtifact({ outputDir: root, facts: { stage: 0, status: "candidate" }, input: {} });
  const expected = queryStageArtifacts({ artifact: root, limit: 20 });
  for (const suffix of ["canonical", "canonical/stage-result.json", "canonical/manifest.json"]) {
    assert.deepEqual(queryStageArtifacts({ artifact: path.join(root, suffix), limit: 20 }), expected);
  }
});
