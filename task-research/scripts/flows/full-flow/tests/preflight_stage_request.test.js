"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { runStagePipeline } = require("../src/stage_pipeline.js");
const { defaultOutputRoot } = require("../src/stage_pipeline.js");
const { preflightStageRequest } = require("../src/preflight_stage_request.js");
const { writeStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { buildLineageFromPrevious } = require("../../../shared/artifacts/src/canonical/lineage.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-preflight-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scope = { repositories: [{ id: "a", root, role: "source" }, { id: "b", root, role: "consumer" }] };
  return { root, scope, outputRoot: path.join(root, "output") };
}

test("BDD: invalid family request fails before output preparation and runner", async t => {
  const f = fixture(t);
  const request = { stage: 4, target: "Feature", repositoryScope: f.scope, recipientFamilies: [
    { id: "same", receiver: "A", relation: "uses", checks: [{}] },
    { id: "same", receiver: "B", relation: "uses", checks: [{}] }
  ] };
  let calls = 0;
  await assert.rejects(runStagePipeline({ request, outputRoot: f.outputRoot, runner: () => { calls++; } }), /Duplicate recipient family/);
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(f.outputRoot), false);
});

test("Stage 0 missing direct seeds has the same preflight and pipeline rejection", async t => {
  const f = fixture(t);
  const request = { stage: 0, target: "Feature", repositoryScope: f.scope,
    coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] } };
  const direct = preflightStageRequest(request, { outputRoot: f.outputRoot });
  assert.equal(direct.status, "error");
  assert.match(direct.errors[0].message, /seeds\.direct/);
  await assert.rejects(runStagePipeline({ request, outputRoot: f.outputRoot }), /seeds\.direct/);
  assert.equal(fs.existsSync(f.outputRoot), false);
});

test("Stage 0 preflight rejects a missing coverage profile", t => {
  const f = fixture(t);
  const request = { stage: 0, target: "Feature", repositoryScope: f.scope, seeds: { direct: ["Feature"] } };
  const result = preflightStageRequest(request, { outputRoot: f.outputRoot });
  assert.equal(result.status, "error");
  assert.match(result.errors[0].message, /coverageProfile/);
  assert.equal(fs.existsSync(f.outputRoot), false);
});

test("Stage 6 preflight rejects ambiguous repository but preserves single-root coercion", t => {
  const f = fixture(t);
  const base = { stage: 6, target: "Feature", mode: "feature-reference", sourceSurfaces: [{ path: 123, layer: 456, role: 789 }] };
  const bad = preflightStageRequest({ ...base, repositoryScope: f.scope }, { outputRoot: f.outputRoot });
  assert.equal(bad.status, "error");
  assert.match(JSON.stringify(bad.errors), /repository/);
  const good = preflightStageRequest({ ...base, repositoryScope: { repositories: [f.scope.repositories[0]] } }, { outputRoot: f.outputRoot });
  assert.equal(good.status, "ok");
});

test("BDD: Stage 7 missing mandatory capability is rejected before output preparation", async t => {
  const f = fixture(t);
  const repositoryScope = { repositories: [f.scope.repositories[0]] };
  const files = [];
  for (let stage = 0; stage < 7; stage++) {
    const written = writeStageArtifact({
      outputDir: path.join(f.root, `prior-${stage}`), input: { stage },
      facts: { stage, status: "closed", repositoryScope,
        summary: { ...(stage === 0 ? { coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership", "input"] } } : {}),
          lineage: stage ? buildLineageFromPrevious(files.at(-1), stage, repositoryScope) : [] },
        capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: [] }] }
    });
    files.push(written.resultFile);
  }
  const request = { stage: 7, target: "Feature", repositoryScope, transitionArtifact: files[6], priorArtifacts: files,
    evidenceSelectors: [], confirmedUsages: [], referenceOnly: [], noise: [], openChecks: [], transition: { "next stage": "8" } };
  const direct = preflightStageRequest(request, { outputRoot: f.outputRoot });
  assert.equal(direct.status, "error");
  assert.match(JSON.stringify(direct.errors), /input|capabilit|scenarios/i);
  await assert.rejects(runStagePipeline({ request, outputRoot: f.outputRoot }), /input|capabilit|scenarios/i);
  assert.equal(fs.existsSync(f.outputRoot), false);
  let calls = 0;
  await assert.rejects(runStagePipeline({ request, outputRoot: f.outputRoot, runner: () => { calls++; } }), /input|capabilit|scenarios/i);
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(f.outputRoot), false);
});

test("CLI uses explicit output root for pending transaction", t => {
  const f = fixture(t);
  const requestFile = path.join(f.root, "request.json");
  const request = { stage: 6, target: "Feature", repositoryScope: f.scope, sourceSurfaces: [{ path: "a.js", layer: "model", role: "source" }] };
  fs.writeFileSync(requestFile, JSON.stringify(request));
  const cli = path.resolve(__dirname, "../../../cli/src/commands/preflight_stage_request.js");
  const rejected = spawnSync(process.execPath, [cli, "--request", requestFile, "--output-root", f.outputRoot], { encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.equal(JSON.parse(rejected.stdout).status, "error");
  const journal = path.join(f.outputRoot, ".transactions", "stage-6.json");
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  fs.writeFileSync(journal, "{}");
  const deferred = spawnSync(process.execPath, [cli, "--request", requestFile, "--output-root", f.outputRoot], { encoding: "utf8" });
  assert.equal(deferred.status, 0);
  assert.equal(JSON.parse(deferred.stdout).status, "deferred");
});

test("CLI and pipeline resolve the same default output root", t => {
  const f = fixture(t);
  const request = { stage: 6, target: "Feature", repositoryScope: { repositories: [f.scope.repositories[0]] },
    sourceSurfaces: [{ path: 123, layer: 456, role: 789 }] };
  const requestFile = path.join(f.root, "request.json");
  fs.writeFileSync(requestFile, JSON.stringify(request));
  const cli = path.resolve(__dirname, "../../../cli/src/commands/preflight_stage_request.js");
  const result = spawnSync(process.execPath, [cli, "--request", requestFile], { cwd: f.root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), preflightStageRequest(request, { outputRoot: defaultOutputRoot(request, f.root) }));
  assert.equal(fs.existsSync(defaultOutputRoot(request, f.root)), false);
});

test("pending Stage 0 retains profile validation before recovery", async t => {
  const f = fixture(t);
  const request = { stage: 0, target: "Feature", repositoryScope: f.scope,
    coverageProfile: { kind: "bounded", requiredCapabilities: [] } };
  const journal = path.join(f.outputRoot, ".transactions", "stage-0.json");
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  fs.writeFileSync(journal, "{}");
  assert.equal(preflightStageRequest(request, { outputRoot: f.outputRoot }).status, "error");
  await assert.rejects(runStagePipeline({ request, outputRoot: f.outputRoot }), /requiredCapabilities/);
  assert.equal(fs.readFileSync(journal, "utf8"), "{}");
});
