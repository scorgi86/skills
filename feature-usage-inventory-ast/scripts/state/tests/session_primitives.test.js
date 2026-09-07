"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { initialState } = require("../src/state_model.js");
const transitions = require("../src/model/transitions.js");
const { StateStore } = require("../src/persistence/state_store.js");
const { InventorySession } = require("../src/session/inventory_session.js");
const { renameWithRetry } = require("../src/file_transaction.js");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-session-"));
  const stateFile = path.join(directory, "state.json");
  fs.writeFileSync(stateFile, `${JSON.stringify(initialState(), null, 2)}\n`);
  return { directory, stateFile };
}

test("transitions return a valid copy without mutating their input", () => {
  const state = initialState();
  const next = transitions.continueRun(state);
  assert.notStrictEqual(next, state);
  assert.equal(state.execution.continuationCount, 0);
  assert.equal(next.execution.continuationCount, 1);
  assert.equal(next.schemaVersion, "4.0.0");
});

test("stage context is deeply immutable and isolated from the session draft", () => {
  const { directory, stateFile } = fixture();
  try {
    const session = InventorySession.open({ stateFile });
    const context = session.createStageContext({ stage: 0, transition: null, lineage: [], repositoryScope: [], previous: null, readers: {} });
    assert.deepEqual(Object.keys(context).sort(), ["lineage", "mode", "previous", "readers", "repositoryScope", "stage", "state", "transition"]);
    assert.equal(context.mode, "stateful");
    assert.throws(() => { context.state.execution.runStatus = "complete"; }, TypeError);
    const draft = session.update(transitions.continueRun);
    assert.equal(draft.execution.continuationCount, 1);
    assert.equal(context.state.execution.continuationCount, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("StateStore commits atomically when the snapshot is current", () => {
  const { directory, stateFile } = fixture();
  try {
    const store = new StateStore(stateFile);
    const snapshot = store.load();
    const committed = store.commit(snapshot, transitions.continueRun(snapshot.state));
    assert.equal(committed.state.execution.continuationCount, 1);
    assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).execution.continuationCount, 1);
    assert.notEqual(committed.digest, snapshot.digest);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("StateStore rejects a stale snapshot under the inventory lock", () => {
  const { directory, stateFile } = fixture();
  try {
    const first = new StateStore(stateFile);
    const second = new StateStore(stateFile);
    const stale = second.load();
    const current = first.load();
    first.commit(current, transitions.continueRun(current.state));
    assert.throws(
      () => second.commit(stale, transitions.stopRun(stale.state, { reason: "stale", progressDigest: "x" })),
      /State conflict/
    );
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("StateStore creates a validated state without overwriting an existing file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-create-"));
  const stateFile = path.join(directory, "nested", "state.json");
  try {
    const store = new StateStore(stateFile);
    const created = store.create(initialState());
    assert.equal(created.state.currentStage, 0);
    const before = fs.readFileSync(stateFile);
    assert.throws(() => store.create(initialState("adaptive")), /already exists/i);
    assert.deepEqual(fs.readFileSync(stateFile), before);
    assert.deepEqual(fs.readdirSync(path.dirname(stateFile)), ["state.json"]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("StateStore validates before creating destination directories", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-create-invalid-"));
  const stateFile = path.join(directory, "not-created", "state.json");
  try {
    assert.throws(() => new StateStore(stateFile).create({ schemaVersion: "invalid" }));
    assert.equal(fs.existsSync(path.dirname(stateFile)), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("InventorySession keeps one snapshot and advances it after commit", () => {
  const { directory, stateFile } = fixture();
  try {
    const session = InventorySession.open({ stateFile });
    session.update(transitions.continueRun);
    const snapshot = session.commit();
    assert.equal(snapshot.state.execution.continuationCount, 1);
    assert.equal(session.state.execution.continuationCount, 1);
    assert.equal("isDirty" in session, false);
    assert.equal("store" in session, false);
    assert.equal("snapshot" in session, false);
    assert.equal("draft" in session, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("stateless session uses NullStateStore and never writes state", () => {
  const session = InventorySession.open();
  const context = session.createStageContext({ stage: 3, transition: "previous.json", lineage: [], repositoryScope: [], previous: null, readers: {} });
  assert.equal(context.mode, "stateless");
  assert.equal(context.state, null);
  session.update(transitions.continueRun);
  const snapshot = session.commit();
  assert.equal(snapshot.state.execution.continuationCount, 1);
  assert.equal(snapshot.digest, null);
});

test("atomic publication retries transient Windows rename contention", () => {
  let calls = 0;
  renameWithRetry("from", "to", () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("busy"), { code: "EPERM" });
  });
  assert.equal(calls, 3);
});
