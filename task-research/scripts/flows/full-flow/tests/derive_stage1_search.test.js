"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createCanonicalStageResult } = require("../../../shared/artifacts/src/canonical/result.js");
const { deriveStage1Search } = require("../src/derive_stage1_search.js");
const { materializeStageRequest } = require("../src/full_run.js");

const root = path.resolve("fixture-source");
const scope = { repositories: [{ id: "sdk", root, role: "source" }] };
const file = path.join(root, "model.js");
function stage0({ files = [file], scanStatus = "candidate", scanSeeds = true, seeds = ["CInnerShadow"] } = {}) {
  return createCanonicalStageResult({ facts: {
    stage: 0, status: "closed", target: "Shadow", repositoryScope: scope,
    scans: [{ id: "sdk", status: scanStatus, files, totalFiles: files.length }],
    summary: { target: "Shadow", repositoryScope: scope, seeds,
      executionScope: { version: 1, scanSeeds, repositories: [{ id: "sdk", root, exclusions: [] }] },
      repos: [{ id: "sdk", status: scanStatus, files: files.length }] }
  } });
}

test("Stage 1 search is derived deterministically from Stage 0 candidate files", () => {
  const canonical = stage0();
  const first = deriveStage1Search(canonical, scope);
  assert.deepEqual(first, deriveStage1Search(canonical, scope));
  assert.deepEqual(first.ast.queries[0].files, [file]);
  assert.equal(first.ast.queries[0].command, "find");
  assert.equal(first.ast.queries[0].options.terms, "CInnerShadow");
  assert.deepEqual(first.evidence.checks[0].files, [file]);
  assert.deepEqual(first.evidence.checks[0].patterns, [{ value: "CInnerShadow", regex: false }]);
});

test("Stage 1 search keeps every discovery seed while bootstrap remains separate", () => {
  const seeds = ["CInnerShadow", "CInnerShadowProperty", "innerShdw"];
  const result = deriveStage1Search(stage0({ seeds }), scope);
  assert.equal(result.ast.queries[0].options.terms, seeds.join(","));
  assert.deepEqual(result.evidence.checks[0].patterns, seeds.map(value => ({ value, regex: false })));
});

test("Stage 1 automatic search passes only JS/TS candidates", () => {
  const json = path.join(root, "locale", "en.json");
  const ts = path.join(root, "model.ts");
  const canonical = stage0({ files: [json, file, ts] });
  const result = deriveStage1Search(canonical, scope);
  assert.deepEqual(result.ast.queries[0].files, [file, ts]);
  assert.deepEqual(result.evidence.checks[0].files, [file, ts]);
  assert.equal(canonical.facts.filter(row => row.kind === "candidate-file").length, 3);
});

test("Stage 1 search rejects incomplete, empty, unsafe, and incompatible Stage 0 inputs", () => {
  for (const [value, message] of [
    [stage0({ files: [], scanStatus: "candidate-empty" }), /candidate-empty|no candidate/i],
    [stage0({ files: [], scanSeeds: false, scanStatus: "not-run" }), /scanSeeds|not-run/i],
    [stage0({ files: [], scanStatus: "partial" }), /partial/i],
    [stage0({ files: [path.join(root, "notes.md")] }), /no JS\/TS/i],
    [stage0({ files: [path.resolve(root, "..", "outside.js")] }), /outside|scope/i],
    [stage0({ seeds: ["Alpha,Beta"] }), /comma/i],
  ]) assert.throws(() => deriveStage1Search(value, scope), message);
  const inconsistent = stage0();
  inconsistent.summary.repos[0].files = 2;
  assert.throws(() => deriveStage1Search(inconsistent, scope), /valid closed/i);
});

test("full_run materializes opt-in Stage 1 search and retains semantic obligations", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage01-request-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, "stage-result.json");
  fs.writeFileSync(artifact, JSON.stringify(stage0()));
  const ownership = { expectedIds: ["owner"], groups: [{ id: "owner", status: "candidate" }] };
  const coverageContract = { categories: [{ id: "owner", status: "applicable", groupIds: ["owner"] }] };
  const pkg = { target: "Shadow", repositoryScope: scope, stages: { "1": { searchFromStage0: true, ownership, coverageContract } } };
  const state = { currentStage: 1, lastCompletedStage: 0, canonicalArtifact: artifact };
  const request = materializeStageRequest(pkg, 1, state);
  assert.deepEqual(request.ast.queries[0].files, [file]);
  assert.deepEqual(request.evidence.checks[0].files, [file]);
  assert.deepEqual(request.ownership, ownership);
  assert.deepEqual(request.coverageContract, coverageContract);
  assert.equal(request.transitionArtifact, artifact);
  assert.throws(() => materializeStageRequest({ ...pkg, stages: { "1": { ...pkg.stages[1], ast: { queries: [] } } } }, 1, state), /ast|conflict/i);
  assert.throws(() => materializeStageRequest({ ...pkg, stages: { "1": { ...pkg.stages[1], ownership: { ...ownership, autoCandidates: true }, capabilities: [{ id: "ownership", status: "confirmed" }] } } }, 1, state), /capabilities|conflict/i);
  const manual = { ...pkg, stages: { "1": { ast: { queries: [{ id: "manual" }] }, evidence: { checks: [] } } } };
  assert.deepEqual(materializeStageRequest(manual, 1, state).ast, manual.stages[1].ast);
});

test("full_run accepts only an unmixed empty auto-bootstrap package", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage01-bootstrap-request-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, "stage-result.json");
  fs.writeFileSync(artifact, JSON.stringify(stage0({ seeds: ["CInnerShadow", "CInnerShadowProperty", "innerShdw"] })));
  const state = { currentStage: 1, lastCompletedStage: 0, canonicalArtifact: artifact };
  const base = { target: "Shadow", repositoryScope: scope, stages: { "1": { searchFromStage0: true, ownership: { bootstrapSeed: "CInnerShadow" } } } };
  assert.equal(materializeStageRequest(base, 1, state).ownership.bootstrapSeed, "CInnerShadow");
  for (const stage1 of [
    { ...base.stages[1], coverageContract: { categories: [] } },
    { ...base.stages[1], ownership: { bootstrapSeed: "CInnerShadow", expectedIds: ["manual"], groups: [] } },
    { ...base.stages[1], ownership: { bootstrapSeed: "CInnerShadow", expectedIds: [], groups: [{ id: "manual" }] } },
    { ...base.stages[1], capabilities: [{ id: "definition", status: "confirmed" }] },
  ]) assert.throws(() => materializeStageRequest({ ...base, stages: { "1": stage1 } }, 1, state), /bootstrap|ownership|coverage|mixed/i);
  const manual = { ...base, stages: { "1": { searchFromStage0: true, ownership: { expectedIds: ["owner"], groups: [{ id: "owner" }], bootstrapSeed: "CInnerShadow" }, coverageContract: { categories: [{ id: "owner", status: "applicable", groupIds: ["owner"] }] } } } };
  assert.throws(() => materializeStageRequest(manual, 1, state), /bootstrapSeed|auto-bootstrap/i);
});
