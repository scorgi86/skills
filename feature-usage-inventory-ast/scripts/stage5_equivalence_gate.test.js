"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { compareStage5Facts } = require("./stage5_equivalence_gate");
test("stage 5 equivalence gate accepts equal anchors and rejects a changed one", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage5-gate-")); const source = path.join(root, "model.js"); fs.writeFileSync(source, "shadow\n");
  const make = (snippet = "shadow") => ({ sourceEvidence: { checks: [{ id: "path", totalMatches: 1, fullMatches: [{ file: source, line: 1, snippet }] }, { id: "direct-renderer-name-coverage", totalMatches: 1, fullMatches: [{ file: source, line: 1, snippet }] }] }, nameCoverage: { filesScanned: 4, matchingFileCount: 1 } });
  assert.equal(compareStage5Facts(make(), make()).status, "equivalent");
  assert.equal(compareStage5Facts(make(), make("changed")).status, "not-equivalent");
});
