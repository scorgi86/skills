"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { main } = require("../src/stage_state.js");
const { normalizeReportModel } = require("../../shared/report/src/model/normalization.js");
const { createCanonicalStageResult } = require("../../shared/artifacts/src/canonical/result.js");
const { digest: canonicalDigest } = require("../../shared/artifacts/src/canonical/validation.js");
const crypto = require("node:crypto");
const { run: runStage8 } = require("../../steps/step-8/src/runner.js");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-state-"));
  const state = path.join(directory, "inventory-state.json");
  const artifact = path.join(directory, "artifact.json");
  writeCanonical(artifact, 0);
  return { state, artifact };
}
function writeCanonical(file, stage, facts = {}) { fs.writeFileSync(file, JSON.stringify(createCanonicalStageResult({ facts: { stage, status: "closed", ...facts }, input: { stage } }))); return file; }
function advanceThrough(state, artifact, lastExclusive) { for (let stage = 0; stage < lastExclusive; stage += 1) { writeCanonical(artifact, stage); main(["advance", "--state", state, "--stage", String(stage), "--artifact", artifact]); } }
function validModel(directory) {
  const source = path.join(directory, "a.js");
  fs.writeFileSync(source, "const x = 1;\n");
  const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  return normalizeReportModel({ target: "X", scope: { repositories: [{ id: "source", root: directory, role: "source" }] }, capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-1"] }], evidenceIndex: [{ id: "ev-1", status: "source-confirmed", repository: "source", file: source, sourceHash }], confirmedUsages: [{ id: "use-1", evidenceRefs: ["ev-1"] }], transition: { "next stage": "8" } });
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

test("legacy adoption command is rejected", () => {
  const { state, artifact } = fixture();
  assert.throws(() => main(["adopt", "--state", state, "--completed-stage", "4", "--artifact", artifact]), /Usage/);
});

test("stage 7 cannot advance with a non-canonical artifact", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state, "--mode", "strict"]);
  advanceThrough(state, artifact, 7);
  fs.writeFileSync(artifact, JSON.stringify({ stage: 7, status: "closed" }));
  assert.throws(() => main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]), /canonical JSON schema 4\.0\.0/);
  assert.equal(main(["status", "--state", state]).currentStage, 7);
});

test("stage 7 closure records the trusted model digest", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state, "--mode", "strict"]);
  advanceThrough(state, artifact, 7);
  const model = validModel(path.dirname(artifact));
  writeCanonical(artifact, 7, model);
  const advanced = main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]);
  assert.equal(advanced.currentStage, 8);
  assert.equal(advanced.canonicalDigest, model.integrity.canonicalDigest);
});

test("stage 7 rejects a canonical wrapper with an invalid nested report model", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state]);
  advanceThrough(state, artifact, 7);
  const model = validModel(path.dirname(artifact));
  model.target = "tampered-after-digest";
  writeCanonical(artifact, 7, model);
  assert.throws(() => main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]), /report model is invalid/);
});

test("new inventories default to continuous with interactive fallback", () => {
  const { state } = fixture();
  const created = main(["init", "--state", state]);
  assert.equal(created.execution.mode, "continuous");
  assert.equal(created.execution.driver, "interactive");
  assert.throws(() => main(["init", "--state", `${state}.invalid`, "--mode", "fast"]), /strict, adaptive, or continuous/);
});

test("legacy schema 1 state is rejected", () => {
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
  assert.throws(() => main(["status", "--state", state]), /schema 4\.0\.0 is required/);
});

test("legacy schema 2 state is rejected", () => {
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
  assert.throws(() => main(["status", "--state", state]), /schema 4\.0\.0 is required/);
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
  writeCanonical(artifact, 0);
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
  advanceThrough(state, artifact, 7);
  const model = validModel(path.dirname(artifact));
  writeCanonical(artifact, 7, model);
  main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]);
  assert.throws(() => main(["complete-run", "--state", state]), /before a closed Stage 8/);
  const outputDir = path.join(path.dirname(artifact), "stage-8");
  runStage8(model, outputDir, model.integrity.canonicalDigest);
  main(["advance", "--state", state, "--stage", "8", "--artifact", path.join(outputDir, "manifest.json")]);
  const completed = main(["complete-run", "--state", state]);
  assert.equal(completed.execution.runStatus, "complete");
  assert.equal(completed.currentStage, 9);
});

