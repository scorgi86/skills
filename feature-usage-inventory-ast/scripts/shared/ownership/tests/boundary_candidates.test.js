"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { normalizeBoundaryCandidates } = require("../src/boundary_candidates");
const { runStage3 } = require("../../../steps/step-3/src/runner");
const { runStage4 } = require("../../../steps/step-4/src/runner");
const { createTraversalOptions, isExcludedFile, shouldTraverseEntry } = require("../../evidence/src/collection/source_files.js");
const { createCanonicalStageResult } = require("../../artifacts/src/canonical/result.js");

function canonicalTransition(root, stage, boundaries = []) {
  const file = path.join(root, `stage-${stage}.json`);
  const fields = { target: "feature", scope: "fixture", stage: String(stage), status: "closed", "confirmed evidence": "none", "candidate evidence": "bridge", "dictionary/graph/path state": "ready", "skipped/forbidden": "none", "open checks": "next", "next stage": String(stage + 1) };
  const value = createCanonicalStageResult({ facts: { stage, status: "closed", transition: { schemaVersion: "1.0.0", fields }, boundaries }, input: { stage } });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

test("boundary candidates are generic, anchored and remain candidates", () => {
  const candidates = normalizeBoundaryCandidates({ boundaries: [{
    id: "property-bridge", producerRepo: "engine", kind: "setter", symbol: "setEffect", relation: "sets model property",
    evidenceRefs: ["bridge"], ownershipRefs: ["model"], consumerRepos: ["client"], searchTerms: ["applyEffect"],
  }] }, { groups: [{ id: "model" }] }, { checks: [{ id: "bridge", groups: [{ firstAnchor: { file: "src/model.js", line: 8 } }] }] });
  assert.deepEqual(candidates[0].searchTerms, ["setEffect", "applyEffect"]);
  assert.equal(candidates[0].status, "candidate");
  assert.throws(() => normalizeBoundaryCandidates({ boundaries: [{ id: "bad", producerRepo: "engine", kind: "setter", symbol: "set", relation: "sets", anchor: { file: "src/model.js", line: 1 }, evidenceRefs: [], consumerRepos: ["client"] }] }, { groups: [] }, { checks: [] }), /evidenceRefs/);
});

test("stage 3 searches arbitrary consumer layout from canonical Stage 2", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-stage3-"));
  const consumer = path.join(root, "unrelated-layout", "handlers");
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(consumer, "entry.js"), "function click() { return applyEffect(value); }\n");
  const transition = canonicalTransition(root, 2, [{ id: "property-bridge", producerRepo: "engine", kind: "setter", symbol: "setEffect", relation: "sets", anchor: { file: "src/model.js", line: 8 }, evidenceRefs: ["bridge"], ownershipRefs: [], searchTerms: ["applyEffect"], consumerRepos: ["client"], status: "candidate" }]);
  const result = runStage3({ stage: 3, transitionArtifact: transition, consumerScopes: [{ id: "client", scope: path.join(root, "unrelated-layout") }] });
  assert.equal(result.sourceEvidence.checks.length, 1);
  assert.equal(result.sourceEvidence.checks[0].status, "candidate");
  assert.equal(result.sourceEvidence.checks[0].matches[0].file.endsWith("entry.js"), true);
});

test("stage 3 marks each consumer without a scope as unverified", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-stage3-unverified-"));
  const transition = canonicalTransition(root, 2, [{ id: "bridge", producerRepo: "engine", kind: "setter", symbol: "setEffect", relation: "sets", anchor: { file: "src/model.js", line: 8 }, evidenceRefs: ["bridge"], ownershipRefs: [], searchTerms: ["applyEffect"], consumerRepos: ["client", "desktop"], status: "candidate" }]);
  const result = runStage3({ stage: 3, transitionArtifact: transition, consumerScopes: [{ id: "client", scope: transition }] });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.consumerCoverage.find((item) => item.consumerRepo === "desktop"), { boundaryId: "bridge", consumerRepo: "desktop", status: "unverified", reason: "No consumer scope was supplied" });
});

test("stage 4 classifies declared recipient families and retains all observations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recipient-stage4-"));
  const source = path.join(root, "client.js");
  fs.writeFileSync(source, "store(effect);\nstore(effect);\n");
  const transition = canonicalTransition(root, 3);
  const result = runStage4({ stage: 4, transitionArtifact: transition, priorEvidence: [{ stage: 3, check: "consumer" }], recipientFamilies: [{ id: "shared-container", receiver: "effect container", relation: "stores effect", checks: [{ id: "store", file: source, pattern: "store", maxMatches: 1 }] }] });
  assert.equal(result.recipientFamilies[0].status, "candidate");
  assert.equal(result.recipientFamilies[0].totalMatches, 2);
  assert.equal(result.recipientFamilies[0].fullObservationCount, 2);
  assert.equal(result.priorEvidence.length, 1);
  assert.equal(result.reusableForNextStage.sourceEvidence, true);
});

test("stage 4 writes full facts but returns bounded stdout when output is requested", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recipient-stage4-summary-"));
  const source = path.join(root, "client.js");
  fs.writeFileSync(source, "store(effect);\nstore(effect);\n");
  const transition = canonicalTransition(root, 3);
  const request = path.join(root, "request.json");
  const output = path.join(root, "facts.json");
  fs.writeFileSync(request, JSON.stringify({ stage: 4, transitionArtifact: transition, recipientFamilies: [{ id: "shared", receiver: "container", relation: "stores effect", checks: [{ id: "store", file: source, pattern: "store" }] }] }));
  const run = spawnSync(process.execPath, [path.join(require("node:path").resolve(__dirname, "../../.."), "cli/src/commands/stage4_runner.js"), "--request", request, "--output", output], { encoding: "utf8" });
  assert.equal(run.status, 0);
  const summary = JSON.parse(run.stdout);
  const facts = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(summary.recipientFamilies[0].fullObservationCount, 2);
  assert.equal(Object.hasOwn(summary, "sourceEvidence"), false);
  assert.equal(facts.sourceEvidence.checks[0].fullMatches.length, 2);
});

test("source evidence traversal excludes symlinks and configured noise by default", () => {
  const options = createTraversalOptions({ excludeDirs: ["vendor"], excludeFilePatterns: ["\\.min\\.js$"] });
  assert.equal(shouldTraverseEntry({ name: "linked", isSymbolicLink: () => true }, options), false);
  assert.equal(shouldTraverseEntry({ name: "vendor", isSymbolicLink: () => false }, options), false);
  assert.equal(isExcludedFile(path.join("fixture", "bundle.min.js"), options), true);
  assert.equal(isExcludedFile(path.join("fixture", "source.js"), options), false);
});

test("generic boundary scripts do not contain product-specific layout assumptions", () => {
  for (const name of ["../src/boundary_candidates.js", "../../../steps/step-3/src/runner.js"]) {
    const text = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.equal(/hardcoded-product|hardcoded-repository|fixed-workspace-root/i.test(text), false, name);
  }
});
