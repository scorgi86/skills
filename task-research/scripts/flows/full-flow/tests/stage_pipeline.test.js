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
const { runAstBatch } = require("../../../shared/ast/src/batch/batch.js");
const { SourceSnapshotStore } = require("../../../shared/evidence/src/source_snapshot.js");
const { writeCanonicalTransition } = require("../../../shared/dto/tests/test_helpers.js");

function astSemantic(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.stats.elapsedMs; delete copy.stats.cacheHits; delete copy.stats.cacheMisses;
  for (const result of copy.results || []) delete result.elapsedMs;
  if (copy.output) { delete copy.output.bytes; delete copy.output.budgetRequired; }
  return copy;
}

test("BDD: pipeline shares one source snapshot between evidence collection and deferred canonicalization", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-source-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "source.js");
  const text = "const Feature = true;\n";
  fs.writeFileSync(file, text);
  const sourceHash = crypto.createHash("sha256").update(text).digest("hex");
  const repositoryScope = { repositories: [{ id: "source", root, role: "source" }] };
  let reads = 0;
  const sourceSnapshots = new SourceSnapshotStore({ readFileSync(target) { reads += 1; return fs.readFileSync(target); } });
  const outputRoot = path.join(root, "output");
  let transitionArtifact = (await runStagePipeline({ outputRoot, request: { stage: 0, target: "Feature", coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, repositoryScope },
    runner: () => ({ stage: 0, status: "candidate" }) })).artifact;
  transitionArtifact = (await runStagePipeline({ outputRoot, request: { stage: 1, target: "Feature", transitionArtifact, repositoryScope },
    runner: () => ({ stage: 1, status: "candidate", transition: { fields: {
      target: "Feature", scope: "source", stage: "1", status: "closed", "confirmed evidence": "source",
      "candidate evidence": "none", "dictionary/graph/path state": "ready", "skipped/forbidden": "none",
      "open checks": "stage 2", "next stage": "2"
    } } }) })).artifact;
  const result = await runStagePipeline({ outputRoot, dependencies: { sourceSnapshots, runAstBatch: async () => ({ status: "candidate", results: [], stats: { parseCounts: {} }, plan: { compiledBeforeParse: true, lateQueries: 0 } }) }, request: {
    stage: 2, target: "Feature", transitionArtifact, repositoryScope, repository: "source", ast: { queries: [] },
    evidence: { checks: [{ id: "feature", file, repository: "source", pattern: "Feature", confirmation: {
      status: "source-confirmed", line: 1, endLine: 1, sourceFragment: text.trim(), sourceHash
    } }] }
  } });
  assert.equal(reads, 1);
  const canonical = JSON.parse(fs.readFileSync(result.artifact, "utf8"));
  const evidence = JSON.parse(fs.readFileSync(result.evidence, "utf8")).evidence;
  assert.ok(evidence.some(row => row.confirmation?.status === "source-confirmed"));
  assert.doesNotMatch(JSON.stringify(canonical), /sourceSnapshots|SourceSnapshotStore|"type":"Buffer"/);
});

test("pipeline carries declared planning facts into canonicalization input", async () => { const result = carryPlanningFacts({ gaps: [{ id: "gap", expectedPath: "export" }] }, { stage: 6, status: "candidate", gaps: [{ id: "gap", status: "partial" }] }); assert.equal(result.gaps.length, 1); assert.equal(result.gaps[0].expectedPath, "export"); assert.equal(result.gaps[0].status, "partial"); });

test("BDD: Stage 1 pipeline keeps large evidence outside its facts budget", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-stage1-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "component.js");
  fs.writeFileSync(source, Array.from({ length: 300 }, (_, index) => `const FeatureValue${index} = FeatureValue; // retained evidence ${"x".repeat(48)}`).join("\n"));
  const repositoryScope = { repositories: [{ id: "fixture", root, role: "source" }] };
  const transitionArtifact = writeCanonicalTransition(root, 0, { facts: { repositoryScope } });
  const result = await runStagePipeline({ outputRoot: path.join(root, "artifacts"), dependencies: { runGitNexusContext: () => ({ status: "candidate", requests: [], context: {} }) }, request: {
    stage: 1, target: "FeatureValue", transitionArtifact, repositoryScope, sourceRoot: root,
    budgets: { factsBytes: 8 * 1024, summaryBytes: 8 * 1024 },
    ast: { queries: [{ id: "owners", command: "find", file: source, options: { terms: "FeatureValue" }, includeDetails: true, maxDetails: 300 }] },
    evidence: { checks: [{ id: "owners", file: source, pattern: "FeatureValue", maxMatches: 300 }] },
    ownership: { expectedIds: ["model"], groups: [{ id: "model", order: 1, role: "model", object: "FeatureValue", relation: "defines", anchor: { file: source, line: 1 }, evidenceRefs: [] }] },
    coverageContract: { categories: [{ id: "direct-model", status: "applicable", groupIds: ["model"] }], baseline: { ownershipIds: ["model"] } }
  } });
  assert.equal(result.status, "closed");
  const evidence = JSON.parse(fs.readFileSync(result.evidence, "utf8")).evidence;
  assert.ok(evidence.length >= 300);
});

