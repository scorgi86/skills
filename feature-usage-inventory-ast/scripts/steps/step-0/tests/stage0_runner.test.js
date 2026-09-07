"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { render, runStage0, scanRepo } = require("../src/runner");

function request(directory, scanSeeds) {
  return {
    stage: 0,
    target: "fixture feature",
    scope: "fixture source/tests",
    scanSeeds,
    repos: [{ id: "fixture", path: directory }],
    repositoryScope: { repositories: [{ id: "fixture", root: directory, role: "source", exclusions: ["node_modules"] }] },
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

test("scope validation rejects conflicts before scanning, including strict mode", () => {
  const base = request(os.tmpdir(), false);
  const variants = [
    { repositoryScope: undefined }, { repositoryScope: { repositories: [] } },
    ...["id", "root", "role"].flatMap((field) => [0, {}, " "].map((value) => ({ repositoryScope: { repositories: [{ ...base.repositoryScope.repositories[0], [field]: value }] } }))),
    ...["glob", [""], [3], [" "]].map((exclusions) => ({ repositoryScope: { repositories: [{ ...base.repositoryScope.repositories[0], exclusions }] } })),
    { repositoryScope: { repositories: [base.repositoryScope.repositories[0], base.repositoryScope.repositories[0]] } },
    { repos: [] }, { repos: [{ id: "other", path: os.tmpdir() }] },
    { repos: [{ id: "fixture", path: path.join(os.tmpdir(), "other") }] },
    { repos: [base.repos[0], base.repos[0]] }, { exclusions: ["foreign/**"] }, { exclusions: "node_modules" },
  ];
  for (const change of variants) for (const scanSeeds of [true, false]) {
    let calls = 0;
    assert.throws(() => runStage0({ ...base, ...change, scanSeeds }, { spawnSync: () => { calls++; throw new Error("unexpected scan"); } }));
    assert.equal(calls, 0);
  }
});

test("execution resolver preserves normalized DTO, compatibility and missing-root opt-out", () => {
  const { resolveExecutionScope } = require("../src/execution_scope");
  const base = request(os.tmpdir(), false);
  base.repositoryScope.repositories[0].exclusions.push("node_modules");
  base.exclusions.push("node_modules");
  const resolved = resolveExecutionScope(base);
  assert.deepEqual(resolved.exclusions, ["node_modules"]);
  assert.equal(resolved.repositories[0].role, "source");
  assert.deepEqual(resolved.repos, [{ id: "fixture", path: path.resolve(os.tmpdir()), exclusions: ["node_modules"] }]);
  assert.equal(resolved.descriptor.version, 1);
  assert.equal(resolved.descriptor.scanSeeds, false);
  const missing = request(path.join(os.tmpdir(), `stage0-missing-${process.pid}`), false);
  assert.throws(() => resolveExecutionScope(missing), /directory/);
  assert.equal(resolveExecutionScope({ ...missing, requireExistingRoots: false }).repos.length, 1);
  const { seeds, ...scopeOnly } = base;
  assert.equal(resolveExecutionScope(scopeOnly).repos.length, 1);
  assert.throws(() => runStage0(scopeOnly), /seeds.direct/);
  assert.equal(runStage0(base, { spawnSync: () => assert.fail("strict mode scanned") }).summary.executionScope.scanSeeds, false);
  const second = { ...base.repositoryScope.repositories[0], id: "second" };
  const two = { ...base, repositoryScope: { repositories: [...base.repositoryScope.repositories, second] }, repos: [{ id: "second", path: path.join(os.tmpdir(), ".") }, base.repos[0]] };
  assert.deepEqual(resolveExecutionScope(two).repos.map((repo) => repo.id), ["fixture", "second"]);
  second.exclusions = [];
  assert.throws(() => resolveExecutionScope(two), /every repository/);
});

test("scanRepo preserves candidate, empty, tool error and partial status contracts", () => {
  const repo = { id: "fixture", path: os.tmpdir() };
  for (const [result, status, reason] of [
    [{ status: 1, stdout: "" }, "candidate-empty", undefined],
    [{ error: new Error("missing rg") }, "tool-unavailable", "missing rg"],
    [{ status: 2, stderr: " rg failure \n" }, "partial", "rg failure"],
  ]) {
    const scan = scanRepo(repo, ["CFixture"], [], { spawnSync: () => result });
    assert.deepEqual(scan, { ...repo, status, ...(reason ? { reason } : {}), files: [], totalFiles: 0 });
  }
  const scan = scanRepo(repo, ["CFixture"], [], { spawnSync: () => ({ status: 0, stdout: "z.js\na.js\n" }) });
  assert.equal(scan.status, "candidate");
  assert.deepEqual(scan.files, [path.resolve(repo.path, "a.js"), path.resolve(repo.path, "z.js")]);
});

test("real rg applies root-relative exclusions independently with absolute sorted results", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-rg-"));
  const repositories = ["first", "second"].map((id) => {
    const root = path.join(directory, id);
    for (const sub of ["excluded", "kept"]) {
      fs.mkdirSync(path.join(root, sub), { recursive: true });
      fs.writeFileSync(path.join(root, sub, "hit.js"), "-CFixture");
    }
    return { id, root, role: "source", exclusions: id === "first" ? ["excluded/**"] : [] };
  });
  const facts = runStage0({ stage: 0, target: "fixture", repositoryScope: { repositories }, seeds: { direct: ["-CFixture"] } });
  assert.deepEqual(facts.scans.map((scan) => scan.files), [
    [path.join(repositories[0].root, "kept", "hit.js")],
    [path.join(repositories[1].root, "excluded", "hit.js"), path.join(repositories[1].root, "kept", "hit.js")].sort(),
  ]);
});

test("direct CLI resolves relative roots from foreign cwd and provides migration JSON", () => {
  const { spawnSync } = require("node:child_process");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-cli-"));
  fs.mkdirSync(path.join(directory, "repo"));
  fs.writeFileSync(path.join(directory, "repo", "hit.js"), "CFixture");
  const input = path.join(directory, "request.json");
  const cli = path.resolve(__dirname, "../../../cli/src/commands/stage0_runner.js");
  const base = { stage: 0, target: "fixture", repositoryScope: { repositories: [{ id: "fixture", root: "repo", role: "source", exclusions: [] }] }, seeds: { direct: ["CFixture"] } };
  fs.writeFileSync(input, JSON.stringify(base));
  let result = spawnSync(process.execPath, [cli, "--request", input, "--stdout", "full"], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const facts = JSON.parse(result.stdout);
  assert.deepEqual(facts.scans[0].files, [path.join(directory, "repo", "hit.js")]);
  assert.equal(facts.repositoryScope.repositories[0].root, "repo");
  base.repositoryScope.repositories[0].root = path.join(directory, "repo");
  fs.writeFileSync(input, JSON.stringify(base));
  result = spawnSync(process.execPath, [cli, "--request", input, "--stdout", "full"], { cwd: os.tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).scans[0].files, facts.scans[0].files);
  fs.writeFileSync(input, JSON.stringify({ ...base, repositoryScope: undefined, repos: [{ id: "fixture", path: "repo" }] }));
  result = spawnSync(process.execPath, [cli, "--request", input], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).errors[0].message, /repositoryScope.*"repositories".*"root".*"role"/);
});

test("scanning Stage 0 keeps file matches as candidates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-runtime-"));
  const facts = runStage0(request(directory, true), {
    spawnSync: () => ({ status: 0, stdout: `${path.join(directory, "fixture.js")}\n`, stderr: "" }),
  });
  assert.equal(facts.scans[0].status, "candidate");
  assert.equal(facts.scans[0].totalFiles, 1);
});

