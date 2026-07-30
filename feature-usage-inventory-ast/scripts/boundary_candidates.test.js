"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { normalizeBoundaryCandidates } = require("./boundary_candidates");
const { runStage3 } = require("./stage3_runner");
const { runStage4 } = require("./stage4_runner");
const { createTraversalOptions, isExcludedFile, shouldTraverseEntry } = require("./source_evidence");

test("boundary candidates are generic, anchored and remain candidates", () => {
  const candidates = normalizeBoundaryCandidates({ boundaries: [{
    id: "property-bridge", producerRepo: "engine", kind: "setter", symbol: "setEffect", relation: "sets model property",
    evidenceRefs: ["bridge"], ownershipRefs: ["model"], consumerRepos: ["client"], searchTerms: ["applyEffect"],
  }] }, { groups: [{ id: "model" }] }, { checks: [{ id: "bridge", groups: [{ firstAnchor: { file: "src/model.js", line: 8 } }] }] });
  assert.deepEqual(candidates[0].searchTerms, ["setEffect", "applyEffect"]);
  assert.equal(candidates[0].status, "candidate");
  assert.throws(() => normalizeBoundaryCandidates({ boundaries: [{ id: "bad", producerRepo: "engine", kind: "setter", symbol: "set", relation: "sets", anchor: { file: "src/model.js", line: 1 }, evidenceRefs: [], consumerRepos: ["client"] }] }, { groups: [] }, { checks: [] }), /evidenceRefs/);
});

test("stage 3 searches arbitrary consumer layout from stage 1 boundary artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-stage3-"));
  const consumer = path.join(root, "unrelated-layout", "handlers");
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(consumer, "entry.js"), "function click() { return applyEffect(value); }\n");
  const transition = path.join(root, "stage2.md");
  fs.writeFileSync(transition, ["# Этап 2", "", "## Артефакт для следующего этапа", "", "- target: feature", "- scope: fixture", "- stage: 2", "- status: закрыт", "- confirmed evidence: none", "- candidate evidence: bridge", "- dictionary/graph/path state: ready", "- skipped/forbidden: none", "- open checks: starts", "- next stage: 3 — Сценарии"].join("\n"));
  const boundaries = path.join(root, "boundaries.json");
  fs.writeFileSync(boundaries, JSON.stringify({ candidates: [{ id: "property-bridge", producerRepo: "engine", kind: "setter", symbol: "setEffect", relation: "sets", anchor: { file: "src/model.js", line: 8 }, evidenceRefs: ["bridge"], ownershipRefs: [], searchTerms: ["applyEffect"], consumerRepos: ["client"], status: "candidate" }] }));
  const result = runStage3({ stage: 3, transitionArtifact: transition, boundaryArtifact: boundaries, consumerScopes: [{ id: "client", scope: path.join(root, "unrelated-layout") }] });
  assert.equal(result.sourceEvidence.checks.length, 1);
  assert.equal(result.sourceEvidence.checks[0].status, "candidate");
  assert.equal(result.sourceEvidence.checks[0].matches[0].file.endsWith("entry.js"), true);
});

test("stage 3 marks each consumer without a scope as unverified", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-stage3-unverified-"));
  const transition = path.join(root, "stage2.md");
  fs.writeFileSync(transition, ["# Этап 2", "", "## Артефакт для следующего этапа", "", "- target: feature", "- scope: fixture", "- stage: 2", "- status: закрыт", "- confirmed evidence: none", "- candidate evidence: bridge", "- dictionary/graph/path state: ready", "- skipped/forbidden: none", "- open checks: starts", "- next stage: 3 — Сценарии"].join("\n"));
  const boundaries = path.join(root, "boundaries.json");
  fs.writeFileSync(boundaries, JSON.stringify({ candidates: [{ id: "bridge", producerRepo: "engine", kind: "setter", symbol: "setEffect", relation: "sets", anchor: { file: "src/model.js", line: 8 }, evidenceRefs: ["bridge"], ownershipRefs: [], searchTerms: ["applyEffect"], consumerRepos: ["client", "desktop"], status: "candidate" }] }));
  const result = runStage3({ stage: 3, transitionArtifact: transition, boundaryArtifact: boundaries, consumerScopes: [{ id: "client", scope: transition }] });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.consumerCoverage.find((item) => item.consumerRepo === "desktop"), { boundaryId: "bridge", consumerRepo: "desktop", status: "unverified", reason: "No consumer scope was supplied" });
});

test("stage 4 classifies declared recipient families and retains all observations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recipient-stage4-"));
  const source = path.join(root, "client.js");
  fs.writeFileSync(source, "store(effect);\nstore(effect);\n");
  const transition = path.join(root, "stage3.md");
  fs.writeFileSync(transition, ["# Этап 3", "", "## Артефакт для следующего этапа", "", "- target: feature", "- scope: fixture", "- stage: 3", "- status: закрыт", "- confirmed evidence: none", "- candidate evidence: bridge", "- dictionary/graph/path state: ready", "- skipped/forbidden: none", "- open checks: recipients", "- next stage: 4 — Получатели"].join("\n"));
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
  const transition = path.join(root, "stage3.md");
  fs.writeFileSync(transition, ["- target: feature", "- scope: fixture", "- stage: 3", "- status: closed", "- confirmed evidence: none", "- candidate evidence: bridge", "- dictionary/graph/path state: ready", "- skipped/forbidden: none", "- open checks: recipients", "- next stage: 4"].join("\n"));
  const request = path.join(root, "request.json");
  const output = path.join(root, "facts.json");
  fs.writeFileSync(request, JSON.stringify({ stage: 4, transitionArtifact: transition, recipientFamilies: [{ id: "shared", receiver: "container", relation: "stores effect", checks: [{ id: "store", file: source, pattern: "store" }] }] }));
  const run = spawnSync(process.execPath, [path.join(__dirname, "stage4_runner.js"), "--request", request, "--output", output], { encoding: "utf8" });
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
  assert.equal(isExcludedFile("C:/fixture/bundle.min.js", options), true);
  assert.equal(isExcludedFile("C:/fixture/source.js", options), false);
});

test("generic boundary scripts do not contain R7 layout names", () => {
  for (const name of ["boundary_candidates.js", "stage3_runner.js"]) {
    const text = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.equal(/sdkjs|web-apps|apiCommon|ShapeSettings/i.test(text), false, name);
  }
});
