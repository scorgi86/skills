"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadResearchPackage, materializeStageRequest, planNextAction, runFullResearch } = require("../src/full_run.js");
const { runStagePipeline } = require("../src/stage_pipeline.js");

function packageValue(root) {
  return {
    schemaVersion: "research-package/1.0.0",
    target: "Feature",
    repositoryScope: { repositories: [{ id: "source", root, role: "source" }] },
    stages: Object.fromEntries(Array.from({ length: 8 }, (_, stage) => [String(stage), stage === 0 ? { coverageProfile: {} } : {}]))
  };
}

test("package loader normalizes roots, freezes templates, and rejects runtime fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-package-"));
  const file = path.join(root, "package.json");
  fs.writeFileSync(file, JSON.stringify(packageValue(root)));
  const value = loadResearchPackage(file);
  assert.equal(value.repositoryScope.repositories[0].root, path.resolve(root));
  assert.equal(Object.isFrozen(value.stages["0"]), true);
  assert.throws(() => loadResearchPackage({ ...packageValue(root), stages: { ...packageValue(root).stages, "2": { transitionArtifact: "manual" } } }), /transitionArtifact/);
  assert.throws(() => loadResearchPackage({ ...packageValue(root), stages: { "0": { coverageProfile: {} } } }), /stages 0 through 7/);
});

test("action planner follows persisted state without rerunning closed stages", () => {
  assert.deepEqual(planNextAction(null), { kind: "run-stage", stage: 0 });
  assert.deepEqual(planNextAction({ currentStage: 3, lastCompletedStage: 2, execution: { runStatus: "running" } }), { kind: "run-stage", stage: 3 });
  assert.deepEqual(planNextAction({ currentStage: 8, lastCompletedStage: 7, execution: { runStatus: "running" } }), { kind: "run-stage-8", stage: 8 });
  assert.deepEqual(planNextAction({ currentStage: 9, lastCompletedStage: 8, execution: { runStatus: "running" } }), { kind: "complete-run" });
  assert.deepEqual(planNextAction({ currentStage: 9, lastCompletedStage: 8, execution: { runStatus: "complete" } }), { kind: "already-complete" });
  assert.deepEqual(planNextAction({ currentStage: 4, lastCompletedStage: 3, execution: { runStatus: "stopped" } }), { kind: "stop", reason: "state-stopped" });
});

test("materializer derives lineage and selector artifacts from active state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-materialize-"));
  const pkg = loadResearchPackage({ ...packageValue(root), stages: { ...packageValue(root).stages,
    "7": { evidenceSelectors: [{ stage: 2, limit: 12 }] }
  } });
  const artifacts = Array.from({ length: 7 }, (_, stage) => ({ stage, artifact: path.join(root, `stage-${stage}.json`) }));
  const state = { currentStage: 7, lastCompletedStage: 6, canonicalArtifact: artifacts[6].artifact, activeArtifacts: artifacts };
  const request = materializeStageRequest(pkg, 7, state);
  assert.equal(request.transitionArtifact, artifacts[6].artifact);
  assert.deepEqual(request.priorArtifacts, artifacts.map(row => row.artifact));
  assert.deepEqual(request.evidenceSelectors, [{ artifact: artifacts[2].artifact, limit: 12 }]);
  assert.equal(pkg.stages["7"].evidenceSelectors[0].artifact, undefined);
});

test("coordinator retries a partial stage and rejects scope drift before another runner call", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageFile = path.join(root, "package.json"), stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "output");
  fs.writeFileSync(packageFile, JSON.stringify(packageValue(root)));
  let calls = 0;
  const controlledPipeline = options => runStagePipeline({ ...options, runner: request => {
    calls += 1;
    return { stage: request.stage, target: request.target, status: calls === 2 ? "candidate" : "partial" };
  } });
  assert.equal((await runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: controlledPipeline })).status, "partial");
  assert.equal((await runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: controlledPipeline })).stage, 1);
  const metrics = JSON.parse(fs.readFileSync(path.join(outputRoot, "full-run-metrics.json"), "utf8"));
  assert.deepEqual(metrics.stages.map(row => row.action), ["run-stage", "retry-partial", "run-stage"]);
  const other = path.join(root, "other"); fs.mkdirSync(other);
  fs.writeFileSync(packageFile, JSON.stringify(packageValue(other)));
  const before = calls;
  await assert.rejects(runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: controlledPipeline }), /repositoryScope conflicts/);
  assert.equal(calls, before);
});

test("continuation rejects target drift and Stage 0 partial coverage drift", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-contract-drift-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageFile = path.join(root, "package.json"), stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "output");
  const original = packageValue(root);
  fs.writeFileSync(packageFile, JSON.stringify(original));
  let calls = 0;
  const partialPipeline = options => runStagePipeline({ ...options, runner: request => { calls += 1; return { stage: request.stage, target: request.target, status: "partial" }; } });
  await runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: partialPipeline });
  fs.writeFileSync(packageFile, JSON.stringify({ ...original, target: "Other" }));
  await assert.rejects(runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: partialPipeline }), /target conflicts/);
  fs.writeFileSync(packageFile, JSON.stringify({ ...original, stages: { ...original.stages, "0": { coverageProfile: { requiredCollections: ["ownership"] } } } }));
  await assert.rejects(runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: partialPipeline }), /coverageProfile conflicts/);
  assert.equal(calls, 1);
});
