"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadResearchPackage, materializeStageRequest, planNextAction, runFullResearch } = require("../src/full_run.js");
const { runStagePipeline } = require("../src/stage_pipeline.js");
const { main: runState } = require("../../../state/src/stage_state.js");
const crypto = require("node:crypto");

function continuationFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scope-continuation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = packageValue(root);
  pkg.repositoryScope.repositories[0].root = root.replaceAll("\\", "/") + "/.";
  const consumer = path.join(root, "consumer");
  fs.mkdirSync(consumer);
  pkg.repositoryScope.repositories.push({ id: "consumer", root: consumer, role: "consumer" });
  const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "output");
  runState(["init", "--state", stateFile]);
  const request = { ...pkg.stages[0], stage: 0, target: pkg.target, repositoryScope: pkg.repositoryScope };
  return { root, pkg, request, stateFile, outputRoot };
}
function savedFiles(...files) { return new Map(files.map(file => [file, fs.readFileSync(file)])); }
function assertSaved(saved) { for (const [file, bytes] of saved) assert.deepEqual(fs.readFileSync(file), bytes, file); }

for (const [field, mutate] of [
  ["root", (scope, value) => { scope.repositories[0].root = value.pkg.repositoryScope.repositories[1].root; }],
  ["id", scope => { scope.repositories[0].id = "other"; }],
  ["role", scope => { scope.repositories[0].role = "consumer"; }],
  ["indexAlias", scope => { scope.repositories[0].indexAlias = "other-index"; }],
  ["exclusions", scope => { scope.repositories[0].exclusions = ["skip/**"]; }],
  ["symbolAliases", scope => { scope.repositories[0].symbolAliases = { Feature: ["Other"] }; }],
  ["layerRules", scope => { scope.repositories[0].layerRules = [{ pattern: "**", layer: "other" }]; }],
  ["repository order", scope => { scope.repositories.reverse(); }]
]) test(`BDD: continuation rejects changed ${field} before runner or mutation`, async t => {
  const value = continuationFixture(t);
  const first = await runStagePipeline({ ...value, runner: request => ({ stage: 0, target: request.target, status: "candidate" }) });
  const saved = savedFiles(first.artifact, first.evidence, first.manifest, value.stateFile);
  const pkg = structuredClone(value.pkg);
  mutate(pkg.repositoryScope, value);
  let calls = 0;
  await assert.rejects(runFullResearch({ ...value, package: pkg, runStagePipeline: () => { calls++; throw new Error("unexpected runner"); } }), /repositoryScope conflicts/);
  assert.equal(calls, 0);
  assertSaved(saved);
  assert.equal(fs.existsSync(path.join(value.outputRoot, "full-run-metrics.json")), false);
});

for (const damage of ["JSON", "digest", "missing scope"]) test(`BDD: selected Stage 0 with damaged ${damage} cannot fall back to package scope`, async t => {
  const value = continuationFixture(t);
  const first = await runStagePipeline({ ...value, runner: request => ({ stage: 0, target: request.target, status: "candidate" }) });
  if (damage === "JSON") fs.writeFileSync(first.artifact, "{");
  else {
    const canonical = JSON.parse(fs.readFileSync(first.artifact));
    if (damage === "digest") canonical.outputDigest = "0".repeat(64);
    else {
      delete canonical.summary.repositoryScope;
      canonical.outputDigest = require("../../../shared/artifacts/src/canonical/validation.js").digest({ ...canonical, outputDigest: undefined });
    }
    fs.writeFileSync(first.artifact, JSON.stringify(canonical));
  }
  const saved = savedFiles(first.artifact, first.evidence, first.manifest, value.stateFile);
  let calls = 0;
  await assert.rejects(runFullResearch({ ...value, package: value.pkg, runStagePipeline: () => { calls++; throw new Error("unexpected runner"); } }));
  assert.equal(calls, 0);
  assertSaved(saved);
});

