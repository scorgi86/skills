"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runStagePipeline } = require("../../flows/full-flow/src/stage_pipeline.js");
const { main: state } = require("../../state/src/stage_state.js");
const { writeCanonicalTransition } = require("../../shared/dto/tests/test_helpers.js");
const { withRuntimeAstCache } = require("../../flows/full-flow/src/stage_pipeline.js");
const { runStage1 } = require("../../steps/step-1/src/runner.js");
const { runStage2 } = require("../../steps/step-2/src/runner.js");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "state.json");
  state(["init", "--state", stateFile]);
  return { root, stateFile, request: { stage: 0, coverageProfile: {}, target: "Feature", repositoryScope: { repositories: [{ id: "source", root, role: "source" }] } } };
}

test("a partial stage can be retried and a closed stage remains immutable", async t => {
  const fixture = setup(t);
  const options = { ...fixture, outputRoot: fixture.root };
  assert.equal((await runStagePipeline({ ...options, runner: () => ({ stage: 0, status: "partial" }) })).status, "partial");
  const result = await runStagePipeline({ ...options, runner: () => ({ stage: 0, status: "candidate" }) });
  assert.equal(result.status, "closed");
  assert.equal(state(["status", "--state", fixture.stateFile]).currentStage, 1);
  const before = fs.readFileSync(result.artifact, "utf8");
  await assert.rejects(runStagePipeline({ ...options, runner: () => { throw new Error("must not run"); } }), /already|closed|current stage/i);
  assert.equal(fs.readFileSync(result.artifact, "utf8"), before);
});

test("a partial stage publishes while the state lock is held elsewhere", async t => {
  const fixture = setup(t);
  fs.writeFileSync(`${fixture.stateFile}.lock`, "state-command");
  const result = await runStagePipeline({ ...fixture, outputRoot: fixture.root, runner: () => ({ stage: 0, status: "partial" }) });
  assert.equal(result.status, "partial");
  assert.equal(result.stateChanged, false);
  assert.equal(state(["status", "--state", fixture.stateFile]).currentStage, 0);
  assert.equal(fs.readFileSync(`${fixture.stateFile}.lock`, "utf8"), "state-command");
});

test("BDD: Stage 1 AST is reused by Stage 2 and stale or corrupt entries never become hits", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-ast-cache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "feature.js");
  fs.writeFileSync(source, "class Alpha {}\n");
  const repositoryScope = { repositories: [{ id: "source", root, role: "source" }] };
  const transitionArtifact = writeCanonicalTransition(root, 0, { facts: { repositoryScope } });
  const ast = { queries: [{ id: "symbols", command: "symbols", file: source, includeDetails: true }] };
  const base = { repositoryScope, transitionArtifact, ast, evidence: { checks: [] } };
  const outputRoot = path.join(root, "artifacts");
  const stage1Request = withRuntimeAstCache({ ...base, stage: 1 }, outputRoot);
  const stage2Request = withRuntimeAstCache({ ...base, stage: 2 }, outputRoot);
  const child = (stage, request) => spawnSync(process.execPath, ["-e", `
    const stage = Number(process.env.STAGE);
    const runner = require(process.env.RUNNER)[\`runStage\${stage}\`];
    const dependencies = stage === 1 ? { runGitNexusContext: () => ({ status: "candidate", requests: [] }) } : {};
    void runner(JSON.parse(process.env.REQUEST), dependencies).then(result => process.stdout.write(JSON.stringify(result.ast)));
  `], { encoding: "utf8", env: { ...process.env, STAGE: String(stage), RUNNER: path.join(__dirname, `../../steps/step-${stage}/src/runner.js`), REQUEST: JSON.stringify(request) } });
  const coldChild = child(1, stage1Request);
  assert.equal(coldChild.status, 0, coldChild.stderr);
  assert.equal(JSON.parse(coldChild.stdout).stats.cacheMisses, 1);
  const warmChild = child(2, stage2Request);
  assert.equal(warmChild.status, 0, warmChild.stderr);
  const warmAst = JSON.parse(warmChild.stdout);
  assert.equal(warmAst.stats.cacheHits, 1);
  const uncached = await runStage2({ ...base, stage: 2 });
  const semantic = value => JSON.parse(JSON.stringify(value, (key, item) => ["elapsedMs", "cacheHits", "cacheMisses", "bytes", "budgetRequired"].includes(key) ? undefined : item));
  assert.deepEqual(semantic(warmAst), semantic(uncached.ast));

  const original = fs.statSync(source);
  fs.writeFileSync(source, "class Bravo {}\n");
  fs.utimesSync(source, original.atime, original.mtime);
  const changed = await runStage2(stage2Request);
  assert.equal(changed.ast.stats.cacheHits, 0);
  assert.equal(changed.ast.stats.cacheMisses, 1);
  assert.match(JSON.stringify(changed.ast), /Bravo/);

  for (const file of fs.readdirSync(stage2Request.ast.cache).filter(name => name.endsWith(".json"))) fs.writeFileSync(path.join(stage2Request.ast.cache, file), "broken");
  const recovered = await runStage2(stage2Request);
  assert.equal(recovered.ast.stats.cacheHits, 0);
  assert.deepEqual(semantic(recovered.ast), semantic((await runStage2({ ...base, stage: 2 })).ast));
});
