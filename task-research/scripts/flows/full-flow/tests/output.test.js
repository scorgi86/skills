"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { defaultOutputRoot, runStagePipeline } = require("../src/stage_pipeline.js");
test("new Stage0 requires a declared coverage profile before creating output", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "profile-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "out"); let calls = 0;
  await assert.rejects(runStagePipeline({ outputRoot, request: { stage: 0, repositoryScope: { repositories: [{ id: "r", role: "source", root }] } }, runner: () => { calls++; } }), /coverageProfile/);
  assert.equal(calls, 0); assert.equal(fs.existsSync(outputRoot), false);
});
test("coverage requirements cannot drift from Stage0 lineage", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "profile-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = { stage: 0, target: "p", coverageProfile: { requiredCriticalPaths: ["save"] }, repositoryScope: { repositories: [{ id: "r", role: "source", root }] } };
  const result = await runStagePipeline({ outputRoot: root, request, runner: () => ({ stage: 0, status: "candidate" }) });
  await assert.rejects(runStagePipeline({ outputRoot: root, request: { ...request, stage: 1, transitionArtifact: result.artifact, coverageProfile: {} }, runner: () => { throw new Error("runner must not execute"); } }), /coverageProfile conflicts/);
});
test("different Unicode targets get different default artifact directories", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "output-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = { repositoryScope: { repositories: [{ id: "repo", root, role: "source" }] } };
  assert.notEqual(defaultOutputRoot({ ...request, target: "Копирование" }, root), defaultOutputRoot({ ...request, target: "Вставка" }, root));
});
test("unwritable artifact destination is rejected before research", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "output-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "occupied"); fs.writeFileSync(outputRoot, "keep");
  let calls = 0;
  await assert.rejects(runStagePipeline({ outputRoot, request: { stage: 0, target: "x", coverageProfile: {}, repositoryScope: { repositories: [{ id: "r", root, role: "source" }] } }, runner: () => { calls++; } }), /output|artifact/i);
  assert.equal(calls, 0); assert.equal(fs.readFileSync(outputRoot, "utf8"), "keep");
});

