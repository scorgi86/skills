"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { validateResearchPackage } = require("../src/package_preflight.js");

function writeTemp(prefix, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "model.js");
  fs.writeFileSync(file, content);
  return { root, file };
}
function hashOf(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function pkgFor(stage5, stage1, stage2, stage7) {
  return {
    schemaVersion: "research-package/1.0.0",
    target: "T",
    repositoryScope: { repositories: [{ id: "repo", root: "x", role: "source" }] },
    stages: { "0": {}, "1": stage1 ?? {}, "2": stage2 ?? {}, "5": stage5 ?? {}, "7": stage7 ?? {} },
  };
}
function confirmedCheck(id, file, fragment) {
  return { id, file, pattern: "x", confirmation: { id, status: "source-confirmed", repository: "repo", file, line: 2, endLine: 2, sourceFragment: fragment, sourceHash: hashOf(file) } };
}

test("P1 rejects a confirmation fragment that matches the file more than once", () => {
  const { file } = writeTemp("p1-dup-", "const a = 1;\nconst duplicated = 1;\nconst duplicated = 1;");
  const pkg = pkgFor({ checks: [confirmedCheck("anchor", file, "const duplicated = 1;")], nameCoverage: { id: "cov", scope: "x", terms: ["x"] } });
  const result = validateResearchPackage(pkg);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /matches 2/.test(e)), result.errors.join("; "));
});
test("P1 accepts a unique fragment and skips unreadable files", () => {
  const { file } = writeTemp("p1-uniq-", "const a = 1;\nconst uniqueAnchor = 1;");
  assert.equal(validateResearchPackage(pkgFor({ checks: [confirmedCheck("anchor", file, "const uniqueAnchor = 1;")], nameCoverage: { id: "cov", scope: "x", terms: ["x"] } })).ok, true);
  const missing = path.join(os.tmpdir(), "no-such-dir-xyz", "file.js");
  const missingCheck = confirmedCheck("anchor", file, "const uniqueAnchor = 1;");
  missingCheck.confirmation.file = missing;
  assert.equal(validateResearchPackage(pkgFor({ checks: [missingCheck], nameCoverage: { id: "cov", scope: "x", terms: ["x"] } })).ok, true);
});
test("P2 rejects authored refs outside the alias union and accepts check ids and selector ids", () => {
  const base7 = refs => ({ evidenceSelectors: [{ ids: ["ev-selector"] }], capabilities: [{ id: "definition", status: "confirmed", evidenceRefs: refs }] });
  assert.equal(validateResearchPackage(pkgFor({}, {}, {}, base7(["apiPut"]))).ok, false);
  const withChecks = pkgFor({}, { evidence: { checks: [{ id: "definition-proof", file: "x", pattern: "x" }] } }, {}, base7(["definition-proof", "ev-selector"]));
  assert.equal(validateResearchPackage(withChecks).ok, true);
});
test("P2 accepts absence-prefixed ids for declared absenceClaim checks", () => {
  const stage5 = { checks: [{ id: "tests", absenceClaim: true, file: "x", pattern: "x", expectedNames: ["x"], performedChecks: ["x"], ordersChecked: ["x"], linkingMethodsChecked: ["x"], repository: "repo", searchScope: "x", reason: "x", consequence: "x" }], nameCoverage: { id: "cov", scope: "x", terms: ["x"] } };
  const pkg = pkgFor(stage5, {}, {});
  pkg.stages["7"] = { capabilities: [{ id: "tests", status: "checked-no-usage", repository: "repo", searchScope: "x", reason: "x", consequence: "x", expectedNames: ["x"], performedChecks: ["x"], ordersChecked: ["x"], linkingMethodsChecked: ["x"], resultComplete: true, resultTruncated: false, evidenceRefs: ["absence-tests"] }] };
  assert.equal(validateResearchPackage(pkg).ok, true);
});
test("P3 rejects manual Stage 1 with automatic Stage 2", () => {
  const pkg = pkgFor({}, { ast: { queries: [] }, ownership: { expectedIds: ["model"], groups: [{ id: "model", order: "1", object: "Thing" }] } }, { searchFromStage1: true });
  const result = validateResearchPackage(pkg);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /manual Stage 1/i.test(e)), result.errors.join("; "));
});
test("P3 rejects ownerDiscovery skip with derived stages and missing manual Stage 5", () => {
  const pkg = pkgFor({}, { ownership: { ownerDiscovery: "skip" } }, { searchFromStage1: true });
  const result = validateResearchPackage(pkg);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /skip/i.test(e)), result.errors.join("; "));
});