test("fact ids do not implicitly attach every result of a same-named query", () => {
  const { prepareFacts } = require("../../../shared/artifacts/src/canonical/facts.js");
  const facts = prepareFacts({ stage: 1, status: "candidate", ownership: { groups: [
    { id: "owners", status: "confirmed", evidenceRefs: ["selected"] }
  ] }, canonicalEvidence: [
    { id: "selected", repository: "", file: "selected.js", line: 1, endLine: 1, usageKind: "source-text", provenance: { queryId: "owners" } },
    { id: "other", repository: "", file: "other.js", line: 1, endLine: 1, usageKind: "source-text", provenance: { queryId: "owners" } }
  ] });
  assert.equal(facts.ownership.groups[0].evidenceRefs.length, 1);
  const selected = facts.canonicalEvidence.find(row => row.aliases.includes("selected"));
  assert.deepEqual(facts.ownership.groups[0].evidenceRefs, [selected.id]);
});

test("pipeline carries only referenced evidence from validated lineage", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-referenced-evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.js");
  fs.writeFileSync(source, "const FeatureValue = true;\nconst UnusedValue = false;\n");
  const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  const repositoryScope = { repositories: [{ id: "source", root, role: "source" }] };
  const state = path.join(root, "state.json"), outputRoot = path.join(root, "artifacts");
  runState(["init", "--state", state]);
  const first = await runStagePipeline({ request: { stage: 0, target: "FeatureValue", coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, repositoryScope }, outputRoot, stateFile: state,
    runner: () => ({ stage: 0, status: "candidate", canonicalEvidence: [
      { id: "used", status: "source-confirmed", repository: "source", file: source, sourceHash, line: 1, endLine: 1, sourceFragment: "const FeatureValue = true;", evidenceRefs: ["used"] },
      { id: "unused", status: "source-confirmed", repository: "source", file: source, sourceHash, line: 2, endLine: 2, sourceFragment: "const UnusedValue = false;", evidenceRefs: ["unused"] }
    ] }) });
  const second = await runStagePipeline({ request: { stage: 1, target: "FeatureValue", repositoryScope, transitionArtifact: first.artifact,
    scenarios: [{ id: "scenario", status: "confirmed", evidenceRefs: ["used"] }] }, outputRoot, stateFile: state,
    runner: () => ({ stage: 1, status: "candidate" }) });
  const bundle = JSON.parse(fs.readFileSync(path.join(path.dirname(second.artifact), "evidence.json"), "utf8"));
  assert.equal(bundle.evidence.length, 1);
  assert.ok(bundle.evidence[0].aliases.includes("used"));
  assert.ok(!bundle.evidence[0].aliases.includes("unused"));
});

function request(root, stage = 0) { return { stage, ...(stage === 0 ? { coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] } } : {}), target: "FeatureValue", repositoryScope: { repositories: [{ id: "source", root, role: "source" }] } }; }

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
  const sibling = path.join(path.dirname(root), `${path.basename(root)}-sibling`);
  assert.equal(withRuntimeAstCache({ ...base, stage: 1, ast: {} }, root).ast.cache,
    withRuntimeAstCache({ ...base, stage: 1, ast: {} }, sibling).ast.cache);
  const otherParent = path.join(root, "other-parent", "inventory");
  assert.notEqual(withRuntimeAstCache({ ...base, stage: 1, ast: {} }, root).ast.cache,
    withRuntimeAstCache({ ...base, stage: 1, ast: {} }, otherParent).ast.cache);
});

