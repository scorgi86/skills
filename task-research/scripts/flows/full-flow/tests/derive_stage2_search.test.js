"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createCanonicalStageResult } = require("../../../shared/artifacts/src/canonical/result.js");
const { deriveStage2Search } = require("../src/derive_stage2_search.js");
const { materializeStageRequest } = require("../src/full_run.js");

test("Stage 2 request is derived from canonical frontier and Stage 0 files", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "derive-stage2-")); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "repo"), file = path.join(root, "model.js"); fs.mkdirSync(root); fs.writeFileSync(file, "class Owner {}\n");
  const scope = { repositories: [{ id: "repo", root, role: "source" }] };
  const stage0 = createCanonicalStageResult({ facts: { stage: 0, status: "closed", target: "Thing", repositoryScope: scope, scans: [{ id: "repo", status: "candidate", files: [file], totalFiles: 1 }], summary: { target: "Thing", repositoryScope: scope, seeds: ["Seed"], executionScope: { scanSeeds: true }, repos: [{ id: "repo", status: "candidate", files: 1 }] } } });
  const stage0File = path.join(directory, "stage0.json"); fs.writeFileSync(stage0File, JSON.stringify(stage0));
  const stage1 = createCanonicalStageResult({ facts: { stage: 1, status: "closed", target: "Thing", repositoryScope: scope,
    ownershipGraph: { nodes: [{ id: "seed", entity: "Seed", role: "seed", status: "confirmed", order: 0 }, { id: "frontier", entity: "Frontier", role: "owner", status: "confirmed", order: 1 }], edges: [{ id: "edge", from: "frontier", to: "seed", relation: "stores", status: "confirmed", anchors: [{ file, line: 1 }] }] },
    summary: { target: "Thing", repositoryScope: scope, lineage: [{ stage: 0, artifact: stage0File, outputDigest: stage0.outputDigest }] } } });
  const result = deriveStage2Search(stage1, scope, 3);
  assert.deepEqual(result.ownershipFrontier, [{ nodeId: "frontier", entity: "Frontier", order: 1, repository: "repo" }]);
  assert.deepEqual(result.ast.ownerSeedTypes, ["Frontier"]);
  assert.deepEqual(result.ast.queries.find(row => row.id === "stage0-boundary-repo").files, [file]);
  assert.deepEqual(result.ast.queries.find(row => row.id === "stage0-boundary-repo").options.terms, ["Seed"]);
  assert.equal(result.ast.queries.find(row => row.id === "stage1-frontier-repo").options.terms, "Frontier");
  assert.deepEqual(result, deriveStage2Search(stage1, scope, 3));

  const exhausted = deriveStage2Search(stage1, scope, 1);
  assert.equal(exhausted.frontierExhausted, true);
  assert.equal(exhausted.ast.queries.length, 1);
  assert.equal(exhausted.ast.queries[0].command, "occurrences");

  const stage1File = path.join(directory, "stage1.json"); fs.writeFileSync(stage1File, JSON.stringify(stage1));
  const pkg = { target: "Thing", repositoryScope: scope, stages: { "2": { searchFromStage1: true, ownershipGraphMaxOrder: 3 } } };
  const request = materializeStageRequest(pkg, 2, { currentStage: 2, lastCompletedStage: 1, canonicalArtifact: stage1File });
  assert.equal(request.ast.queries.length, 2);
  assert.throws(() => materializeStageRequest({ ...pkg, stages: { "2": { ...pkg.stages[2], ast: {} } } }, 2, { currentStage: 2, lastCompletedStage: 1, canonicalArtifact: stage1File }), /conflicts/);
  assert.throws(() => materializeStageRequest({ ...pkg, stages: { "2": { ...pkg.stages[2], frontierExhausted: true } } }, 2, { currentStage: 2, lastCompletedStage: 1, canonicalArtifact: stage1File }), /conflicts/);
  assert.throws(() => materializeStageRequest({ ...pkg, stages: { "2": { ...pkg.stages[2], dictionary: [] } } }, 2, { currentStage: 2, lastCompletedStage: 1, canonicalArtifact: stage1File }), /conflicts/);
});

test("full-profile Stage 2 derives value flow unless the package explicitly disables it", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "derive-stage2-vf-")); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "repo"), file = path.join(root, "model.js"); fs.mkdirSync(root); fs.writeFileSync(file, "class Owner {}\n");
  const scope = { repositories: [{ id: "repo", root, role: "source" }] };
  const stage0 = createCanonicalStageResult({ facts: { stage: 0, status: "closed", target: "Thing", repositoryScope: scope, scans: [{ id: "repo", status: "candidate", files: [file], totalFiles: 1 }], summary: { target: "Thing", repositoryScope: scope, coverageProfile: { kind: "full-inventory", requiredCapabilities: ["definition"], requiredCollections: [] }, seeds: ["Seed"], executionScope: { scanSeeds: true }, repos: [{ id: "repo", status: "candidate", files: 1 }] } } });
  const stage0File = path.join(directory, "stage0.json"); fs.writeFileSync(stage0File, JSON.stringify(stage0));
  const stage1 = createCanonicalStageResult({ facts: { stage: 1, status: "closed", target: "Thing", repositoryScope: scope,
    ownershipGraph: { nodes: [{ id: "seed", entity: "Seed", role: "seed", status: "confirmed", order: 0 }, { id: "frontier", entity: "Frontier", role: "owner", status: "confirmed", order: 1 }], edges: [{ id: "edge", from: "frontier", to: "seed", relation: "stores", status: "confirmed", anchors: [{ file, line: 1 }] }] },
    summary: { target: "Thing", repositoryScope: scope, lineage: [{ stage: 0, artifact: stage0File, outputDigest: stage0.outputDigest }] } } });
  assert.equal(deriveStage2Search(stage1, scope, 3).valueFlow.enabled, true);
  assert.equal(deriveStage2Search(stage1, scope, 3, { valueFlowEnabled: false }).valueFlow.enabled, false);
});
