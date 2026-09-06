"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const scripts = path.resolve(__dirname, "../..");
const root = path.dirname(scripts);
test("module entries expose their implementation API and scripts root has a single entry file", () => {
  assert.deepEqual(fs.readdirSync(scripts, { withFileTypes: true }).filter((entry) => !entry.isDirectory()).map((entry) => entry.name), ["index.js"]);
  assert.equal(require(scripts), require(path.join(scripts, "cli")));
  assert.equal(fs.existsSync(path.join(scripts, "ast")), false);
  for (let stage = 0; stage <= 8; stage += 1) {
    assert.ok(Object.keys(require(path.join(scripts, `steps/step-${stage}`))).length > 0);
  }
  assert.equal(require(path.join(scripts, "state")).main, require(path.join(scripts, "state/src/stage_state.js")).main);
  assert.equal(require(path.join(scripts, "flows/full-flow")), require(path.join(scripts, "flows/full-flow/src/stage_pipeline.js")));
});

test("public entry imports remain silent and pipeline does not eagerly load runners", () => {
  const entries = [".", "state", "flows/full-flow", "shared/ast", "shared/dto", "shared/evidence", "shared/ownership", "shared/artifacts", "shared/report", "shared/output", "shared/diagnostics", "cli", ...Array.from({ length: 9 }, (_, stage) => `steps/step-${stage}`)];
  for (const entry of entries) {
    const result = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(scripts, entry))});`], { encoding: "utf8" });
    assert.equal(result.status, 0, `${entry}: ${result.stderr}`);
    assert.equal(result.stdout, "", entry);
    assert.equal(result.stderr, "", entry);
  }
  const result = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(scripts, "flows/full-flow"))}); if(Object.keys(require.cache).some(p=>/[\\\\/]steps[\\\\/]step-/.test(p))) process.exit(1);`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("explicit command entries and router agree across working directories", () => {
  const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), "inventory CLI space "));
  const cases = [
    ["prototype_ast", ["--help"], 0], ["stage_pipeline", [], 2], ["stage_state", [], 2],
    ["stage8_runner", [], 2], ["canonical_stage_cli", [], 2], ["query_stage_artifacts", [], 2],
    ["quick_validate", [root], 0], ["validate_skill", [root], 0],
    ["inventory_search", ["--help"], 0], ["feature_search_matrix", ["--help"], 0],
  ];
  for (const cwd of [root, otherCwd]) for (const [name, args, status] of cases) {
    const command = spawnSync(process.execPath, [path.join(scripts, "cli", "src", "commands", `${name}.js`), ...args], { cwd, encoding: "utf8" });
    const routed = spawnSync(process.execPath, [path.join(scripts, "cli", "index.js"), name, ...args], { cwd, encoding: "utf8" });
    const topLevel = spawnSync(process.execPath, [path.join(scripts, "index.js"), name, ...args], { cwd, encoding: "utf8" });
    assert.equal(command.status, status, `${name}: ${command.stderr}`);
    assert.equal(routed.status, status, `${name}: ${routed.stderr}`);
    assert.equal(command.stdout, routed.stdout, name);
    assert.equal(command.stderr, routed.stderr, name);
    assert.equal(topLevel.status, status, `${name}: ${topLevel.stderr}`);
    assert.equal(topLevel.stdout, command.stdout, name);
    assert.equal(topLevel.stderr, command.stderr, name);
    assert.doesNotMatch(command.stderr, /MODULE_NOT_FOUND|Cannot find module/, name);
    if (args.includes("--help")) assert.ok(command.stdout.includes(`scripts/cli/src/commands/${name}.js`), `${name}: help must name the supported command path`);
  }
});

test("state CLI initializes a file and router reads it from a different working directory", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "state entry space "));
  const file = path.join(cwd, "state.json");
  const initialized = spawnSync(process.execPath, [path.join(scripts, "index.js"), "stage_state", "init", "--state", file], { cwd, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).currentStage, 0);
  const status = spawnSync(process.execPath, [path.join(scripts, "cli/index.js"), "stage_state", "status", "--state", file], { cwd: root, encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.deepEqual(JSON.parse(status.stdout), require(path.join(scripts, "state")).main(["status", "--state", file]));
});

test("root entry reports missing and unknown commands through the existing dispatcher", () => {
  for (const args of [[], ["unknown-command"]]) {
    const result = spawnSync(process.execPath, [path.join(scripts, "index.js"), ...args], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Provide an existing command:/);
    assert.match(result.stderr, /stage_pipeline/);
  }
});

test("pipeline keeps validation, runner, artifact validation and state advancement in order", () => {
  const pipeline = require(path.join(scripts, "flows/full-flow"));
  const state = require(path.join(scripts, "state"));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-order-"));
  const stateFile = path.join(directory, "state.json"), outputRoot = path.join(directory, "artifacts");
  state.main(["init", "--state", stateFile]);
  const events = [], original = state.main;
  state.main = function (args) {
    events.push(args[0]);
    if (args[0] === "advance") {
      assert.equal(require(path.join(scripts, "shared/artifacts/src/stage_artifact_v4")).validateStageArtifact(path.join(outputRoot, "stage-0")).ok, true);
    }
    return original(args);
  };
  try {
    const result = pipeline.runStagePipeline({ request: { stage: 0, target: "X", repositoryScope: { repositories: [{ id: "source", root: directory, role: "source" }] } }, stateFile, outputRoot, runner() { events.push("runner"); return { stage: 0, status: "candidate", canonicalFacts: [] }; } });
    assert.equal(result.status, "closed");
    assert.deepEqual(events, ["assert", "runner", "advance"]);
  } finally { state.main = original; }
});
