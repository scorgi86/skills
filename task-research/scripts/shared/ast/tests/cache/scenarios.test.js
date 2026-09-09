"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

// The override allows the same regression to be demonstrated on the saved baseline.
const scripts = process.env.AST_CACHE_SCENARIO_SCRIPTS || path.resolve(__dirname, "../../../..");
const ast = path.join(scripts, "shared/ast/src");
const { analyzeFiles } = require(path.join(ast, "analysis/analysis.js"));
const { runAstBatch } = require(path.join(ast, "batch/batch.js"));
const source = "class Alpha {} class Owner { constructor() { this.value = new Alpha(); } }";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ast-cache-scenarios-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scope = path.join(directory, "scope");
  fs.mkdirSync(scope);
  const file = path.join(scope, "a.js");
  fs.writeFileSync(file, source);
  return { directory, scope, file, cache: path.join(directory, "cache") };
}

// Only documented permitted differences are removed: timing, cache statistics,
// and byte accounting (which includes those varying values). No result is sorted.
function semantic(value) {
  const copy = JSON.parse(JSON.stringify(value));
  if (copy.stats) {
    delete copy.stats.elapsedMs;
    delete copy.stats.cacheHits;
    delete copy.stats.cacheMisses;
  }
  if (copy.results) for (const result of copy.results) delete result.elapsedMs;
  if (copy.data) delete copy.data.elapsedMs;
  if (copy.coverage) {
    delete copy.coverage.outputBytes;
    delete copy.coverage.rawOutputBytes;
  }
  if (copy.output) {
    delete copy.output.bytes;
    delete copy.output.budgetRequired;
  }
  return copy;
}

function request(file, cache, maxOutputBytes = 1e7) {
  return { cache, maxOutputBytes, queries: [
    { id: "all", command: "symbols", files: [file, file], includeDetails: true },
    { id: "alpha", command: "find", file, options: { terms: "Alpha" }, includeDetails: true },
    { id: "missing", command: "find", file, options: { terms: "AbsentType" }, includeDetails: true },
    { id: "fields", command: "fields", file, options: { field: "value" }, includeDetails: true },
  ] };
}

test("batch warm reuse skips real SWC and indexing while every query reruns", (t) => {
  const f = fixture(t);
  const child = spawnSync(process.execPath, ["-e", `
    const path = require('node:path');
    const ast = process.env.SCENARIO_AST;
    const swc = require(require.resolve('@swc/core', { paths: [ast] }));
    const counts = { swc: 0, index: 0, relations: 0, query: 0 };
    const parse = swc.parseSync;
    swc.parseSync = function(...args) { counts.swc++; return parse.apply(this, args); };
    for (const [file, name, counter] of [
      ['analysis/symbol_index.js', 'createSymbolIndex', 'index'],
      ['analysis/relations.js', 'createRelations', 'relations'],
      ['query/queries.js', 'runQuery', 'query']
    ]) {
      const module = require(path.join(ast, file));
      const original = module[name];
      module[name] = function(...args) { counts[counter]++; return original.apply(this, args); };
    }
    const { runAstBatch } = require(path.join(ast, 'batch/batch.js'));
    const request = JSON.parse(process.env.SCENARIO_REQUEST);
    const cold = runAstBatch(request);
    const coldCounts = { ...counts };
    for (const key of Object.keys(counts)) counts[key] = 0;
    const warm = runAstBatch(request);
    process.stdout.write(JSON.stringify({ cold, warm, coldCounts, warmCounts: counts }));
  `], { encoding: "utf8", env: { ...process.env, SCENARIO_AST: ast, SCENARIO_REQUEST: JSON.stringify(request(f.file, f.cache)) } });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.deepEqual(result.coldCounts, { swc: 1, index: 1, relations: 1, query: 4 });
  assert.deepEqual(result.warmCounts, { swc: 0, index: 0, relations: 0, query: 4 });
  assert.equal(result.warm.stats.parsed, 1, "legacy parsed counts successful analyses, not SWC calls");
  assert.deepEqual(result.warm.stats.parseCounts, { [f.file]: 1 });
  assert.deepEqual(semantic(result.warm), semantic(result.cold));
});