test("BDD: active Stage 0 wins over an unrelated Stage 0 in the supplied output root", async t => {
  const value = continuationFixture(t);
  const first = await runStagePipeline({ ...value, runner: request => ({ stage: 0, target: request.target, status: "candidate" }) });
  const otherOutput = path.join(value.root, "other-output");
  const unrelated = require("../../../shared/artifacts/src/stage_artifact_v4.js").writeStageArtifact({ outputDir: path.join(otherOutput, "stage-0"),
    facts: { stage: 0, target: "Unrelated", status: "partial", repositoryScope: value.pkg.repositoryScope } });
  const saved = savedFiles(first.artifact, first.evidence, first.manifest, unrelated.resultFile);
  let calls = 0;
  const result = await runFullResearch({ ...value, outputRoot: otherOutput, package: value.pkg, runStagePipeline: options => {
    calls++;
    assert.deepEqual(options.request.repositoryScope, value.pkg.repositoryScope);
    return runStagePipeline({ ...options, runner: request => ({ stage: request.stage, target: request.target, status: "candidate", openChecks: ["later"] }) });
  } });
  assert.equal(result.stage, 1);
  assert.equal(calls, 1);
  assertSaved(saved);
});

test("BDD: full_run continues raw Stage 0 scope without changing closed lineage", async t => {
  const value = continuationFixture(t);
  const first = await runStagePipeline({ ...value, runner: request => ({ stage: 0, target: request.target, status: "candidate" }) });
  const saved = savedFiles(first.artifact, first.evidence, first.manifest);
  const input = structuredClone(value.pkg), stages = [];
  const result = await runFullResearch({ ...value, package: value.pkg, runStagePipeline: options => {
    stages.push(options.request.stage);
    assert.deepEqual(options.request.repositoryScope, value.pkg.repositoryScope);
    return runStagePipeline({ ...options, runner: request => ({ stage: request.stage, target: request.target, status: "candidate", ...(request.stage === 2 ? { openChecks: ["later"] } : {}) }) });
  } });
  assert.equal(result.stage, 2);
  assert.deepEqual(stages, [1, 2]);
  assert.equal(JSON.parse(fs.readFileSync(value.stateFile)).currentStage, 2);
  assert.deepEqual(value.pkg, input);
  assertSaved(saved);
});

