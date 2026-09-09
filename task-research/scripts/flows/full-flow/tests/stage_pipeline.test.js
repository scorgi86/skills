"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { carryPlanningFacts, runStagePipeline, withRuntimeAstCache } = require("../src/stage_pipeline");
const { main: runState } = require("../../../state/src/stage_state.js");
const { normalizeReportModel } = require("../../../shared/report/src/model/normalization.js");
const { validateReportModel } = require("../../../shared/report/src/model/validation.js");
const { run: runStage8, unwrapModel } = require("../../../steps/step-8/src/runner.js");

test("pipeline carries declared planning facts into canonicalization input", async () => { const result = carryPlanningFacts({ gaps: [{ id: "gap", expectedPath: "export" }] }, { stage: 6, status: "candidate", gaps: [{ id: "gap", status: "partial" }] }); assert.equal(result.gaps.length, 1); assert.equal(result.gaps[0].expectedPath, "export"); assert.equal(result.gaps[0].status, "partial"); });

function request(root, stage = 0) { return { stage, ...(stage === 0 ? { coverageProfile: {} } : {}), target: "FeatureValue", repositoryScope: { repositories: [{ id: "source", root, role: "source" }] } }; }

test("pipeline writes canonical-only output and keeps raw opt-in", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-pipeline-"));
  const result = await runStagePipeline({ request: request(root), outputRoot: root, runner: () => ({ stage: 0, status: "candidate", transition: { fields: { target: "FeatureValue" } } }) });
  assert.equal(result.status, "closed");
  assert.equal(fs.existsSync(result.artifact), true);
  assert.equal(fs.existsSync(path.join(root, "stage-0", "raw")), false);
});

test("pipeline does not advance a partial transaction", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-pipeline-"));
  const result = await runStagePipeline({ request: request(root), outputRoot: root, runner: () => ({ stage: 0, status: "partial", transition: { fields: { target: "FeatureValue" } } }) });
  assert.equal(result.status, "partial");
  assert.equal(result.stateChanged, false);
});

test("pipeline gives the runner an immutable session context", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-context-"));
  const state = path.join(root, "state.json");
  runState(["init", "--state", state]);
  let received;
  const result = await runStagePipeline({ request: request(root), outputRoot: root, stateFile: state,
    runner(_request, _dependencies, context) {
      received = context;
      assert.throws(() => { context.state.currentStage = 7; }, TypeError);
      return { stage: 0, status: "candidate" };
    } });
  assert.equal(result.status, "closed");
  assert.equal(received.stage, 0);
  assert.equal(received.state.currentStage, 0);
});

test("pipeline routes one scoped runtime AST cache through Stage 1 and Stage 2", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-ast-cache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = request(root);
  let transitionArtifact = (await runStagePipeline({ request: base, outputRoot: root, runner: () => ({ stage: 0, status: "candidate" }) })).artifact;
  const received = [];
  for (const stage of [1, 2]) {
    const result = await runStagePipeline({ request: { ...base, stage, transitionArtifact, ast: {} }, outputRoot: root,
      runner(stageRequest) { received.push(stageRequest); return { stage, status: "candidate" }; } });
    transitionArtifact = result.artifact;
  }
  assert.equal(received[0].ast.cache, received[1].ast.cache);
  assert.match(received[0].ast.cache, /\.runtime-cache[\\/]ast[\\/][a-f0-9]{12}$/);
  assert.equal(base.ast, undefined);
  const explicit = path.join(root, "explicit-cache");
  assert.equal(withRuntimeAstCache({ ...base, stage: 1, ast: { cache: explicit } }, root).ast.cache, explicit);
  assert.notEqual(withRuntimeAstCache({ ...base, stage: 1, ast: {} }, root).ast.cache,
    withRuntimeAstCache({ ...base, stage: 1, repositoryScope: { repositories: [{ id: "other", root, role: "source" }] }, ast: {} }, root).ast.cache);
  assert.equal(withRuntimeAstCache({ ...base, stage: 3, ast: {} }, root).ast.cache, undefined);
});

