"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const entry = path.resolve(__dirname, "../../../index.js");
test("Stage7 ordinary request reaches request validation and creates no output on failure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ordinary-request-"));
  try {
    const request = path.join(dir, "request.json"), output = path.join(dir, "stage-7", "facts.json");
    fs.writeFileSync(request, JSON.stringify({ target: "test" }));
    const run = spawnSync(process.execPath, [entry, "stage7_runner", "--request", request, "--output", output], { encoding: "utf8" });
    assert.equal(run.status, 2);
    assert.doesNotMatch(run.stdout, /canonical schema|schemaVersion.*4\.0\.0|canonical Stage Artifact/i);
    assert.equal(fs.existsSync(path.dirname(output)), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("Stage7 reports missing option values before reading files", () => {
  const run = spawnSync(process.execPath, [entry, "stage7_runner", "--request", "--output", "ignored.json"], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stdout, /Missing value for --request/);
});
