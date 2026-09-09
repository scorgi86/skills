"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initialState } = require("../src/state_model.js");
const { InventorySession, isStageContext } = require("../src/session/inventory_session.js");

const CONTEXT_KEYS = ["lineage", "mode", "previous", "readers", "repositoryScope", "stage", "state", "transition"];

test("stateful StageContext is a narrow immutable projection", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "state.json");
  fs.writeFileSync(stateFile, `${JSON.stringify(initialState())}\n`);
  const context = InventorySession.open({ stateFile }).createStageContext({
    stage: 2, transition: { stage: 1, facts: [{ id: "untrusted" }] }, lineage: [{ stage: 1 }], repositoryScope: { repositories: [] }, previous: null, readers: { validatedPrior: [{}] }
  });

  assert.deepEqual(Object.keys(context).sort(), CONTEXT_KEYS);
  assert.equal(context.mode, "stateful");
  assert.equal(context.state.currentStage, 0);
  assert.equal(context.state.schemaVersion, undefined);
  assert.equal(context.state.activeArtifacts, undefined);
  assert.equal(context.transition, null);
  assert.deepEqual(context.lineage, []);
  assert.deepEqual(context.readers, {});
  assert.equal(isStageContext(context), true);
  assert.equal(isStageContext({ ...context }), false);
});

test("stateless StageContext explicitly has no persisted state", () => {
  const context = InventorySession.open().createStageContext({ stage: 3, transition: null });
  assert.deepEqual(Object.keys(context).sort(), CONTEXT_KEYS);
  assert.equal(context.mode, "stateless");
  assert.equal(context.state, null);
  assert.ok(Object.isFrozen(context));
});

test("a caller cannot mint trusted transition data through createStageContext", () => {
  const session = InventorySession.open();
  const context = session.createStageContext({ stage: 3, transition: { stage: 2, facts: [] }, readers: { transitionArtifact: "missing.json" } });
  assert.throws(() => require("../../steps/step-3/src/runner.js").runStage3(
    { stage: 3, transitionArtifact: "definitely-missing.json", consumerScopes: [] },
    { runEvidenceChecks: () => ({ checks: [] }) }, context
  ), /ENOENT/);
});