test("BDD: sibling inventories reuse AST analysis with the same semantics", async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-sibling-cache-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const repository = path.join(parent, "repository"); fs.mkdirSync(repository);
  const source = path.join(repository, "feature.js"); fs.writeFileSync(source, "class FeatureValue {}\n");
  const repositoryScope = { repositories: [{ id: "source", root: repository, role: "source" }] };
  const execute = async (leaf, target) => {
    const outputRoot = path.join(parent, leaf);
    const first = await runStagePipeline({ request: { stage: 0, target, coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, repositoryScope }, outputRoot,
      runner: () => ({ stage: 0, status: "candidate" }) });
    let ast;
    await runStagePipeline({ request: { stage: 1, target, repositoryScope, transitionArtifact: first.artifact, ast: {} }, outputRoot,
      runner(stageRequest) {
        return runAstBatch({ ...stageRequest.ast, queries: [{ id: "feature", command: "symbols", file: source, includeDetails: true }] }).then(value => {
          ast = value;
          return { stage: 1, status: "candidate", ast };
        });
      } });
    return ast;
  };
  const cold = await execute("inventory-a", "Feature A");
  const warm = await execute("inventory-b", "Feature B");
  assert.equal(cold.stats.cacheMisses, 1);
  assert.equal(warm.stats.cacheHits, 1);
  assert.equal(warm.stats.queries, 1);
  assert.deepEqual(astSemantic(warm), astSemantic(cold));
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
  const direct = await require("../../../steps/step-2/src/runner.js").runStage2({ ...base, stage: 2, transitionArtifact, ast: {}, evidence: { checks: [] } }, dependencies);
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
  let transitionArtifact = await execute({ stage: 0, coverageProfile: { kind: "bounded", requiredCapabilities: ["definition"] }, target: "FeatureValue", scope: "fixture", scanSeeds: false, repos: [{ id: "fixture", path: root }], repositoryState: [{ id: "fixture", state: "fixture" }], tooling: [{ id: "rg", status: "available" }], seeds: { direct: ["FeatureValue"], aliases: ["featureState"] }, expectedLayers: ["model", "owner", "tests"], exclusions: [] });
  const ownership = { expectedIds: ["model", "container", "owner"], groups: [{ id: "model", order: "1", role: "model", object: "FeatureValue", relation: "defines", evidenceRefs: ["owners"] }, { id: "container", order: "2", role: "container", object: "FeatureCollection.value", relation: "contains", evidenceRefs: ["owners"] }, { id: "owner", order: "3", role: "owner", object: "FeatureContainer.featureState", relation: "owns", evidenceRefs: ["owners"] }].map((row, index) => ({ ...row, status: "candidate", evidenceRefs: [], anchor: { file: source, line: index + 1 } })) };
  transitionArtifact = await execute({ stage: 1, transitionArtifact, sourceRoot: root, ast: { queries: [{ id: "owners", command: "find", file: source, options: { terms: "FeatureValue,value,featureState" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 10 }] }, evidence: { checks: [{ id: "owners", file: source, pattern: { value: "FeatureValue|value|featureState", regex: true }, maxMatches: 10, maxGroups: 10 }] }, ownership, coverageContract: { categories: [{ id: "direct-model", status: "applicable", groupIds: ["model"] }, { id: "container", status: "applicable", groupIds: ["container"] }, { id: "owner-branches", status: "applicable", groupIds: ["owner"] }, { id: "serialization", status: "not-applicable", reason: "fixture" }, { id: "history-copy", status: "open", reason: "later" }, { id: "index-limitations", status: "not-applicable", reason: "fixture" }], baseline: { ownershipIds: ["model", "container", "owner"] } } }, { runGitNexusContext: () => ({ status: "candidate", requests: [], context: {} }) });
  transitionArtifact = await execute({ stage: 2, transitionArtifact, ast: {}, evidence: { checks: [] } }, { runAstBatch: () => ({ status: "candidate", stats: { parseCounts: {}, failed: 0 }, plan: { compiledBeforeParse: true, lateQueries: 0 }, results: [] }), runEvidenceChecks: () => ({ checks: [] }) });
  transitionArtifact = await execute({ stage: 3, transitionArtifact, consumerScopes: [] });
  transitionArtifact = await execute({ stage: 4, transitionArtifact, recipientFamilies: [{ id: "ui", receiver: "UI", relation: "renders", checks: [{ id: "render", file: source, pattern: "renderFeature" }] }] });
  transitionArtifact = await execute({ stage: 5, transitionArtifact, checks: [{ id: "path", file: source, pattern: "renderFeature" }], nameCoverage: { id: "renderer", scope: root, terms: ["renderFeature"] } }, { findExactNameCoverage: () => ({ id: "renderer", engine: "fixture", scope: root, terms: ["renderFeature"], filesScanned: 1, matchingFileCount: 1, matchingFiles: [source], fileDigest: "all", matchingFileDigest: "matches", query: {} }) });
  transitionArtifact = await execute({ stage: 6, transitionArtifact, mode: "feature-reference", featureReference: { target: "FeatureValue", referenceEntity: "Fixture", capabilities: [{ id: "definition", status: "not-applicable", evidenceRefs: [], reasonCode: "architecture", explanation: "The fixture closes without a production definition" }] }, sourceSurfaces: [{ path: "component.js", layer: "model", role: "definition" }] });
  const stage7 = await execute({ stage: 7, target: "FeatureValue", scope: repositoryScope, priorArtifacts: [...artifacts], artifactBase: root, capabilities: [{ id: "definition", status: "not-applicable", evidenceRefs: [], reasonCode: "architecture", explanation: "The fixture closes without a production definition" }], transition: { "next stage": "8" } });
  const output = path.join(root, "stage-8");
  const cli = spawnSync(process.execPath, [path.join(require("node:path").resolve(__dirname, "../../.."), "cli/src/commands/stage8_runner.js"), "--model", stage7, "--output-dir", output, "--state", state], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  runState(["advance", "--state", state, "--stage", "8", "--artifact", path.join(output, "manifest.json")]);
  const complete = runState(["complete-run", "--state", state]);
  assert.equal(complete.execution.runStatus, "complete");
});
