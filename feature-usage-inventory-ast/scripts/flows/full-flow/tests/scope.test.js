"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { randomUUID } = require("node:crypto"), { spawnSync } = require("node:child_process");
const { runStagePipeline } = require("../src/stage_pipeline.js");
const { runStageUnitOfWork } = require("../../../state/src/session/stage_unit_of_work.js");
const { writeStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { digest } = require("../../../shared/artifacts/src/canonical/validation.js");
const { main: state } = require("../../../state/src/stage_state.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scope-pipeline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "output"), stateFile = path.join(root, "state.json");
  state(["init", "--state", stateFile]);
  const request = { stage: 0, coverageProfile: {}, target: "ScopeFeature", scanSeeds: false,
    repositoryScope: { repositories: [{ id: "source", root, role: "source", exclusions: ["excluded/**"] }] } };
  const descriptor = { version: 1, scanSeeds: false, repositories: [{ id: "source", root, exclusions: ["excluded/**"] }] };
  return { root, outputRoot, stateFile, request, descriptor, target: path.join(outputRoot, "stage-0"),
    journal: path.join(outputRoot, ".transactions", "stage-0.json") };
}
function write(f, directory, status, descriptor) {
  return writeStageArtifact({ outputDir: directory, input: f.request, facts: {
    stage: 0, status, repositoryScope: f.request.repositoryScope,
    summary: { coverageProfile: { requiredCollections: [], notApplicable: {}, requiredCriticalPaths: [], notApplicableCriticalPaths: {} }, ...(descriptor ? { executionScope: descriptor } : {}) }
  } });
}
function pending(f, phase, descriptor) {
  const id = randomUUID();
  const directory = phase === "prepared" ? path.join(f.outputRoot, ".attempts", "stage-0", id, "prepared") : f.target;
  if (phase === "prepared") write(f, f.target, "partial");
  const candidate = write(f, directory, "closed", descriptor);
  fs.mkdirSync(path.dirname(f.journal), { recursive: true });
  fs.writeFileSync(f.journal, JSON.stringify({ version: 1, id, stage: 0, inputDigest: digest(f.request),
    stateFile: f.stateFile, phase, candidateDigest: candidate.canonical.outputDigest }));
  return candidate;
}
function snapshot(f) {
  const files = [f.stateFile, f.journal, ...fs.readdirSync(path.join(f.target, "canonical")).map(name => path.join(f.target, "canonical", name))];
  return files.map(file => [file, fs.readFileSync(file)]);
}
function unchanged(before) { for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes, file); }

test("scope preflight rejects conflict before runner and before transaction resume", t => {
  const f = fixture(t); let calls = 0;
  f.request.repos = [{ id: "source", path: path.join(f.root, "different") }];
  const runner = () => { calls++; return { stage: 0, status: "candidate" }; };
  assert.throws(() => runStagePipeline({ ...f, runner }), /scope|repos/i);
  assert.equal(calls, 0); assert.equal(fs.existsSync(f.target), false);
  pending(f, "prepared", f.descriptor); // Matching request digest reaches the new scope preflight.
  const before = snapshot(f);
  assert.throws(() => runStagePipeline({ ...f, runner }), /scope|repos/i);
  unchanged(before); assert.equal(calls, 0);
});

test("pipeline preserves raw scope and supplies execution descriptor for injected runner", t => {
  const f = fixture(t);
  const raw = f.request.repositoryScope;
  raw.repositories[0].exclusions.push("excluded/**");
  const result = runStagePipeline({ ...f, runner: () => ({ stage: 0, status: "candidate" }) });
  const canonical = JSON.parse(fs.readFileSync(result.artifact));
  assert.deepEqual(canonical.summary.repositoryScope, raw);
  assert.deepEqual(canonical.summary.executionScope, f.descriptor);
});

test("published real runner preserves per-repository exclusions and transition", t => {
  const f = fixture(t); f.request.seeds = { direct: ["ScopeFeature"] };
  f.request.repositoryScope.repositories.push({ id: "other", root: f.root, role: "consumer", exclusions: [] });
  const result = runStagePipeline({ ...f });
  const canonical = JSON.parse(fs.readFileSync(result.artifact));
  assert.deepEqual(canonical.summary.repositoryScope, f.request.repositoryScope);
  assert.deepEqual(canonical.summary.executionScope.repositories.map(repo => repo.exclusions), [["excluded/**"], []]);
  assert.match(canonical.summary.transition.fields["skipped/forbidden"], /source.*excluded\/\*\*/);
});

for (const phase of ["prepared", "published"]) {
  for (const kind of ["missing", "mode", "root", "exclusions"]) {
    test(`scope rejection preserves ${phase} transaction with ${kind} descriptor`, t => {
      const f = fixture(t);
      const descriptor = kind === "missing" ? undefined : structuredClone(f.descriptor);
      if (kind === "mode") descriptor.scanSeeds = true;
      if (kind === "root") descriptor.repositories[0].root = path.join(f.root, "different");
      if (kind === "exclusions") descriptor.repositories[0].exclusions = [];
      const candidate = pending(f, phase, descriptor), candidateBytes = fs.readFileSync(candidate.resultFile);
      const before = snapshot(f); let calls = 0;
      assert.throws(() => runStagePipeline({ ...f, runner: () => { calls++; throw new Error("unexpected runner"); } }), /execution.scope|descriptor/i);
      unchanged(before); assert.deepEqual(fs.readFileSync(candidate.resultFile), candidateBytes); assert.equal(calls, 0);
    });
  }
  test(`valid ${phase} descriptor resumes without runner`, t => {
    const f = fixture(t); pending(f, phase, f.descriptor); let calls = 0;
    const result = runStagePipeline({ ...f, runner: () => { calls++; throw new Error("unexpected runner"); } });
    assert.equal(result.status, "closed"); assert.equal(calls, 0);
    assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).currentStage, 1);
  });
}

test("fresh candidate validation precedes journal creation and archive", t => {
  const f = fixture(t); write(f, f.target, "partial");
  const prior = fs.readFileSync(path.join(f.target, "canonical", "stage-result.json"));
  let advances = 0;
  assert.throws(() => runStageUnitOfWork({ ...f, stage: 0,
    prepare: directory => write(f, directory, "closed"),
    validateCandidate: () => { throw new Error("descriptor rejected"); },
    advance: () => { advances++; }
  }), /descriptor rejected/);
  assert.deepEqual(fs.readFileSync(path.join(f.target, "canonical", "stage-result.json")), prior);
  assert.equal(fs.existsSync(f.journal), false); assert.equal(advances, 0);
});

test("real pipeline CLI resumes descriptor-bound publication without executing runner", t => {
  const f = fixture(t);
  f.request.seeds = { direct: ["ScopeFeature"] };
  f.request.scanSeeds = true; f.descriptor.scanSeeds = true;
  pending(f, "published", f.descriptor);
  const requestFile = path.join(f.root, "request.json"), preload = path.join(f.root, "forbid-scan.cjs");
  fs.writeFileSync(requestFile, JSON.stringify(f.request));
  fs.writeFileSync(preload, "require('node:child_process').spawnSync = () => { throw new Error('unexpected scan'); };\n");
  const cli = path.resolve(__dirname, "../../../cli/src/commands/stage_pipeline.js");
  const result = spawnSync(process.execPath, ["--require", preload, cli, "--request", requestFile, "--state", f.stateFile, "--output-root", f.outputRoot], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "closed");
  assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).currentStage, 1);
});
