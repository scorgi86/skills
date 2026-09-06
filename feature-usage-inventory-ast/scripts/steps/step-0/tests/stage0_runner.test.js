"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { render, runStage0 } = require("../src/runner");

function request(directory, scanSeeds) {
  return {
    stage: 0,
    target: "fixture feature",
    scope: "fixture source/tests",
    scanSeeds,
    repos: [{ id: "fixture", path: directory }],
    repositoryState: [{ id: "fixture", state: "HEAD fixture; working tree clean" }],
    tooling: [{ id: "rg", status: "available" }],
    seeds: { direct: ["CFixture"], aliases: ["fixture property"] },
    expectedLayers: ["model", "owner", "tests"],
    exclusions: ["node_modules"],
    limitations: ["source edits -> user-forbidden"],
  };
}

test("strict Stage 0 records a plan without usage discovery", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-runtime-"));
  const facts = runStage0(request(directory, false));
  assert.equal(facts.scanSeeds, false);
  assert.deepEqual(facts.scans.map((item) => item.status), ["not-run"]);
  const report = render(facts);
  assert.match(report, /usage discovery не выполнялся/);
  assert.match(report, /No usage candidates collected/);
  assert.match(report, /search plan; file-level usage discovery is deferred to Stage 1/);
  assert.match(report, /diagnostics, repository\/tool state and search plan/);
  assert.match(report, /usage discovery, AST\/ownership\/serializer analysis -> intentionally deferred to stage 1/);
});

test("scanning Stage 0 keeps file matches as candidates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-runtime-"));
  const facts = runStage0(request(directory, true), {
    spawnSync: () => ({ status: 0, stdout: `${path.join(directory, "fixture.js")}\n`, stderr: "" }),
  });
  assert.equal(facts.scans[0].status, "candidate");
  assert.equal(facts.scans[0].totalFiles, 1);
});
