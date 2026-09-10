"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runFullResearch } = require("../../flows/full-flow/src/full_run.js");

test("BDD: one prepared package runs the real Stage 0..8 workflow to completion", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-research-bdd-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "component.js");
  fs.writeFileSync(source, "function FeatureValue() {}\nfunction FeatureCollection() { this.value = null; }\nfunction FeatureContainer() { this.featureState = new FeatureCollection(); }\nFeatureContainer.prototype.setFeatureState = function(value) { this.featureState = value; };\nrenderFeature();\n");
  const repositoryScope = { repositories: [{ id: "fixture", root, role: "source" }] };
  const ownership = { expectedIds: ["model", "container", "owner"], groups: [
    { id: "model", order: "1", role: "model", object: "FeatureValue", relation: "defines" },
    { id: "container", order: "2", role: "container", object: "FeatureCollection.value", relation: "contains" },
    { id: "owner", order: "3", role: "owner", object: "FeatureContainer.featureState", relation: "owns" }
  ].map((row, index) => ({ ...row, status: "candidate", evidenceRefs: [], anchor: { file: source, line: index + 1 } })) };
  const pkg = {
    schemaVersion: "research-package/1.0.0", target: "FeatureValue", repositoryScope,
    stages: {
      "0": { coverageProfile: {}, scope: "fixture", scanSeeds: false, repos: [{ id: "fixture", path: root }], repositoryState: [{ id: "fixture", state: "fixture" }], tooling: [{ id: "rg", status: "available" }], seeds: { direct: ["FeatureValue"], aliases: ["featureState"] }, expectedLayers: ["model", "owner", "tests"], exclusions: [] },
      "1": { sourceRoot: root, gitnexus: { enabled: false, reason: "fixture" }, ast: { queries: [{ id: "owners", command: "find", file: source, options: { terms: "FeatureValue,value,featureState" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 10 }] }, evidence: { checks: [{ id: "owners", file: source, pattern: { value: "FeatureValue|value|featureState", regex: true }, maxMatches: 10, maxGroups: 10 }] }, ownership, coverageContract: { categories: [{ id: "direct-model", status: "applicable", groupIds: ["model"] }, { id: "container", status: "applicable", groupIds: ["container"] }, { id: "owner-branches", status: "applicable", groupIds: ["owner"] }, { id: "serialization", status: "not-applicable", reason: "fixture" }, { id: "history-copy", status: "open", reason: "later" }, { id: "index-limitations", status: "not-applicable", reason: "fixture" }], baseline: { ownershipIds: ["model", "container", "owner"] } } },
      "2": { ast: { queries: [{ id: "feature-symbols", command: "symbols", file: source, includeDetails: true }] }, evidence: { checks: [] } },
      "3": { consumerScopes: [] },
      "4": { recipientFamilies: [{ id: "ui", receiver: "UI", relation: "renders", checks: [{ id: "render", file: source, pattern: "renderFeature" }] }] },
      "5": { checks: [{ id: "path", file: source, pattern: "renderFeature" }], nameCoverage: { id: "renderer", scope: root, terms: ["renderFeature"] } },
      "6": { mode: "feature-reference", featureReference: { target: "FeatureValue", referenceEntity: "Fixture", capabilities: [{ id: "definition", status: "not-applicable", evidenceRefs: [], reason: "fixture closes without a production definition" }] }, sourceSurfaces: [{ path: "component.js", layer: "model", role: "definition" }] },
      "7": { capabilities: [{ id: "definition", status: "not-applicable", evidenceRefs: [], reason: "fixture closes without a production definition" }], evidenceSelectors: [], transition: { "next stage": "8" } }
    }
  };
  const packageFile = path.join(root, "research-package.json"), stateFile = path.join(root, "inventory-state.json"), outputRoot = path.join(root, "artifacts");
  fs.writeFileSync(packageFile, JSON.stringify(pkg));
  const realStage8 = require("../../steps/step-8/src/runner.js").run;
  await assert.rejects(runFullResearch({ packageFile, stateFile, outputRoot, runStage8(model, directory, digest) {
    realStage8(model, directory, digest);
    const manifestFile = path.join(directory, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.validation.strictBundle = "failed";
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  } }), /strictBundle|passed/);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).currentStage, 8);
  const result = await runFullResearch({ packageFile, stateFile, outputRoot });
  assert.equal(result.status, "complete");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.lastCompletedStage, 8);
  assert.equal(state.execution.runStatus, "complete");
  assert.deepEqual(state.activeArtifacts.map(row => row.stage), [0, 1, 2, 3, 4, 5, 6, 7]);
  const manifest = JSON.parse(fs.readFileSync(path.join(outputRoot, "stage-8", "manifest.json"), "utf8"));
  assert.equal(manifest.input.canonicalDigest, state.canonicalDigest);
  const metrics = JSON.parse(fs.readFileSync(result.metrics, "utf8"));
  assert.equal(metrics.stages.filter(row => row.status === "closed").length, 9);
  assert.equal(metrics.stages.filter(row => row.status === "error").length, 1);
  const again = await runFullResearch({ packageFile, stateFile, outputRoot });
  assert.equal(again.action, "already-complete");
});
