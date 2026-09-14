"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), test = require("node:test");
const { parseArgs, runRepeat } = require("../repeat_run.js");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repeat-run-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.js"); fs.writeFileSync(source, "const feature = 1;\n");
  const pkg = { schemaVersion: "research-package/1.0.0", target: "Feature", repositoryScope: { repositories: [{ id: "source", root, role: "source" }] }, stages: Object.fromEntries(Array.from({ length: 8 }, (_, n) => [n, {}])) };
  pkg.stages[0] = { coverageProfile: { kind: "bounded", requiredCapabilities: ["definition"] }, seeds: { direct: ["feature"] } };
  const file = path.join(root, "package.json"); fs.writeFileSync(file, JSON.stringify(pkg));
  return { root, source, pkg, packageFile: file, outputRoot: path.join(root, "out"), prepareOnly: true };
}
const dependencies = { repositoryState: scope => scope.repositories.map(row => ({ id: row.id, head: "fixture", status: "" })), diagnose: () => ({ status: "ok", summary: { requiredFailed: [] } }) };
test("invalid CLI exits 2 without an output write", () => {
  const result = require("node:child_process").spawnSync(process.execPath, [path.join(__dirname, "../repeat_run.js"), "--unknown"], { encoding: "utf8" });
  assert.equal(result.status, 2); assert.match(result.stderr, /Unknown/);
});
test("repeat CLI requires package/output and rejects unknown options", () => {
  assert.deepEqual(parseArgs(["--package", "p", "--output-root", "o", "--prepare-only"]), { packageFile: "p", outputRoot: "o", prepareOnly: true });
  assert.throws(() => parseArgs(["--package", "p"]), /output/);
  assert.throws(() => parseArgs(["--package", "p", "--output-root", "o", "--unknown"]), /Unknown/);
});
test("prepare preserves package bytes, writes metrics and never runs stages", async t => {
  const value = fixture(t), before = fs.readFileSync(value.packageFile);
  const result = await runRepeat(value, { ...dependencies, runFullResearch: () => { throw Error("Unexpected stages"); } });
  assert.equal(result.status, "prepared");
  assert.deepEqual(fs.readFileSync(path.join(value.outputRoot, "research-package.json")), before);
  assert.deepEqual(fs.readFileSync(value.packageFile), before);
  assert.equal(fs.existsSync(path.join(value.outputRoot, "inventory-state.json")), false);
  assert.ok(result.preparationMs >= 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(value.outputRoot, "summary.json"))).usage.status, "unavailable");
});
test("existing output refusal leaves its bytes unchanged", async t => {
  const value = fixture(t); fs.mkdirSync(value.outputRoot); const marker = path.join(value.outputRoot, "marker"); fs.writeFileSync(marker, "user");
  await assert.rejects(runRepeat(value, dependencies), /already exists/);
  assert.deepEqual(fs.readdirSync(value.outputRoot), ["marker"]); assert.equal(fs.readFileSync(marker, "utf8"), "user");
});
test("stale proof fails before execution and logs failure without altering input", async t => {
  const value = fixture(t); value.pkg.stages[2].confirmation = { file: value.source, sourceHash: "0".repeat(64), line: 1, endLine: 1, sourceFragment: "const feature = 1;" };
  fs.writeFileSync(value.packageFile, JSON.stringify(value.pkg)); const before = fs.readFileSync(value.packageFile);
  await assert.rejects(runRepeat(value, dependencies), /Stale|anchor/i);
  assert.deepEqual(fs.readFileSync(value.packageFile), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(value.outputRoot, "summary.json"))).status, "error");
});
test("required dependency refusal blocks execution", async t => {
  const value = fixture(t);
  await assert.rejects(runRepeat(value, { ...dependencies, diagnose: () => ({ summary: { requiredFailed: ["swc"] } }) }), /Required dependencies/);
});
for (const invalid of ["fragment", "scope"]) test(`anchor ${invalid} refusal does not promote a candidate`, async t => {
  const value = fixture(t), outside = invalid === "scope" ? fixture(t).source : value.source;
  const sourceHash = require("node:crypto").createHash("sha256").update(fs.readFileSync(outside)).digest("hex");
  value.pkg.stages[2].confirmation = { status: "candidate", file: outside, sourceHash, line: 1, endLine: 1, sourceFragment: invalid === "fragment" ? "wrong" : "const feature = 1;" };
  fs.writeFileSync(value.packageFile, JSON.stringify(value.pkg));
  await assert.rejects(runRepeat(value, dependencies), /anchor/i);
  assert.equal(JSON.parse(fs.readFileSync(value.packageFile)).stages[2].confirmation.status, "candidate");
});
test("full mode delegates unchanged package, preserves partial and records stage errors", async t => {
  const value = fixture(t); value.prepareOnly = false;
  const result = await runRepeat(value, { ...dependencies, runFullResearch: async options => {
    assert.deepEqual(fs.readFileSync(options.packageFile), fs.readFileSync(value.packageFile));
    return { status: "partial", stage: 4 };
  } });
  assert.equal(result.status, "partial");
  const failed = { ...value, outputRoot: path.join(value.root, "failed") };
  await assert.rejects(runRepeat(failed, { ...dependencies, runFullResearch: () => { throw Error("stage refusal"); } }), /stage refusal/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(failed.outputRoot, "summary.json"))).status, "error");
});
