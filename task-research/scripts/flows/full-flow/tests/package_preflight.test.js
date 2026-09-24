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
test("P1 accepts lines that differ only by indentation", () => {
  const { file } = writeTemp("p1-indent-", "function f() {\n    var x = 1;\n        var x = 1;\n}");
  const pkg = pkgFor({ checks: [confirmedCheck("anchor", file, "var x = 1;")], nameCoverage: { id: "cov", scope: "x", terms: ["x"] } });
  const result = validateResearchPackage(pkg);
  assert.equal(result.ok, true, result.errors.join("; "));
});
test("P1 still rejects byte-identical duplicates without indentation", () => {
  const { file } = writeTemp("p1-flat-", "var x = 1;\nvar x = 1;");
  const pkg = pkgFor({ checks: [confirmedCheck("anchor", file, "var x = 1;")], nameCoverage: { id: "cov", scope: "x", terms: ["x"] } });
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
test("W1 warns on limit selectors and W2 warns on skip without stage-1 ids, without blocking", () => {
  const pkg = pkgFor({ checks: [{ id: "anchor", file: "x", pattern: "x" }], nameCoverage: { id: "cov", scope: "x", terms: ["x"] } }, { ownership: { ownerDiscovery: "skip" } });
  pkg.stages["7"].evidenceSelectors = [{ stage: 5, limit: 200 }];
  pkg.stages["7"].capabilities = [{ id: "definition", status: "confirmed", evidenceRefs: [] }];
  const result = validateResearchPackage(pkg);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => /truncate/.test(w)), result.warnings.join("; "));
  assert.ok(result.warnings.some(w => /bootstrap proof/.test(w)), result.warnings.join("; "));
});
test("F8: seed match volume produces warning and error by thresholds", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p1-seed-"));
  const file = path.join(root, "code.js");
  fs.writeFileSync(file, Array.from({ length: 3 }, () => "CommonTerm();").join("\n") + "\nRareTerm();");
  const pkg = pkgFor({}, {}, {});
  pkg.stages["0"].seeds = { direct: ["CommonTerm", "RareTerm"] };
  pkg.repositoryScope = { repositories: [{ id: "repo", root, role: "source" }] };
  const options = { seedScan: { warnMatches: 2, failMatches: 4 } };
  const result = validateResearchPackage(pkg, options);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.ok(result.warnings.some(w => /CommonTerm/.test(w) && /3 matches|warning/.test(w)), result.warnings.join("; "));
  const strict = validateResearchPackage(pkg, { seedScan: { warnMatches: 2, failMatches: 3 } });
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.some(e => /CommonTerm/.test(e) && /narrow the seed/.test(e)), strict.errors.join("; "));
});
