"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { normalizeSearchConcurrency, render, runStage0, scanRepo } = require("../src/runner");

function childFor(result) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit("close", null);
  process.nextTick(() => {
    if (result.error) child.emit("error", result.error);
    else {
      child.stdout.end(result.stdout || "");
      child.stderr.end(result.stderr || "");
      child.emit("close", result.status);
    }
  });
  return child;
}

function request(directory, scanSeeds) {
  return {
    stage: 0,
    coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] },
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

test("strict Stage 0 records a plan without usage discovery", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-runtime-"));
  const facts = await runStage0(request(directory, false));
  assert.equal(facts.scanSeeds, false);
  assert.deepEqual(facts.scans.map((item) => item.status), ["not-run"]);
  const report = render(facts);
  assert.match(report, /usage discovery не выполнялся/);
  assert.match(report, /No usage candidates collected/);
  assert.match(report, /search plan; file-level usage discovery is deferred to Stage 1/);
  assert.match(report, /diagnostics, repository\/tool state and search plan/);
  assert.match(report, /usage discovery, AST\/ownership\/serializer analysis -> intentionally deferred to stage 1/);
});

test("direct Stage 0 requires declared capabilities before scanning", async () => {
  const input = request(os.tmpdir(), false);
  delete input.coverageProfile;
  await assert.rejects(runStage0(input, { spawn: () => assert.fail("invalid request scanned") }), /coverageProfile/);
});

test("direct Stage 0 rejects blank seeds before scanning", async () => {
  const input = request(os.tmpdir(), false);
  input.seeds.direct = ["   "];
  await assert.rejects(runStage0(input, { spawn: () => assert.fail("invalid request scanned") }), /seeds\.direct/);
});

test("scope validation rejects conflicts before scanning, including strict mode", async () => {
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
    await assert.rejects(runStage0({ ...base, ...change, scanSeeds }, { spawn: () => { calls++; throw new Error("unexpected scan"); } }));
    assert.equal(calls, 0);
  }
});

test("execution resolver preserves normalized DTO, compatibility and missing-root opt-out", async () => {
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
  await assert.rejects(runStage0(scopeOnly), /seeds.direct/);
  assert.equal((await runStage0(base, { spawn: () => assert.fail("strict mode scanned") })).summary.executionScope.scanSeeds, false);
  const second = { ...base.repositoryScope.repositories[0], id: "second" };
  const two = { ...base, repositoryScope: { repositories: [...base.repositoryScope.repositories, second] }, repos: [{ id: "second", path: path.join(os.tmpdir(), ".") }, base.repos[0]] };
  assert.deepEqual(resolveExecutionScope(two).repos.map((repo) => repo.id), ["fixture", "second"]);
  second.exclusions = [];
  assert.throws(() => resolveExecutionScope(two), /every repository/);
});

test("scanRepo preserves candidate, empty, tool error and partial status contracts", async () => {
  const repo = { id: "fixture", path: os.tmpdir() };
  for (const [result, status, reason] of [
    [{ status: 1, stdout: "" }, "candidate-empty", undefined],
    [{ error: Object.assign(new Error("missing rg"), { code: "ENOENT" }) }, "tool-unavailable", "missing rg"],
    [{ status: 2, stderr: " rg failure \n" }, "partial", "rg failure"],
  ]) {
    const scan = await scanRepo(repo, ["CFixture"], [], { spawn: () => childFor(result) });
    assert.deepEqual(scan, { ...repo, status, ...(reason ? { reason } : {}), files: [], totalFiles: 0 });
  }
  const scan = await scanRepo(repo, ["CFixture"], [], { spawn: () => childFor({ status: 0, stdout: "z.js\na.js\n" }) });
  assert.equal(scan.status, "candidate");
  assert.deepEqual(scan.files, [path.resolve(repo.path, "a.js"), path.resolve(repo.path, "z.js")]);
});

test("real rg applies root-relative exclusions independently with absolute sorted results", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-rg-"));
  const repositories = ["first", "second"].map((id) => {
    const root = path.join(directory, id);
    for (const sub of ["excluded", "kept"]) {
      fs.mkdirSync(path.join(root, sub), { recursive: true });
      fs.writeFileSync(path.join(root, sub, "hit.js"), "-CFixture");
    }
    return { id, root, role: "source", exclusions: id === "first" ? ["excluded/**"] : [] };
  });
  const facts = await runStage0({ stage: 0, coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, target: "fixture", repositoryScope: { repositories }, seeds: { direct: ["-CFixture"] } });
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
  const base = { stage: 0, coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, target: "fixture", repositoryScope: { repositories: [{ id: "fixture", root: "repo", role: "source", exclusions: [] }] }, seeds: { direct: ["CFixture"] } };
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

test("scanning Stage 0 keeps file matches as candidates", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-runtime-"));
  const facts = await runStage0(request(directory, true), {
    spawn: () => childFor({ status: 0, stdout: `${path.join(directory, "fixture.js")}\n`, stderr: "" }),
  });
  assert.equal(facts.scans[0].status, "candidate");
  assert.equal(facts.scans[0].totalFiles, 1);
});