test("collection preserves normalized first-seen order and mixed hit, miss and parse failure", (t) => {
  const f = fixture(t);
  const second = path.join(f.scope, "b.js");
  const broken = path.join(f.scope, "broken.js");
  fs.writeFileSync(second, "class Beta {}");
  fs.writeFileSync(broken, "class {");
  analyzeFiles([f.file], { cache: f.cache });
  const files = [second, f.file, path.join(f.scope, "..", "scope", "b.js"), broken, f.file];
  const mixed = analyzeFiles(files, { cache: f.cache });
  assert.deepEqual(mixed.results.map((item) => item.file), [second, f.file, broken]);
  assert.deepEqual({ ...mixed.stats, elapsedMs: 0 }, {
    filesMatched: 3, parsed: 2, failed: 1, skipped: 0, cacheHits: 1, cacheMisses: 1, elapsedMs: 0,
  });
  assert.equal(mixed.results[2].status, "не проверено");
  assert.ok(mixed.results[2].errors.length);
  assert.deepEqual(mixed.results[2].warnings, []);
  assert.deepEqual(semantic(mixed), semantic(analyzeFiles(files)));
});

test("batch generous-budget cached projections equal uncached, including negative query", (t) => {
  const f = fixture(t);
  const uncached = runAstBatch(request(f.file));
  const cold = runAstBatch(request(f.file, f.cache));
  const warm = runAstBatch(request(f.file, f.cache));
  assert.deepEqual(semantic(cold), semantic(uncached));
  assert.deepEqual(semantic(warm), semantic(uncached));
  assert.equal(warm.results[1].status, "candidate");
  assert.equal(warm.results[2].status, "not-found");
  assert.equal(warm.results[3].status, "candidate");
  assert.equal(warm.output.autoRaised, false);
});

test("boundary budget preserves required batch evidence and accounts for actual bytes", (t) => {
  const f = fixture(t);
  const large = runAstBatch(request(f.file, f.cache));
  for (const budget of [4096, large.output.bytes, large.output.bytes + 1]) {
    const bounded = runAstBatch(request(f.file, f.cache, budget));
    assert.deepEqual(bounded.results, large.results);
    assert.equal(bounded.output.bytes, Buffer.byteLength(JSON.stringify(bounded)));
    assert.equal(bounded.output.bounded, true);
    assert.ok(bounded.output.budgetApplied >= bounded.output.bytes);
    assert.equal(bounded.output.autoRaised, bounded.output.budgetRequired > bounded.output.budgetRequested);
    assert.equal(bounded.warnings.some((item) => item.code === "output-budget-auto-raised"), bounded.output.autoRaised);
  }
});

function cli(args, cwd, budget = 10000000) {
  const child = spawnSync(process.execPath, [path.join(scripts, "cli/src/commands/prototype_ast.js"),
    ...args, "--max-output-bytes", String(budget)], { cwd, encoding: "utf8", env: process.env });
  assert.ok(child.status === 0 || child.status === 1, child.stderr || child.stdout);
  return { status: child.status, output: JSON.parse(child.stdout) };
}