test("Stage 0 executes repositoryScope roots and local exclusions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-scope-"));
  const roots = ["first", "second"].map((id) => {
    const root = path.join(directory, id); fs.mkdirSync(root);
    return { id, root, role: "source", exclusions: id === "first" ? ["excluded/**"] : [] };
  });
  const calls = [];
  const scope = { repositories: roots };
  const facts = runStage0({ stage: 0, target: "fixture", repositoryScope: scope, seeds: { direct: ["CFixture"] } }, {
    spawnSync: (command, args, options) => { calls.push({ command, args, options }); return { status: 1, stdout: "" }; },
  });
  assert.equal(facts.repositoryScope, scope);
  assert.deepEqual(calls.map((call) => call.options.cwd), roots.map((repo) => repo.root));
  assert.ok(calls[0].args.includes("!excluded/**"));
  assert.ok(!calls[1].args.includes("!excluded/**"));
  assert.deepEqual(facts.exclusions, []);
  assert.deepEqual(facts.summary.executionScope.repositories, roots.map(({ id, root, exclusions }) => ({ id, root, exclusions })));
  assert.match(render(facts), /first[^\n]*excluded\/\*\*/);
  assert.match(facts.transition.fields["skipped/forbidden"], /first[^\n]*excluded\/\*\*/);
});