test("public Stage 2 pipeline canonicalizes candidates once while direct runners stay prepared", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-canonicalization-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.js");
  fs.writeFileSync(source, "feature();\n");
  const base = request(root);
  let transitionArtifact = (await runStagePipeline({ request: base, outputRoot: root, runner: () => ({ stage: 0, status: "candidate" }) })).artifact;
  transitionArtifact = (await runStagePipeline({ request: { ...base, stage: 1, transitionArtifact }, outputRoot: root, runner: () => ({ stage: 1, status: "candidate", transition: { fields: {
    target: "FeatureValue", scope: "source", stage: "1", status: "closed", "confirmed evidence": "scope", "candidate evidence": "none",
    "dictionary/graph/path state": "ready", "skipped/forbidden": "none", "open checks": "stage 2", "next stage": "2"
  } } }) })).artifact;
  const canonicalization = require("../../../shared/evidence/index.js").stage2_canonicalize;
  const original = canonicalization.canonicalizeStage2Candidates;
  let calls = 0;
  canonicalization.canonicalizeStage2Candidates = (...args) => { calls += 1; return original(...args); };
  t.after(() => { canonicalization.canonicalizeStage2Candidates = original; });
  const dependencies = {
    runAstBatch: () => ({ status: "candidate", stats: { parseCounts: {}, failed: 0 }, plan: { compiledBeforeParse: true, lateQueries: 0 }, results: [] }),
    runEvidenceChecks: () => ({ checks: [{ id: "source", status: "candidate", fullMatches: [{ file: source, line: 1, endLine: 1, sourceFragment: "feature();" }] }] })
  };
  await runStagePipeline({ request: { ...base, stage: 2, transitionArtifact, ast: {}, evidence: { checks: [] } }, outputRoot: root, dependencies });
  assert.equal(calls, 1);
  calls = 0;
  const direct = require("../../../steps/step-2/src/runner.js").runStage2({ ...base, stage: 2, transitionArtifact, ast: {}, evidence: { checks: [] } }, dependencies);
  assert.ok(Array.isArray(direct.canonicalEvidence));
  assert.equal(calls, 1);
});

