const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runStagePipeline } = require("../src/stage_pipeline.js");
const { main: state } = require("../../../state/src/stage_state.js");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "state.json");
  state(["init", "--state", stateFile]);
  return { root, stateFile, request: { stage: 0, coverageProfile: {}, target: "Feature", repositoryScope: { repositories: [{ id: "source", root, role: "source" }] } } };
}
test("partial can be retried in the same root, closed artifacts stay immutable", t => {
  const f = setup(t);
  const options = { ...f, outputRoot: f.root };
  assert.equal(runStagePipeline({ ...options, runner: () => ({ stage: 0, status: "partial" }) }).status, "partial");
  const result = runStagePipeline({ ...options, runner: () => ({ stage: 0, status: "candidate" }) });
  assert.equal(result.status, "closed");
  assert.equal(state(["status", "--state", f.stateFile]).currentStage, 1);
  const before = fs.readFileSync(result.artifact, "utf8");
  assert.throws(() => runStagePipeline({ ...options, runner: () => { throw new Error("must not run"); } }), /already|closed|current stage/i);
  assert.equal(fs.readFileSync(result.artifact, "utf8"), before);
});
