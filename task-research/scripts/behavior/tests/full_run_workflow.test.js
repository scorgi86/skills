"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const crypto = require("node:crypto");

const { runFullResearch } = require("../../flows/full-flow/src/full_run.js");
const { runStagePipeline } = require("../../flows/full-flow/src/stage_pipeline.js");
const { main: runState } = require("../../state/src/stage_state.js");
const { IDS } = require("../../shared/dto/src/capability_contract.js");

test("BDD: pipeline Stage 0 continues through full_run to Stage 8 with immutable lineage", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-research-bdd-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "component.js");
  fs.writeFileSync(source, "function FeatureValue() {}\nfunction FeatureCollection() { this.value = null; }\nfunction FeatureContainer() { this.featureState = new FeatureCollection(); }\nFeatureContainer.prototype.setFeatureState = function(value) { this.featureState = value; };\nrenderFeature();\n");
  const repositoryScope = { repositories: [{ id: "fixture", root, role: "source" }] };
  const proof = { status: "source-confirmed", line: 1, endLine: 1, sourceFragment: "function FeatureValue() {}", sourceHash: crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"), evidenceRefs: ["definition-proof"] };
  const mutationProof = { ...proof, id: "mutation-proof", repository: "fixture", file: source, line: 4, endLine: 4,
    sourceFragment: "FeatureContainer.prototype.setFeatureState = function(value) { this.featureState = value; };", evidenceRefs: ["mutation-proof"] };
  const recipient = { id: "receiver", receiver: "FeatureContainer", relation: "setFeatureState stores value", status: "confirmed",
    statement: "FeatureContainer receives the mutation", result: "setFeatureState stores the supplied value", evidenceRefs: ["mutation-proof"],
    checks: [{ id: "mutation", file: source, pattern: "setFeatureState" }] };
  const outputLimitation = { id: "receiver-output", status: "unknown", statement: "Mutation proof does not establish a complete receiver output path" };
  const scenario = { id: "construct-value", status: "confirmed", entry: "Construct FeatureValue", steps: ["Invoke FeatureValue constructor"], result: "An empty FeatureValue instance exists", evidenceRefs: ["definition-proof"] };
  const criticalPath = { id: "construction-path", status: "confirmed", statement: "FeatureValue constructor creates an empty instance", scenarioRefs: [scenario.id], evidenceRefs: ["definition-proof"] };
  const capabilities = [...IDS].map(id => id === "definition" ? { id, status: "confirmed", evidenceRefs: ["definition-proof"] } : { id, status: "not-applicable", evidenceRefs: [], reasonCode: "architecture", explanation: `Fixture has no production ${id} layer` });
  const ownership = { expectedIds: ["model", "container", "owner"], groups: [
    { id: "model", order: "1", role: "model", object: "FeatureValue", relation: "defines" },
    { id: "container", order: "2", role: "container", object: "FeatureCollection.value", relation: "contains" },
    { id: "owner", order: "3", role: "owner", object: "FeatureContainer.featureState", relation: "owns" }
  ].map((row, index) => ({ ...row, status: "candidate", evidenceRefs: [], anchor: { file: source, line: index + 1 } })) };
  const pkg = {
    schemaVersion: "research-package/1.0.0", target: "FeatureValue", repositoryScope,
    stages: {
      "0": { coverageProfile: { kind: "full-inventory", requiredCapabilities: [...IDS], requiredCollections: ["scenarios", "criticalPaths"] }, scope: "fixture", scanSeeds: false, repos: [{ id: "fixture", path: root }], repositoryState: [{ id: "fixture", state: "fixture" }], tooling: [{ id: "rg", status: "available" }], seeds: { direct: ["FeatureValue"], aliases: ["featureState"] }, expectedLayers: ["model", "owner", "tests"], exclusions: [] },
      "1": { sourceRoot: root, gitnexus: { enabled: false, reason: "fixture" }, ast: { queries: [{ id: "owners", command: "find", file: source, options: { terms: "FeatureValue,value,featureState" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 10 }] }, evidence: { checks: [{ id: "owners", file: source, pattern: { value: "FeatureValue|value|featureState", regex: true }, maxMatches: 10, maxGroups: 10 }] }, ownership, coverageContract: { categories: [{ id: "direct-model", status: "applicable", groupIds: ["model"] }, { id: "container", status: "applicable", groupIds: ["container"] }, { id: "owner-branches", status: "applicable", groupIds: ["owner"] }, { id: "serialization", status: "not-applicable", reason: "fixture" }, { id: "history-copy", status: "open", reason: "later" }, { id: "index-limitations", status: "not-applicable", reason: "fixture" }], baseline: { ownershipIds: ["model", "container", "owner"] } } },
      "2": { ast: { queries: [{ id: "feature-symbols", command: "symbols", file: source, includeDetails: true }] }, evidence: { checks: [] } },
      "3": { consumerScopes: [] },
      "4": { recipientFamilies: [recipient], limitations: [outputLimitation] },
      "5": { checks: [{ id: "path", file: source, pattern: "renderFeature" }], nameCoverage: { id: "renderer", scope: root, terms: ["renderFeature"] } },
      "6": { mode: "feature-reference", featureReference: { target: "FeatureValue", referenceEntity: "Fixture", capabilities }, sourceSurfaces: ["definition", "construction"].map(role => ({ path: "component.js", layer: "model", role, status: "confirmed", evidenceRefs: ["definition-proof"] })) },
      "7": { capabilities, evidenceSelectors: [{ stage: 6, limit: 10 }, { stage: 4, limit: 10 }], transition: { "next stage": "8" } }
    }
  };
  pkg.stages[1].evidence.checks.push({ id: "definition-proof", file: source, repository: "fixture", pattern: "function FeatureValue", confirmation: proof });
  pkg.stages[1].scenarios = [scenario];
  pkg.stages[1].criticalPaths = [criticalPath];
  pkg.stages[0].coverageProfile.requiredCollections.push("recipientFamilies");
  pkg.stages[2].evidence.checks.push({ id: "query-mutation", file: source, repository: "fixture", pattern: "setFeatureState", confirmation: mutationProof });
  const packageFile = path.join(root, "research-package.json"), stateFile = path.join(root, "inventory-state.json"), outputRoot = path.join(root, "artifacts");
  fs.writeFileSync(packageFile, JSON.stringify(pkg));
  runState(["init", "--state", stateFile]);
  const first = await runStagePipeline({ stateFile, outputRoot,
    request: { ...pkg.stages[0], stage: 0, target: pkg.target, repositoryScope } });
  const savedFirst = new Map([first.artifact, first.evidence, first.manifest].map(file => [file, fs.readFileSync(file)]));
  const realStage8 = require("../../steps/step-8/src/runner.js").run;
  await assert.rejects(runFullResearch({ packageFile, stateFile, outputRoot,
    async runStagePipeline(options) {
      const result = await runStagePipeline(options);
      if (options.request.stage === 2) {
        const bundle = JSON.parse(fs.readFileSync(result.evidence));
        assert.ok(bundle.evidence.some(row => row.aliases.includes(mutationProof.id)), JSON.stringify(bundle.evidence.map(row => row.aliases)));
      }
      return result;
    }, runStage8(model, directory, digest) {
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
  const model = JSON.parse(fs.readFileSync(path.join(outputRoot, "stage-7", "canonical", "stage-result.json"))).facts.find(row => row.kind === "report-model").model;
  assert.equal(model.scenarios[0].entry, scenario.entry);
  assert.equal(model.criticalPaths[0].id, criticalPath.id);
  assert.equal(model.referencePaths.length, 2);
  assert.equal(new Set(model.referencePaths.map(row => row.id)).size, 2);
  assert.equal(model.evidenceIndex.some(row => row.status === "source-confirmed"), true);
  assert.equal(Object.hasOwn(pkg.stages[7], "recipientFamilies"), false);
  const received = model.recipientFamilies.find(row => row.id === recipient.id);
  assert.equal(received.status, "confirmed");
  for (const field of ["receiver", "relation", "statement", "result"]) assert.equal(received[field], recipient[field]);
  const exactProof = model.evidenceIndex.find(row => row.aliases?.includes(mutationProof.id));
  assert.deepEqual(received.evidenceRefs, [exactProof.id]);
  assert.equal(model.limitations.find(row => row.id === outputLimitation.id).statement, outputLimitation.statement);
  const implementationMap = fs.readFileSync(path.join(outputRoot, "stage-8", "implementation-map.md"), "utf8");
  assert.ok(implementationMap.includes(recipient.statement));
  assert.ok(fs.readFileSync(path.join(outputRoot, "stage-8", "decision-report.md"), "utf8").includes(outputLimitation.statement));
  const metrics = JSON.parse(fs.readFileSync(result.metrics, "utf8"));
  assert.equal(metrics.stages.filter(row => row.status === "closed").length, 8);
  assert.equal(metrics.stages.some(row => row.stage === 0), false);
  assert.equal(metrics.stages.filter(row => row.status === "error").length, 1);
  for (const [file, bytes] of savedFirst) assert.deepEqual(fs.readFileSync(file), bytes);
  const files = [stateFile, result.metrics, path.join(outputRoot, "stage-8", "manifest.json"),
    ...manifest.outputs.map(row => path.join(outputRoot, "stage-8", row.path)),
    ...state.activeArtifacts.map(row => row.artifact)];
  const savedComplete = new Map(files.map(file => [file, fs.readFileSync(file)]));
  const again = await runFullResearch({ packageFile, stateFile, outputRoot });
  assert.equal(again.action, "already-complete");
  for (const [file, bytes] of savedComplete) assert.deepEqual(fs.readFileSync(file), bytes);
});
