"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { main } = require("./stage_state");
const { normalizeReportModel } = require("./report_model");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-state-"));
  const state = path.join(directory, "inventory-state.json");
  const artifact = path.join(directory, "artifact.md");
  fs.writeFileSync(artifact, "# artifact\n");
  return { state, artifact };
}

test("canonical stages advance only in order", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state, "--mode", "adaptive"]);
  assert.equal(main(["assert", "--state", state, "--stage", "0"]).currentStage, 0);
  assert.throws(() => main(["assert", "--state", state, "--stage", "1"]), /blocked/);
  const advanced = main(["advance", "--state", state, "--stage", "0", "--artifact", artifact]);
  assert.equal(advanced.currentStage, 1);
  assert.deepEqual(advanced.execution.stagesCompletedThisRun, [0]);
  assert.equal(main(["assert", "--state", state, "--stage", "1"]).lastCompletedStage, 0);
});

test("bounded probes attach evidence without advancing canonical state", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state, "--mode", "strict"]);
  const attached = main(["attach-probe", "--state", state, "--parent-stage", "0", "--artifact", artifact, "--id", "scope-check"]);
  assert.equal(attached.currentStage, 0);
  assert.equal(attached.probes[0].id, "scope-check");
  assert.throws(() => main(["attach-probe", "--state", state, "--parent-stage", "1", "--artifact", artifact]), /blocked/);
});

test("adoption resumes a verified historical facts artifact without rerunning stages", () => {
  const { state, artifact } = fixture();
  fs.writeFileSync(artifact, JSON.stringify({ stage: 4 }));
  const adopted = main(["adopt", "--state", state, "--mode", "continuous", "--completed-stage", "4", "--artifact", artifact]);
  assert.equal(adopted.currentStage, 5);
  assert.equal(adopted.execution.mode, "continuous");
  assert.throws(() => main(["adopt", "--state", `${state}.other`, "--mode", "strict", "--completed-stage", "3", "--artifact", artifact]), /does not match/);
});

test("stage 7 cannot advance with a non-canonical artifact", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state, "--mode", "strict"]);
  for (let stage = 0; stage < 7; stage += 1) main(["advance", "--state", state, "--stage", String(stage), "--artifact", artifact]);
  fs.writeFileSync(artifact, JSON.stringify({ stage: 7, status: "closed" }));
  assert.throws(() => main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]), /cannot advance/);
  assert.equal(main(["status", "--state", state]).currentStage, 7);
});

test("stage 7 closure records the trusted model digest", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state, "--mode", "strict"]);
  for (let stage = 0; stage < 7; stage += 1) main(["advance", "--state", state, "--stage", String(stage), "--artifact", artifact]);
  const model = normalizeReportModel({ target: "X", capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-1"] }], evidenceIndex: [{ id: "ev-1", file: "a.js" }], confirmedUsages: [{ id: "use-1", evidenceRefs: ["ev-1"] }], transition: { "next stage": "8" } });
  fs.writeFileSync(artifact, JSON.stringify(model));
  const advanced = main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]);
  assert.equal(advanced.currentStage, 8);
  assert.equal(advanced.canonicalDigest, model.integrity.canonicalDigest);
});

test("new inventories require an explicit execution mode", () => {
  const { state } = fixture();
  assert.throws(() => main(["init", "--state", state]), /requires an explicit execution mode/);
  assert.throws(() => main(["init", "--state", state, "--mode", "fast"]), /strict, adaptive, or continuous/);
});

test("legacy state migrates to strict mode without changing canonical progress", () => {
  const { state, artifact } = fixture();
  fs.writeFileSync(state, JSON.stringify({
    schemaVersion: "1.0.0",
    lastCompletedStage: 0,
    currentStage: 1,
    canonicalArtifact: artifact,
    canonicalDigest: null,
    probes: [],
    openChecks: [],
  }));
  const migrated = main(["status", "--state", state]);
  assert.equal(migrated.execution.mode, "strict");
  assert.equal(migrated.currentStage, 1);
  assert.equal(JSON.parse(fs.readFileSync(state, "utf8")).schemaVersion, "3.0.0");
  assert.equal(migrated.execution.driver, "interactive");
});

