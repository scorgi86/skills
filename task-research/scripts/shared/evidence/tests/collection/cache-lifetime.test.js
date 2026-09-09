"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const test = require("node:test");
const { runEvidenceChecks } = require("../..").source_evidence;
test("evidence traversal is shared within a request and refreshed between requests", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "evidence request cache "));
  const file = path.join(directory, "source.js");
  fs.writeFileSync(file, "const First = 1;\n");
  let calls = 0;
  const dependencies = { listFiles() { calls++; return [file]; } };
  const request = { checks: [{ id: "a", scope: directory, pattern: "First" }, { id: "b", scope: directory, pattern: "First" }] };
  try {
    const first = runEvidenceChecks(request, dependencies);
    assert.equal(calls, 1);
    assert.deepEqual(first.checks.map(row => row.totalMatches), [1, 1]);
    fs.writeFileSync(file, "const Second = 2;\n");
    const second = runEvidenceChecks(request, dependencies);
    assert.equal(calls, 2);
    assert.deepEqual(second.checks.map(row => row.totalMatches), [0, 0]);
  } finally { fs.unlinkSync(file); fs.rmdirSync(directory); }
});
