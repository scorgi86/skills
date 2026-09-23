"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSource } = require("../../src/parsing/parser.js");
const { analyzeFile } = require("../../src/analysis/analysis.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("exact occurrences include identifiers, static properties and strings, but not comments or substrings", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ast-occurrences-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "sample.js");
  fs.writeFileSync(file, "// ExactTerm\nconst ExactTerm = obj.ExactTerm; obj['ExactTerm']; const s = 'ExactTerm'; const ExactTermMore = 1;");
  const result = analyzeFile(file).result;
  const exact = result.occurrences.filter(row => row.value === "ExactTerm");
  assert.ok(exact.some(row => row.kind === "identifier"));
  assert.ok(exact.some(row => row.kind === "property"));
  assert.ok(exact.some(row => row.kind === "string"));
  assert.equal(result.occurrences.some(row => row.value === "// ExactTerm"), false);
  assert.equal(exact.every(row => row.file === file && row.sourceHash && row.range && row.confidence === "exact"), true);
  assert.ok(result.occurrences.some(row => row.value === "ExactTermMore"));
});