test("canonical pipeline advances stages 0 through 7 and preserves Stage 8 digest binding", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-pipeline-e2e-"));
  const state = path.join(root, "inventory-state.json");
  runState(["init", "--state", state, "--mode", "continuous"]);
  const base = request(root, 0);
  let model = null;
  let stage7Artifact = null;
  const sourceFile = path.join(root, "source.js");
  fs.writeFileSync(sourceFile, "const FeatureValue = true;\n");
  const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(sourceFile)).digest("hex");
  for (let stage = 0; stage <= 7; stage += 1) {
    const current = { ...base, stage };
    const runner = () => {
      if (stage === 7) { model = normalizeReportModel({ target: "FeatureValue", scope: base.repositoryScope,
        provenance: { lineage: require("../../../shared/artifacts/src/canonical/lineage.js").buildLineageFromPrevious(JSON.parse(fs.readFileSync(state)).canonicalArtifact, 7, base.repositoryScope) },
        capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-1"] }], evidenceIndex: [{ id: "ev-1", status: "source-confirmed", repository: "source", file: sourceFile, sourceHash, line: 1, endLine: 1, sourceFragment: "const FeatureValue = true;" }], confirmedUsages: [{ id: "use-1", evidenceRefs: ["ev-1"] }], transition: { "next stage": "8" } }); return model; }
      return { stage, status: "candidate", transition: { valid: true, fields: { target: "FeatureValue", stage: String(stage), "next stage": String(stage + 1) } } };
    };
    const result = await runStagePipeline({ request: current, outputRoot: root, stateFile: state, runner });
    assert.equal(result.status, "closed");
    if (stage === 7) stage7Artifact = result.artifact;
  }
  const stateValue = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(stateValue.currentStage, 8);
  assert.equal(stateValue.canonicalDigest, model.integrity.canonicalDigest);
  const artifactModel = unwrapModel(JSON.parse(fs.readFileSync(stage7Artifact, "utf8")));
  assert.equal(validateReportModel(artifactModel).ok, true);
  assert.equal(artifactModel.integrity.canonicalDigest, model.integrity.canonicalDigest);
  const output = path.join(root, "stage-8-documents");
  runStage8(artifactModel, output, stateValue.canonicalDigest);
  const manifestFile = path.join(output, "manifest.json");
  runState(["advance", "--state", state, "--stage", "8", "--artifact", manifestFile]);
  assert.equal(runState(["complete-run", "--state", state]).execution.runStatus, "complete");
});
test("real stage runners hand canonical artifacts to the Stage 8 CLI and complete state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-real-e2e-")), source = path.join(root, "component.js"), state = path.join(root, "state.json"), outputRoot = path.join(root, "artifacts");
  fs.writeFileSync(source, "function FeatureValue() {}\nfunction FeatureCollection() { this.value = null; }\nfunction FeatureContainer() { this.featureState = new FeatureCollection(); }\nFeatureContainer.prototype.setFeatureState = function(value) { this.featureState = value; };\nrenderFeature();\n");
  runState(["init", "--state", state]);
  const repositoryScope = { repositories: [{ id: "fixture", root, role: "source" }] };
  const artifacts = [];
  const execute = async (request, dependencies) => { const result = await runStagePipeline({ request: { ...request, repositoryScope }, dependencies, stateFile: state, outputRoot }); artifacts.push(result.artifact); assert.equal(result.status, "closed"); return result.artifact; };
  let transitionArtifact = await execute({ stage: 0, coverageProfile: {}, target: "FeatureValue", scope: "fixture", scanSeeds: false, repos: [{ id: "fixture", path: root }], repositoryState: [{ id: "fixture", state: "fixture" }], tooling: [{ id: "rg", status: "available" }], seeds: { direct: ["FeatureValue"], aliases: ["featureState"] }, expectedLayers: ["model", "owner", "tests"], exclusions: [] });
  const ownership = { expectedIds: ["model", "container", "owner"], groups: [{ id: "model", order: "1", role: "model", object: "FeatureValue", relation: "defines", evidenceRefs: ["owners"] }, { id: "container", order: "2", role: "container", object: "FeatureCollection.value", relation: "contains", evidenceRefs: ["owners"] }, { id: "owner", order: "3", role: "owner", object: "FeatureContainer.featureState", relation: "owns", evidenceRefs: ["owners"] }].map((row, index) => ({ ...row, status: "candidate", evidenceRefs: [], anchor: { file: source, line: index + 1 } })) };
  transitionArtifact = await execute({ stage: 1, transitionArtifact, sourceRoot: root, ast: { queries: [{ id: "owners", command: "find", file: source, options: { terms: "FeatureValue,value,featureState" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 10 }] }, evidence: { checks: [{ id: "owners", file: source, pattern: { value: "FeatureValue|value|featureState", regex: true }, maxMatches: 10, maxGroups: 10 }] }, ownership, coverageContract: { categories: [{ id: "direct-model", status: "applicable", groupIds: ["model"] }, { id: "container", status: "applicable", groupIds: ["container"] }, { id: "owner-branches", status: "applicable", groupIds: ["owner"] }, { id: "serialization", status: "not-applicable", reason: "fixture" }, { id: "history-copy", status: "open", reason: "later" }, { id: "index-limitations", status: "not-applicable", reason: "fixture" }], baseline: { ownershipIds: ["model", "container", "owner"] } } }, { runGitNexusContext: () => ({ status: "candidate", requests: [], context: {} }) });
  transitionArtifact = await execute({ stage: 2, transitionArtifact, ast: {}, evidence: { checks: [] } }, { runAstBatch: () => ({ status: "candidate", stats: { parseCounts: {}, failed: 0 }, plan: { compiledBeforeParse: true, lateQueries: 0 }, results: [] }), runEvidenceChecks: () => ({ checks: [] }) });
  transitionArtifact = await execute({ stage: 3, transitionArtifact, consumerScopes: [] });
  transitionArtifact = await execute({ stage: 4, transitionArtifact, recipientFamilies: [{ id: "ui", receiver: "UI", relation: "renders", checks: [{ id: "render", file: source, pattern: "renderFeature" }] }] });
  transitionArtifact = await execute({ stage: 5, transitionArtifact, checks: [{ id: "path", file: source, pattern: "renderFeature" }], nameCoverage: { id: "renderer", scope: root, terms: ["renderFeature"] } }, { findExactNameCoverage: () => ({ id: "renderer", engine: "fixture", scope: root, terms: ["renderFeature"], filesScanned: 1, matchingFileCount: 1, matchingFiles: [source], fileDigest: "all", matchingFileDigest: "matches", query: {} }) });
  transitionArtifact = await execute({ stage: 6, transitionArtifact, mode: "feature-reference", featureReference: { target: "FeatureValue", referenceEntity: "Fixture", capabilities: [{ id: "definition", status: "not-applicable", evidenceRefs: [], reason: "fixture closes without a production definition" }] }, sourceSurfaces: [{ path: "component.js", layer: "model", role: "definition" }] });
  const stage7 = await execute({ stage: 7, target: "FeatureValue", scope: repositoryScope, priorArtifacts: [...artifacts], artifactBase: root, capabilities: [{ id: "definition", status: "not-applicable", evidenceRefs: [], reason: "fixture closes without a production definition" }], transition: { "next stage": "8" } });
  const output = path.join(root, "stage-8");
  const cli = spawnSync(process.execPath, [path.join(require("node:path").resolve(__dirname, "../../.."), "cli/src/commands/stage8_runner.js"), "--model", stage7, "--output-dir", output, "--state", state], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  runState(["advance", "--state", state, "--stage", "8", "--artifact", path.join(output, "manifest.json")]);
  const complete = runState(["complete-run", "--state", state]);
  assert.equal(complete.execution.runStatus, "complete");
});
