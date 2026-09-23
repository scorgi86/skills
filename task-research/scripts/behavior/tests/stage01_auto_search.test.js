"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runFullResearch } = require("../../flows/full-flow/src/full_run.js");
const { runStagePipeline } = require("../../flows/full-flow/src/stage_pipeline.js");
const { main: runState } = require("../../state/src/stage_state.js");

test("BDD: full_run searches Stage 1 from closed Stage 0 without an intermediate authored query", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage01-auto-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "sdk");
  fs.mkdirSync(repository);
  const source = path.join(repository, "model.js");
  fs.writeFileSync(source, "function FeatureValue() {}\n");
  const locale = path.join(repository, "locale.json");
  fs.writeFileSync(locale, '{"label":"FeatureValue"}\n');
  const scope = { repositories: [{ id: "sdk", root: repository, role: "source" }] };
  const pkg = { schemaVersion: "research-package/1.0.0", target: "FeatureValue", repositoryScope: scope,
    stages: Object.fromEntries(Array.from({ length: 8 }, (_, stage) => [String(stage), stage === 0
      ? { coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, seeds: { direct: ["FeatureValue"] } }
      : stage === 1 ? { searchFromStage0: true, gitnexus: { enabled: false, reason: "fixture" },
        ownership: { expectedIds: ["model"], groups: [{ id: "model", role: "model", object: "FeatureValue", relation: "defines", status: "candidate", anchor: { file: source, line: 1 } }] },
        coverageContract: { categories: [{ id: "direct-model", status: "applicable", groupIds: ["model"] }] } }
      : {}])) };
  const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "artifacts");
  let stage1Request;
  const result = await runFullResearch({ package: pkg, stateFile, outputRoot,
    runStagePipeline: async options => {
      if (options.request.stage === 2) return { status: "partial", stage: 2, artifact: null };
      if (options.request.stage === 1) stage1Request = options.request;
      return runStagePipeline(options);
    }
  });
  assert.equal(result.status, "partial");
  assert.equal(result.stage, 2);
  assert.deepEqual(stage1Request.ast.queries[0].files, [source]);
  assert.deepEqual(stage1Request.evidence.checks[0].files, [source]);
  const stage0 = JSON.parse(fs.readFileSync(path.join(outputRoot, "stage-0", "canonical", "stage-result.json")));
  assert.deepEqual(stage0.facts.filter(row => row.kind === "candidate-file").map(row => row.file).sort(), [locale, source].sort());
  const state = JSON.parse(fs.readFileSync(stateFile));
  assert.equal(state.currentStage, 2);
  assert.equal(state.lastCompletedStage, 1);
});

test("BDD: opt-in owner discovery stops at Stage 1 until graph review", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage01-owners-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "sdk");
  fs.mkdirSync(repository);
  const source = path.join(repository, "model.js");
  fs.writeFileSync(source, "function FeatureValue() {}\nfunction Holder() { this.value = new FeatureValue(); }\n");
  const pkg = { schemaVersion: "research-package/1.0.0", target: "FeatureValue",
    repositoryScope: { repositories: [{ id: "sdk", root: repository, role: "source" }] },
    stages: Object.fromEntries(Array.from({ length: 8 }, (_, stage) => [String(stage), stage === 0
      ? { coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, seeds: { direct: ["FeatureValue"] } }
      : stage === 1 ? { searchFromStage0: true, gitnexus: { enabled: false, reason: "fixture" },
        ownership: { autoCandidates: true, expectedIds: ["model"], groups: [{ id: "model", order: 0, role: "model", object: "FeatureValue", relation: "defines", anchor: { file: source, line: 1 } }] },
        coverageContract: { categories: [{ id: "direct-model", status: "applicable", groupIds: ["model"] }, { id: "owner-branches", status: "open", reason: "review pending", requiredBeforeClose: true }] } }
      : {}])) };
  const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "artifacts");
  const result = await runFullResearch({ package: pkg, stateFile, outputRoot,
    runStagePipeline: async options => options.request.stage === 2 ? { status: "partial", stage: 2, artifact: null } : runStagePipeline(options) });
  assert.equal(result.stage, 2);
  assert.equal(result.status, "partial");
  const canonical = JSON.parse(fs.readFileSync(path.join(outputRoot, "stage-1", "canonical", "stage-result.json")));
  assert.equal(canonical.status, "closed");
  assert.ok(canonical.facts.some(row => row.kind === "ownership-edge"));
  const generated = canonical.facts.filter(row => row.kind === "ownership" && row.id.startsWith("owner-"));
  assert.ok(generated.length > 0);
  assert.ok(generated.every(row => row.status === "confirmed" && row.evidenceRefs.length === 1));
  assert.ok(canonical.summary.ownerDiscovery.generatedIds.length > 0);
  assert.match(canonical.summary.ownerDiscovery.reviewDigest, /^[a-f0-9]{64}$/);
  const state = JSON.parse(fs.readFileSync(stateFile));
  assert.equal(state.currentStage, 2);
  assert.equal(state.lastCompletedStage, 1);
});