test("Stage 0 executes repositoryScope roots and local exclusions", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-scope-"));
  const roots = ["first", "second"].map((id) => {
    const root = path.join(directory, id); fs.mkdirSync(root);
    return { id, root, role: "source", exclusions: id === "first" ? ["excluded/**"] : [] };
  });
  const calls = [];
  const scope = { repositories: roots };
  const facts = await runStage0({ stage: 0, coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, target: "fixture", repositoryScope: scope, seeds: { direct: ["CFixture"] } }, {
    spawn: (command, args, options) => { calls.push({ command, args, options }); return childFor({ status: 1, stdout: "" }); },
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

test("search concurrency is validated and capped before scanning", async () => {
  assert.equal(normalizeSearchConcurrency(undefined, 6), 1);
  assert.equal(normalizeSearchConcurrency(4, 2), 2);
  assert.equal(normalizeSearchConcurrency(1, 3), 1);
  for (const value of [0, -1, 1.5, "2"]) assert.throws(() => normalizeSearchConcurrency(value, 3), /positive integer/);
  const data = request(os.tmpdir(), true);
  data.searchConcurrency = 0;
  let calls = 0;
  await assert.rejects(runStage0(data, { spawn: () => { calls += 1; return childFor({ status: 1 }); } }), /positive integer/);
  assert.equal(calls, 0);
});

test("rg timeout is partial and terminates the child", async () => {
  let killed = false;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { killed = true; child.emit("close", null); };
  const result = await scanRepo({ id: "slow", path: os.tmpdir() }, ["x"], [], { spawn: () => child, timeoutMs: 5 });
  assert.equal(killed, true);
  assert.equal(result.status, "partial");
  assert.match(result.reason, /timed out/);
});

test("multi-repository Stage 0 bounds parallel work and preserves scope order", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-parallel-"));
  const repositories = ["slow", "fast", "middle"].map((id) => {
    const root = path.join(directory, id); fs.mkdirSync(root); return { id, root, role: "source", exclusions: [] };
  });
  const delays = { slow: 30, fast: 2, middle: 10 };
  let active = 0;
  let maximum = 0;
  const facts = await runStage0({ stage: 0, coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, target: "fixture", searchConcurrency: 2, repositoryScope: { repositories }, seeds: { direct: ["x"] } }, {
    spawn: (_command, _args, options) => {
      const id = path.basename(options.cwd);
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
      active += 1; maximum = Math.max(maximum, active);
      setTimeout(() => { child.stdout.end(`${id}.js\n`); active -= 1; child.emit("close", 0); }, delays[id]);
      return child;
    }
  });
  assert.equal(maximum, 2);
  assert.deepEqual(facts.scans.map((scan) => scan.id), ["slow", "fast", "middle"]);
  assert.deepEqual(facts.scans.map((scan) => path.basename(scan.files[0])), ["slow.js", "fast.js", "middle.js"]);
});

test("one repository failure stays local while other scans complete", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-local-error-"));
  const repositories = ["good", "bad"].map((id) => { const root = path.join(directory, id); fs.mkdirSync(root); return { id, root, role: "source" }; });
  const facts = await runStage0({ stage: 0, coverageProfile: { kind: "bounded", requiredCapabilities: ["ownership"] }, target: "fixture", repositoryScope: { repositories }, seeds: { direct: ["x"] } }, {
    spawn: (_command, _args, options) => path.basename(options.cwd) === "bad"
      ? childFor({ error: Object.assign(new Error("denied"), { code: "EACCES" }) })
      : childFor({ status: 0, stdout: "hit.js\n" })
  });
  assert.deepEqual(facts.scans.map(({ id, status }) => ({ id, status })), [{ id: "good", status: "candidate" }, { id: "bad", status: "partial" }]);
});

test("streamed rg output is not limited by a subprocess result buffer", async () => {
  const names = Array.from({ length: 50000 }, (_, index) => `file-${index}.js`).join("\n") + "\n";
  const result = await scanRepo({ id: "large", path: os.tmpdir() }, ["x"], [], { spawn: () => childFor({ status: 0, stdout: names }) });
  assert.equal(result.status, "candidate");
  assert.equal(result.totalFiles, 50000);
});
