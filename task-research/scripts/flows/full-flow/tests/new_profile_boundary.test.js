"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runStage0 } = require("../../../steps/step-0/src/runner.js");
const { runStagePipeline } = require("../src/stage_pipeline.js");
const { runFullResearch, loadResearchPackage } = require("../src/full_run.js");
const { StateStore } = require("../../../state/src/persistence/state_store.js");
const { initialState } = require("../../../state/src/state_model.js");
const { IDS } = require("../../../shared/dto/src/capability_contract.js");
test("incomplete full profiles are rejected by all new entrances before writes", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "incomplete-full-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const profile of [
    { kind: "full-inventory", requiredCapabilities: [...IDS].slice(0, 8), requiredCollections: ["scenarios", "criticalPaths"] },
    { kind: "full-development", requiredCapabilities: [...IDS], requiredCollections: ["scenarios", "criticalPaths", "gaps"] }
  ]) {
    const request = { stage: 0, target: "Feature", seeds: { direct: ["Feature"] }, coverageProfile: profile, repositoryScope: { repositories: [{ id: "source", root, role: "source" }] } };
    const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "out");
    await assert.rejects(runStage0(request, { spawn: () => assert.fail("scan called") }), /requires/);
    await assert.rejects(runStagePipeline({ request, stateFile, outputRoot, runner: () => assert.fail("runner called") }), /requires/);
    const pkg = { schemaVersion: "research-package/1.0.0", target: request.target, repositoryScope: request.repositoryScope, stages: Object.fromEntries(Array.from({ length: 8 }, (_, stage) => [stage, stage ? {} : { coverageProfile: profile, seeds: request.seeds }])) };
    await assert.rejects(runFullResearch({ package: pkg, stateFile, outputRoot }), /requires/);
    assert.equal(fs.existsSync(stateFile), false);
    assert.equal(fs.existsSync(outputRoot), false);
  }
});
test("documented full profile examples pass the runtime package contract", () => {
  const references = path.resolve(__dirname, "../../../../references");
  const json = name => JSON.parse(fs.readFileSync(path.join(references, name), "utf8").match(/```json\s*([\s\S]*?)```/)[1]);
  const pkg = json("full-run-package.md");
  pkg.repositoryScope.repositories[0].root = references;
  assert.equal(loadResearchPackage(pkg).stages[0].coverageProfile.kind, "full-inventory");
  const { normalizeNewCoverageProfile } = require("../../../shared/report/src/model/coverage.js");
  assert.equal(normalizeNewCoverageProfile(json("report-contract.md")).kind, "full-inventory");
});
test("new public Stage 0 entrances reject missing kind before side effects", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "new-profile-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = { stage: 0, target: "Feature", seeds: { direct: ["Feature"] }, coverageProfile: { requiredCapabilities: ["ownership"] }, repositoryScope: { repositories: [{ id: "source", root, role: "source" }] } };
  const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "out");
  await assert.rejects(runStage0(request, { spawn: () => assert.fail("scan called") }), /explicit kind/);
  await assert.rejects(runStagePipeline({ request, stateFile, outputRoot, runner: () => assert.fail("runner called") }), /explicit kind/);
  const pkg = { schemaVersion: "research-package/1.0.0", target: request.target, repositoryScope: request.repositoryScope, stages: Object.fromEntries(Array.from({ length: 8 }, (_, stage) => [stage, stage ? {} : { coverageProfile: request.coverageProfile, seeds: request.seeds }])) };
  assert.equal(Object.hasOwn(loadResearchPackage(pkg).stages[0].coverageProfile, "kind"), false);
  await assert.rejects(runFullResearch({ package: pkg, stateFile, outputRoot }), /explicit kind/);
  assert.equal(fs.existsSync(stateFile), false);
  assert.equal(fs.existsSync(outputRoot), false);
  new StateStore(stateFile).create(initialState("continuous"));
  const before = fs.readFileSync(stateFile);
  await assert.rejects(runFullResearch({ package: pkg, stateFile, outputRoot }), /explicit kind/);
  assert.deepEqual(fs.readFileSync(stateFile), before);
  assert.equal(fs.existsSync(outputRoot), false);
});