test("BDD: an incomplete Stage 0 scan cannot advance state", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-partial-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "artifacts");
  const request = { stage: 0, target: "Feature", coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] },
    repositoryScope: { repositories: [{ id: "sdk", root, role: "source" }] }, seeds: { direct: ["Feature"] } };
  runState(["init", "--state", stateFile]);
  const result = await runStagePipeline({ request, stateFile, outputRoot,
    dependencies: { spawn: () => { throw Object.assign(new Error("search denied"), { code: "EACCES" }); } } });
  assert.equal(result.status, "partial");
  assert.equal(result.stateChanged, false);
  const canonical = JSON.parse(fs.readFileSync(result.artifact));
  assert.match(canonical.summary.repos[0].reason, /search denied/);
  assert.equal(canonical.facts.some(row => row.status === "checked-no-usage"), false);
});

test("BDD: a Stage 0 candidate removed before Stage 1 does not advance state", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage01-stale-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "sdk");
  fs.mkdirSync(repository);
  const source = path.join(repository, "model.js");
  fs.writeFileSync(source, "function FeatureValue() {}\n");
  const scope = { repositories: [{ id: "sdk", root: repository, role: "source" }] };
  const pkg = { schemaVersion: "research-package/1.0.0", target: "FeatureValue", repositoryScope: scope,
    stages: Object.fromEntries(Array.from({ length: 8 }, (_, stage) => [String(stage), stage === 0
      ? { coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, seeds: { direct: ["FeatureValue"] } }
      : stage === 1 ? { searchFromStage0: true, gitnexus: { enabled: false, reason: "fixture" },
        ownership: { expectedIds: ["model"], groups: [{ id: "model", role: "model", object: "FeatureValue", relation: "defines", status: "candidate", anchor: { file: source, line: 1 } }] },
        coverageContract: { categories: [{ id: "direct-model", status: "applicable", groupIds: ["model"] }] } }
      : {}])) };
  const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "artifacts");
  const result = await runFullResearch({ package: pkg, stateFile, outputRoot,
    runStagePipeline: async options => {
      const stageResult = await runStagePipeline(options);
      if (options.request.stage === 0) fs.unlinkSync(source);
      return stageResult;
    }
  });
  assert.equal(result.status, "partial");
  assert.equal(result.stage, 1);
  const state = JSON.parse(fs.readFileSync(stateFile));
  assert.equal(state.currentStage, 1);
  assert.equal(state.lastCompletedStage, 0);
  const canonical = JSON.parse(fs.readFileSync(result.artifact));
  assert.equal(canonical.status, "partial");
  assert.equal(canonical.facts.some(row => row.status === "checked-no-usage"), false);
});