test("separate CLI processes honor cold/warm content identity and opt-in from foreign cwd", (t) => {
  const f = fixture(t);
  const args = ["analyze", "--file", f.file];
  const plain = cli(args, f.directory);
  assert.equal(fs.existsSync(f.cache), false);
  const cold = cli([...args, "--cache", f.cache], f.directory);
  const warm = cli([...args, "--cache", f.cache], f.directory);
  assert.equal(cold.output.stats.cacheMisses, 1);
  assert.equal(warm.output.stats.cacheHits, 1);
  assert.deepEqual(semantic(cold.output), semantic(plain.output));
  assert.deepEqual(semantic(warm.output), semantic(plain.output));
  const stat = fs.statSync(f.file);
  fs.writeFileSync(f.file, source.replaceAll("Alpha", "Bravo"));
  fs.utimesSync(f.file, stat.atime, stat.mtime);
  assert.equal(fs.statSync(f.file).size, stat.size);
  const changed = cli([...args, "--cache", f.cache], f.directory);
  assert.equal(changed.output.stats.cacheMisses, 1);
  assert.ok(changed.output.data.symbols.some((item) => item.name === "Bravo"));
  assert.ok(!changed.output.data.symbols.some((item) => item.name === "Alpha"));
  assert.deepEqual(semantic(changed.output), semantic(cli(args, f.directory).output));
});

test("CLI budget boundaries retain truthful coverage without requiring identical projection", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.file, Array.from({ length: 12 }, (_, i) => `class Type${i} { method() { return ${i}; } }`).join("\n"));
  const args = ["symbols", "--file", f.file, "--cache", f.cache];
  const large = cli(args, f.directory).output;
  for (const budget of [2048, large.coverage.rawOutputBytes, large.coverage.rawOutputBytes + 1]) {
    const result = cli(args, f.directory, budget).output;
    const coverage = result.coverage;
    assert.equal(result.stats.cacheHits, 1);
    assert.equal(coverage.totalItems, large.coverage.totalItems);
    assert.equal(coverage.evidenceTotal, large.coverage.evidenceTotal);
    assert.equal(coverage.outputBytes, Buffer.byteLength(JSON.stringify(result)));
    assert.equal(coverage.outputBudget, budget);
    assert.ok(coverage.outputBytes <= budget || result.warnings.some((item) => item.code === "output-budget-exceeded"));
    assert.equal(coverage.evidenceReturned + coverage.evidenceSuppressed, coverage.evidenceTotal);
    assert.equal(coverage.itemsReturned, result.data.items.length);
    assert.equal(coverage.groupsReturned, (result.data.groups || []).length);
    for (const item of result.data.items) {
      assert.ok(large.data.items.some((original) => original.qualifiedName === item.qualifiedName));
    }
  }
});

test("CLI scope selection reflects added, removed, renamed and malformed files", (t) => {
  const f = fixture(t);
  const args = ["symbols", "--scope", f.scope, "--cache", f.cache];
  const run = () => cli(args, f.directory);
  assert.equal(run().output.stats.cacheMisses, 1);
  const added = path.join(f.scope, "b.js");
  fs.writeFileSync(added, "class Beta {}");
  let result = run();
  assert.equal(result.output.stats.filesMatched, 2);
  assert.equal(result.output.stats.cacheHits, 1);
  assert.equal(result.output.stats.cacheMisses, 1);
  fs.unlinkSync(f.file);
  result = run();
  assert.equal(result.output.stats.filesMatched, 1);
  assert.ok(!JSON.stringify(result.output.data).includes("Alpha"));
  const renamed = path.join(f.scope, "renamed.js");
  fs.renameSync(added, renamed);
  result = run();
  assert.equal(result.output.stats.cacheHits, 0);
  assert.equal(result.output.stats.cacheMisses, 1);
  assert.ok(result.output.data.items.length > 0);
  assert.ok(result.output.data.items.every((item) => item.evidence.length > 0 && item.evidence.every((evidence) => evidence.file === renamed)));
  const malformed = path.join(f.scope, "malformed.js");
  fs.writeFileSync(malformed, "class {");
  result = run();
  assert.equal(result.status, 1);
  assert.equal(result.output.stats.parsed, 1);
  assert.equal(result.output.stats.failed, 1);
  assert.equal(result.output.stats.cacheHits, 1);
  assert.equal(result.output.stats.cacheMisses, 0);
  assert.ok(result.output.errors.some((item) => item.file === malformed));
  assert.deepEqual(semantic(result.output), semantic(cli(["symbols", "--scope", f.scope], f.directory).output));
});