for (const partialStage of [0, 1]) test(`BDD: raw ordinary partial Stage ${partialStage} closes with exact history and requirements`, async t => {
  const value = continuationFixture(t);
  let closed;
  if (partialStage === 1) closed = await runStagePipeline({ ...value, runner: request => ({ stage: 0, target: request.target, status: "candidate" }) });
  const file = path.join(value.root, "proof.js");
  fs.writeFileSync(file, "owner();\n");
  const requirement = { check: "confirm owner", type: "source-confirmation", repository: "source", file: "proof.js" };
  const partial = await runStagePipeline({ ...value, request: { ...value.request, stage: partialStage,
    openChecks: [requirement.check], checkRequirements: [requirement] }, runner: request => ({ stage: partialStage, target: request.target, status: "candidate" }) });
  assert.equal(partial.status, "partial");
  const prior = JSON.parse(fs.readFileSync(partial.artifact)), priorBytes = fs.readFileSync(partial.artifact);
  const proof = { id: "proof", repository: "source", file, line: 1, endLine: 1, sourceFragment: "owner();", status: "source-confirmed",
    sourceHash: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
  value.pkg.stages[partialStage].checkResolutions = [{ kind: "check-resolution", check: requirement.check, originDigest: prior.outputDigest,
    disposition: "checked", reason: "Exact source inspected", evidenceRefs: [proof.id] }];
  const saved = closed ? savedFiles(closed.artifact, closed.evidence, closed.manifest) : new Map();
  const stages = [];
  await runFullResearch({ ...value, package: value.pkg, runStagePipeline: options => {
    stages.push(options.request.stage);
    assert.deepEqual(options.request.repositoryScope, value.pkg.repositoryScope);
    return runStagePipeline({ ...options, runner: request => ({ stage: request.stage, target: request.target, status: "candidate",
      ...(request.stage === partialStage ? { canonicalEvidence: [proof] } : { openChecks: ["later"] }) }) });
  } });
  assert.deepEqual(stages, [partialStage, partialStage + 1]);
  const canonical = JSON.parse(fs.readFileSync(partial.artifact));
  assert.equal(canonical.status, "closed");
  assert.deepEqual(canonical.openChecks, []);
  assert.deepEqual(canonical.summary.checkRequirements, prior.summary.checkRequirements);
  const history = canonical.summary.checkHistory;
  assert.equal(history.at(-1).outputDigest, prior.outputDigest);
  assert.deepEqual(fs.readFileSync(history.at(-1).artifact), priorBytes);
  assert.ok(canonical.facts.some(row => row.kind === "check-resolution" && row.originDigest === prior.outputDigest));
  assertSaved(saved);
});

function packageValue(root) {
  return {
    schemaVersion: "research-package/1.0.0",
    target: "Feature",
    repositoryScope: { repositories: [{ id: "source", root, role: "source" }] },
    stages: Object.fromEntries(Array.from({ length: 8 }, (_, stage) => [String(stage), stage === 0 ? { coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, seeds: { direct: ["Feature"] } } : {}]))
  };
}

test("package loader normalizes roots, freezes templates, and rejects runtime fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-package-"));
  const file = path.join(root, "package.json");
  fs.writeFileSync(file, JSON.stringify(packageValue(root)));
  const value = loadResearchPackage(file);
  assert.equal(value.repositoryScope.repositories[0].root, path.resolve(root));
  assert.equal(Object.isFrozen(value.stages["0"]), true);
  assert.throws(() => loadResearchPackage({ ...packageValue(root), stages: { ...packageValue(root).stages, "2": { transitionArtifact: "manual" } } }), /transitionArtifact/);
  assert.throws(() => loadResearchPackage({ ...packageValue(root), stages: { "0": { coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] } } } }), /stages 0 through 7/);
  assert.throws(() => loadResearchPackage({ ...packageValue(root), stages: { ...packageValue(root).stages, "0": { coverageProfile: { kind: "bounded", requiredCapabilities: ["unknown"] }, seeds: { direct: ["Feature"] } } } }), /Unknown capability/);
  assert.throws(() => loadResearchPackage({ ...packageValue(root), stages: { ...packageValue(root).stages, "0": { coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] } } } }), /seeds\.direct/);
});

test("BDD: Stage 6 is skipped only for a recorded skip decision", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-skip-package-"));
  const legacy = loadResearchPackage(packageValue(root));
  assert.equal(materializeStageRequest(legacy, 6, { canonicalArtifact: path.join(root, "stage5.json") }).mode, undefined);
  const pkg = packageValue(root);
  pkg.stages[0].stage6Decision = "skip";
  const selected = loadResearchPackage(pkg);
  assert.equal(materializeStageRequest(selected, 6, { canonicalArtifact: path.join(root, "stage5.json") }).mode, "skip");
});

test("BDD: continuation rejects a changed Stage 6 decision before another runner call", async t => {
  const value = continuationFixture(t);
  value.pkg.stages[0].stage6Decision = "skip";
  const first = await runStagePipeline({ ...value, request: { ...value.request, stage6Decision: "skip" }, runner: request => ({ stage: 0, target: request.target, status: "candidate", summary: { stage6Decision: request.stage6Decision } }) });
  const saved = savedFiles(first.artifact, first.evidence, first.manifest, value.stateFile);
  const changed = structuredClone(value.pkg);
  changed.stages[0].stage6Decision = "run";
  let calls = 0;
  await assert.rejects(runFullResearch({ ...value, package: changed, runStagePipeline: () => { calls++; throw new Error("unexpected runner"); } }), /Stage 6 decision conflicts/);
  assert.equal(calls, 0);
  assertSaved(saved);
});

