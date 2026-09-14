"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { IDS } = require("../../shared/dto/src/capability_contract.js");
const { normalizeRepositoryScope } = require("../../shared/dto/src/repository_scope.js");
const { normalizeCoverageProfile } = require("../../shared/report/src/model/coverage.js");
const { writeStageArtifact } = require("../../shared/artifacts/src/stage_artifact_v4.js");
const { buildLineageFromPrevious } = require("../../shared/artifacts/src/canonical/lineage.js");
const { StateStore } = require("../../state/src/persistence/state_store.js");
const { initialState } = require("../../state/src/state_model.js");
const { InventorySession } = require("../../state/src/session/inventory_session.js");
const { runFullResearch } = require("../../flows/full-flow/src/full_run.js");
const { buildStage7 } = require("../../steps/step-7/src/runner.js");
function fixture(t, kind = "full-inventory") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "profile-bdd-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const text = "function loadEffect() { return 1; }\n";
  fs.writeFileSync(path.join(root, "source.js"), text);
  const repositoryScope = normalizeRepositoryScope({ repositories: [{ id: "source", root, role: "source" }] });
  const profile = normalizeCoverageProfile(kind ? { kind, requiredCapabilities: [...IDS], requiredCollections: ["scenarios", "criticalPaths", ...(kind === "full-development" ? ["gaps", "implementationEntryPoints"] : [])] } : { requiredCapabilities: ["definition"] });
  const evidence = { id: "ev-source", status: "source-confirmed", repository: "source", file: "source.js", line: 1, endLine: 1, sourceFragment: text.trimEnd(), sourceHash: crypto.createHash("sha256").update(text).digest("hex") };
  const capabilities = [...IDS].map(id => id === "definition" ? { id, status: "confirmed", evidenceRefs: [evidence.id] } : { id, status: "not-applicable", reasonCode: "architecture", explanation: `Fixture does not implement the ${id} layer` });
  const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "artifacts"), files = [];
  new StateStore(stateFile).create(initialState("continuous"));
  // Saved canonical fixtures bypass execution of new Stage 0; no-kind fixtures
  // exercise an existing research run, not the new-run enforcement seam.
  for (let stage = 0; stage <= 6; stage++) {
    const artifact = writeStageArtifact({ outputDir: path.join(outputRoot, `stage-${stage}`), facts: { stage, status: "closed", target: "Effect", repositoryScope, summary: { coverageProfile: profile, lineage: stage ? buildLineageFromPrevious(files.at(-1), stage, repositoryScope) : [] }, capabilities: stage === 0 ? capabilities : [], canonicalEvidence: [evidence] }, input: { stage } });
    files.push(artifact.resultFile);
    InventorySession.open({ stateFile }).advanceStage(stage, artifact.resultFile);
  }
  const request = { stage: 7, target: "Effect", repositoryScope, priorArtifacts: files, expectedArtifact: files.at(-1), evidenceSelectors: [{ artifact: files[0], limit: 10 }], capabilities, scenarios: [{ id: "open-effect", status: "confirmed", entry: "Open document", steps: ["Invoke loadEffect"], result: "Effect state loaded", evidenceRefs: [evidence.id] }], criticalPaths: [{ id: "read-effect", status: "confirmed", statement: "Reader loads effect state", evidenceRefs: [evidence.id] }] };
  const pkg = { schemaVersion: "research-package/1.0.0", target: "Effect", repositoryScope, stages: Object.fromEntries(Array.from({ length: 8 }, (_, stage) => [stage, stage === 0 ? { coverageProfile: profile, seeds: { direct: ["Effect"] } } : stage === 7 ? { capabilities, scenarios: request.scenarios, criticalPaths: request.criticalPaths, evidenceSelectors: [{ stage: 0, limit: 10 }] } : {}])) };
  return { root, profile, files, request, pkg, stateFile, outputRoot };
}
test("BDD: full inventory keeps obligations and renders a structured scenario", async t => {
  const value = fixture(t);
  const result = await runFullResearch({ package: value.pkg, stateFile: value.stateFile, outputRoot: value.outputRoot });
  assert.equal(result.status, "complete");
  const state = JSON.parse(fs.readFileSync(value.stateFile));
  const model = JSON.parse(fs.readFileSync(state.stage7Artifact)).facts[0].model;
  assert.equal(model.coverage.profile.kind, "full-inventory");
  assert.deepEqual(model.coverage.profile.requiredCapabilities, [...IDS]);
  const markdown = fs.readFileSync(path.join(value.outputRoot, "stage-8", "implementation-map.md"), "utf8");
  for (const text of ["Open document", "Invoke loadEffect", "Effect state loaded"]) assert.ok(markdown.includes(text));
  assert.throws(() => buildStage7({ ...value.request, coverageProfile: { ...value.profile, kind: "bounded" } }), /coverageProfile conflicts/);
});
test("BDD: required reference-only capability prevents Stage 7 and Stage 8", async t => {
  const value = fixture(t);
  value.pkg.stages[7].capabilities = value.pkg.stages[7].capabilities.map(row => row.id === "render-output" ? { id: row.id, status: "reference-only", reason: "Only an analog was found" } : row);
  await assert.rejects(runFullResearch({ package: value.pkg, stateFile: value.stateFile, outputRoot: value.outputRoot }), /render-output.*must be confirmed/);
  assert.equal(JSON.parse(fs.readFileSync(value.stateFile)).currentStage, 7);
  assert.equal(fs.existsSync(path.join(value.outputRoot, "stage-8")), false);
});
test("BDD: full development rejects implementation and test gaps without entry links", async t => {
  const value = fixture(t, "full-development");
  value.pkg.stages[7].gaps = ["implementation-gap", "test-gap"].map(category => ({ id: category, category, status: "confirmed", statement: "Expected effect path is absent", expectedPath: "source.js", evidenceRefs: ["ev-source"] }));
  value.pkg.stages[7].implementationEntryPoints = [{ id: "entry", status: "confirmed", path: "source.js", evidenceRefs: ["ev-source"], gapRefs: [] }];
  await assert.rejects(runFullResearch({ package: value.pkg, stateFile: value.stateFile, outputRoot: value.outputRoot }), /must be linked/);
  assert.equal(fs.existsSync(path.join(value.outputRoot, "stage-8")), false);
  value.pkg.stages[7].implementationEntryPoints[0].gapRefs = ["implementation-gap", "test-gap"];
  assert.equal((await runFullResearch({ package: value.pkg, stateFile: value.stateFile, outputRoot: value.outputRoot })).status, "complete");
});
test("BDD: saved no-kind Stage 7 finalizes through full-run and complete repeat is read-only", async t => {
  const value = fixture(t, null);
  const model = buildStage7(value.request);
  const written = writeStageArtifact({ outputDir: path.join(value.outputRoot, "stage-7"), facts: model, input: value.request });
  InventorySession.open({ stateFile: value.stateFile }).advanceStage(7, written.resultFile);
  const saved = value.files.map(file => fs.readFileSync(file));
  const result = await runFullResearch({ package: value.pkg, stateFile: value.stateFile, outputRoot: value.outputRoot });
  assert.equal(result.status, "complete");
  assert.equal(Object.hasOwn(model.coverage.profile, "kind"), false);
  value.files.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), saved[index]));
  const state = fs.readFileSync(value.stateFile), metrics = fs.readFileSync(result.metrics), report = fs.readFileSync(written.resultFile);
  assert.equal((await runFullResearch({ package: value.pkg, stateFile: value.stateFile, outputRoot: value.outputRoot })).action, "already-complete");
  assert.deepEqual(fs.readFileSync(value.stateFile), state);
  assert.deepEqual(fs.readFileSync(result.metrics), metrics);
  assert.deepEqual(fs.readFileSync(written.resultFile), report);
});