test("schema 2 state preserves mode and migrates to interactive driver", () => {
  const { state, artifact } = fixture();
  fs.writeFileSync(state, JSON.stringify({
    schemaVersion: "2.0.0",
    execution: { mode: "adaptive", stagesCompletedThisRun: [0], stopReason: null },
    lastCompletedStage: 0,
    currentStage: 1,
    canonicalArtifact: artifact,
    canonicalDigest: null,
    probes: [],
    openChecks: [],
  }));
  const migrated = main(["status", "--state", state]);
  assert.equal(migrated.execution.mode, "adaptive");
  assert.equal(migrated.execution.driver, "interactive");
});

test("goal state requires and verifies objective digest across continuations", () => {
  const { state } = fixture();
  assert.throws(() => main(["init", "--state", state, "--mode", "continuous", "--driver", "goal"]), /objective-digest/);
  const initialized = main(["init", "--state", state, "--mode", "continuous", "--driver", "goal", "--objective-digest", "goal-a"]);
  assert.equal(initialized.execution.driver, "goal");
  const continued = main(["continue-run", "--state", state, "--objective-digest", "goal-a"]);
  assert.equal(continued.execution.continuationCount, 1);
  assert.throws(() => main(["continue-run", "--state", state, "--objective-digest", "goal-b"]), /changed/);
});

test("goal blocks after three identical no-progress stops and resets on advance", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state, "--mode", "strict", "--driver", "goal", "--objective-digest", "goal-a"]);
  for (let index = 0; index < 2; index += 1) {
    const stopped = main(["stop-run", "--state", state, "--reason", "missing-source", "--progress-digest", "same"]);
    assert.equal(stopped.execution.runStatus, "stopped");
  }
  const blocked = main(["stop-run", "--state", state, "--reason", "missing-source", "--progress-digest", "same"]);
  assert.equal(blocked.execution.runStatus, "blocked");
  assert.throws(() => main(["continue-run", "--state", state, "--objective-digest", "goal-a"]), /acknowledge-blocker/);
  main(["continue-run", "--state", state, "--objective-digest", "goal-a", "--acknowledge-blocker", "true"]);
  const advanced = main(["advance", "--state", state, "--stage", "0", "--artifact", artifact]);
  assert.equal(advanced.execution.sameBlockerCount, 0);
});

test("partial checkpoint records exact resume contract without advancing", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state, "--mode", "adaptive", "--driver", "goal", "--objective-digest", "goal-a"]);
  const checkpoint = main(["checkpoint", "--state", state, "--artifact", artifact, "--progress-digest", "progress-1", "--next-action", "finish-stage-0"]);
  assert.equal(checkpoint.currentStage, 0);
  assert.equal(checkpoint.resume.status, "partial");
  assert.equal(checkpoint.resume.nextAction, "finish-stage-0");
});

test("run completes only after a digest-bound closed Stage 8 manifest", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state, "--mode", "continuous", "--driver", "goal", "--objective-digest", "goal-a"]);
  for (let stage = 0; stage < 7; stage += 1) main(["advance", "--state", state, "--stage", String(stage), "--artifact", artifact]);
  const model = normalizeReportModel({ target: "X", capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-1"] }], evidenceIndex: [{ id: "ev-1", file: "a.js" }], confirmedUsages: [{ id: "use-1", evidenceRefs: ["ev-1"] }], transition: { "next stage": "8" } });
  fs.writeFileSync(artifact, JSON.stringify(model));
  main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]);
  assert.throws(() => main(["complete-run", "--state", state]), /before a closed Stage 8/);
  fs.writeFileSync(artifact, JSON.stringify({ stage: 8, status: "closed", input: { canonicalDigest: model.integrity.canonicalDigest } }));
  main(["advance", "--state", state, "--stage", "8", "--artifact", artifact]);
  const completed = main(["complete-run", "--state", state]);
  assert.equal(completed.execution.runStatus, "complete");
  assert.equal(completed.currentStage, 9);
});