test("action planner follows persisted state without rerunning closed stages", () => {
  assert.deepEqual(planNextAction(null), { kind: "run-stage", stage: 0 });
  assert.deepEqual(planNextAction({ currentStage: 3, lastCompletedStage: 2, execution: { runStatus: "running" } }), { kind: "run-stage", stage: 3 });
  assert.deepEqual(planNextAction({ currentStage: 8, lastCompletedStage: 7, execution: { runStatus: "running" } }), { kind: "run-stage-8", stage: 8 });
  assert.deepEqual(planNextAction({ currentStage: 9, lastCompletedStage: 8, execution: { runStatus: "running" } }), { kind: "complete-run" });
  assert.deepEqual(planNextAction({ currentStage: 9, lastCompletedStage: 8, execution: { runStatus: "complete" } }), { kind: "already-complete" });
  assert.deepEqual(planNextAction({ currentStage: 4, lastCompletedStage: 3, execution: { runStatus: "stopped" } }), { kind: "stop", reason: "state-stopped" });
});

test("materializer derives lineage and selector artifacts from active state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-materialize-"));
  const pkg = loadResearchPackage({ ...packageValue(root), stages: { ...packageValue(root).stages,
    "7": { evidenceSelectors: [{ stage: 2, limit: 12 }] }
  } });
  const artifacts = Array.from({ length: 7 }, (_, stage) => ({ stage, artifact: path.join(root, `stage-${stage}.json`) }));
  const state = { currentStage: 7, lastCompletedStage: 6, canonicalArtifact: artifacts[6].artifact, activeArtifacts: artifacts };
  const request = materializeStageRequest(pkg, 7, state);
  assert.equal(request.transitionArtifact, artifacts[6].artifact);
  assert.deepEqual(request.priorArtifacts, artifacts.map(row => row.artifact));
  assert.deepEqual(request.evidenceSelectors, [{ artifact: artifacts[2].artifact, limit: 12 }]);
  assert.equal(pkg.stages["7"].evidenceSelectors[0].artifact, undefined);
});

test("Stage 7 automatic handoff rejects manual report input",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"research-stage7-auto-")),base=packageValue(root);for(const field of ["evidenceSelectors","capabilities","criticalPaths"]){const stages=structuredClone(base.stages);stages["7"]={buildFromStage6:true,[field]:[]};assert.throws(()=>loadResearchPackage({...base,stages}),new RegExp(field));}});

test("coordinator retries a partial stage and rejects scope drift before another runner call", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageFile = path.join(root, "package.json"), stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "output");
  fs.writeFileSync(packageFile, JSON.stringify(packageValue(root)));
  let calls = 0;
  const controlledPipeline = options => runStagePipeline({ ...options, runner: request => {
    calls += 1;
    return { stage: request.stage, target: request.target, status: calls === 2 ? "candidate" : "partial" };
  } });
  assert.equal((await runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: controlledPipeline })).status, "partial");
  assert.equal((await runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: controlledPipeline })).stage, 1);
  const metrics = JSON.parse(fs.readFileSync(path.join(outputRoot, "full-run-metrics.json"), "utf8"));
  assert.deepEqual(metrics.stages.map(row => row.action), ["run-stage", "retry-partial", "run-stage"]);
  const other = path.join(root, "other"); fs.mkdirSync(other);
  fs.writeFileSync(packageFile, JSON.stringify(packageValue(other)));
  const before = calls;
  await assert.rejects(runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: controlledPipeline }), /repositoryScope conflicts/);
  assert.equal(calls, before);
});

test("continuation rejects target drift and Stage 0 partial coverage drift", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-contract-drift-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageFile = path.join(root, "package.json"), stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "output");
  const original = packageValue(root);
  fs.writeFileSync(packageFile, JSON.stringify(original));
  let calls = 0;
  const partialPipeline = options => runStagePipeline({ ...options, runner: request => { calls += 1; return { stage: request.stage, target: request.target, status: "partial" }; } });
  await runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: partialPipeline });
  fs.writeFileSync(packageFile, JSON.stringify({ ...original, target: "Other" }));
  await assert.rejects(runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: partialPipeline }), /target conflicts/);
  fs.writeFileSync(packageFile, JSON.stringify({ ...original, stages: { ...original.stages, "0": { ...original.stages["0"], coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"], requiredCollections: ["ownership"] } } } }));
  await assert.rejects(runFullResearch({ packageFile, stateFile, outputRoot, runStagePipeline: partialPipeline }), /coverageProfile conflicts/);
  assert.equal(calls, 1);
});