test("stage 8 advance rejects fake, incomplete, stale, duplicate, and traversal manifests", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state]);
  advanceThrough(state, artifact, 7);
  const model = validModel(path.dirname(artifact));
  writeCanonical(artifact, 7, model);
  main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]);
  const directory = path.join(path.dirname(artifact), "stage-8");
  const base = runStage8(model, directory, model.integrity.canonicalDigest);
  const goodOutputs = base.outputs;
  const manifestFile = path.join(directory, "manifest.json");
  const rejected = [
    { ...base, validation: { strictBundle: "failed" } },
    { ...base, validation: { ...base.validation, model: "failed" } },
    { ...base, outputs: goodOutputs.slice(0, 2) },
    { ...base, outputs: [goodOutputs[0], goodOutputs[0], goodOutputs[2]] },
    { ...base, outputs: goodOutputs.map((item, index) => index ? item : { ...item, sha256: "0".repeat(64) }) },
    { ...base, outputs: [{ ...goodOutputs[0], path: "../decision-report.md" }, ...goodOutputs.slice(1)] },
  ];
  for (const manifest of rejected) {
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.throws(() => main(["advance", "--state", state, "--stage", "8", "--artifact", manifestFile]));
  }
  const arbitrary = Object.fromEntries(["decision-report.md", "evidence.md", "implementation-map.md"].map((name) => { const content = "arbitrary-unvalidated-content\n"; fs.writeFileSync(path.join(directory, name), content); return [name, { path: name, sha256: crypto.createHash("sha256").update(content).digest("hex") }]; }));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...base, outputs: Object.values(arbitrary) }));
  assert.throws(() => main(["advance", "--state", state, "--stage", "8", "--artifact", manifestFile]), /bundle validation failed/);
});
test("stage 8 rejects a Stage 7 artifact mutated after rendering", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state]);
  advanceThrough(state, artifact, 7);
  const model = validModel(path.dirname(artifact));
  writeCanonical(artifact, 7, model);
  main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]);
  const directory = path.join(path.dirname(artifact), "stage-8-after-mutation");
  runStage8(model, directory, model.integrity.canonicalDigest);
  const canonical = JSON.parse(fs.readFileSync(artifact, "utf8"));
  canonical.facts.find((row) => row.kind === "report-model").model.provenance = { tampered: true };
  fs.writeFileSync(artifact, JSON.stringify(canonical));
  assert.throws(() => main(["advance", "--state", state, "--stage", "8", "--artifact", path.join(directory, "manifest.json")]), /unchanged valid Stage 7 canonical artifact/);
});
test("stage 8 rejects a rehashed mutation of the trusted Stage 7 wrapper", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state]);
  advanceThrough(state, artifact, 7);
  const model = validModel(path.dirname(artifact));
  writeCanonical(artifact, 7, model);
  main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]);
  const directory = path.join(path.dirname(artifact), "stage-8-rehashed-wrapper");
  runStage8(model, directory, model.integrity.canonicalDigest);
  const canonical = JSON.parse(fs.readFileSync(artifact, "utf8"));
  canonical.summary.target = "changed-wrapper-only";
  canonical.outputDigest = canonicalDigest({ ...canonical, outputDigest: undefined });
  fs.writeFileSync(artifact, JSON.stringify(canonical));
  assert.throws(() => main(["advance", "--state", state, "--stage", "8", "--artifact", path.join(directory, "manifest.json")]), /exact Stage 7 canonical artifact/);
});
test("complete-run repeats Stage 8 validation after advance", () => {
  const { state, artifact } = fixture();
  main(["init", "--state", state]);
  advanceThrough(state, artifact, 7);
  const model = validModel(path.dirname(artifact));
  writeCanonical(artifact, 7, model);
  main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]);
  const directory = path.join(path.dirname(artifact), "stage-8-before-complete");
  runStage8(model, directory, model.integrity.canonicalDigest);
  main(["advance", "--state", state, "--stage", "8", "--artifact", path.join(directory, "manifest.json")]);
  fs.appendFileSync(path.join(directory, "decision-report.md"), "\nmutated\n");
  assert.throws(() => main(["complete-run", "--state", state]), /hash is stale or invalid/);
});
test("complete-run rejects a rehashed Stage 8 manifest after canonical advance", () => { const { state, artifact } = fixture(); main(["init", "--state", state]); advanceThrough(state, artifact, 7); const model = validModel(path.dirname(artifact)); writeCanonical(artifact, 7, model); main(["advance", "--state", state, "--stage", "7", "--artifact", artifact]); const directory = path.join(path.dirname(artifact), "stage-8-rehashed-after-advance"), manifestFile = path.join(directory, "manifest.json"); runStage8(model, directory, model.integrity.canonicalDigest); main(["advance", "--state", state, "--stage", "8", "--artifact", manifestFile]); const report = path.join(directory, "decision-report.md"); fs.appendFileSync(report, "\nmutated and rehashed\n"); const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); manifest.outputs.find((row) => row.path === "decision-report.md").sha256 = crypto.createHash("sha256").update(fs.readFileSync(report)).digest("hex"); fs.writeFileSync(manifestFile, JSON.stringify(manifest)); assert.throws(() => main(["complete-run", "--state", state]), /manifest changed after canonical advance/); });
