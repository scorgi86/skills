"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runStagePipeline } = require("../../flows/full-flow/src/stage_pipeline.js");
const { main: state } = require("../../state/src/stage_state.js");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "state.json");
  state(["init", "--state", stateFile]);
  return { root, stateFile, request: { stage: 0, coverageProfile: {}, target: "Feature", repositoryScope: { repositories: [{ id: "source", root, role: "source" }] } } };
}

test("a partial stage can be retried and a closed stage remains immutable", t => {
  const fixture = setup(t);
  const options = { ...fixture, outputRoot: fixture.root };
  assert.equal(runStagePipeline({ ...options, runner: () => ({ stage: 0, status: "partial" }) }).status, "partial");
  const result = runStagePipeline({ ...options, runner: () => ({ stage: 0, status: "candidate" }) });
  assert.equal(result.status, "closed");
  assert.equal(state(["status", "--state", fixture.stateFile]).currentStage, 1);
  const before = fs.readFileSync(result.artifact, "utf8");
  assert.throws(() => runStagePipeline({ ...options, runner: () => { throw new Error("must not run"); } }), /already|closed|current stage/i);
  assert.equal(fs.readFileSync(result.artifact, "utf8"), before);
});

test("a partial stage publishes while the state lock is held elsewhere", t => {
  const fixture = setup(t);
  fs.writeFileSync(`${fixture.stateFile}.lock`, "state-command");
  const result = runStagePipeline({ ...fixture, outputRoot: fixture.root, runner: () => ({ stage: 0, status: "partial" }) });
  assert.equal(result.status, "partial");
  assert.equal(result.stateChanged, false);
  assert.equal(state(["status", "--state", fixture.stateFile]).currentStage, 0);
  assert.equal(fs.readFileSync(`${fixture.stateFile}.lock`, "utf8"), "state-command");
});
