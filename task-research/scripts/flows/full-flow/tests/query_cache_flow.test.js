"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runStagePipeline } = require("../src/stage_pipeline.js");
const { runAstBatch } = require("../../../shared/ast/src/batch/batch.js");

function semantic(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.stats.elapsedMs; delete copy.stats.cacheHits; delete copy.stats.cacheMisses;
  if (copy.output) { delete copy.output.bytes; delete copy.output.budgetRequired; }
  return copy;
}

async function inventory(parent, leaf, repositoryScope, queries, options = {}) {
  const outputRoot = path.join(parent, leaf), target = "query cache flow";
  const stage0 = await runStagePipeline({ request: { stage: 0, target, coverageProfile: {}, repositoryScope }, outputRoot,
    runner: () => ({ stage: 0, status: "candidate" }) });
  const events = [];
  let ast;
  const stage1 = await runStagePipeline({ request: { stage: 1, target, repositoryScope, transitionArtifact: stage0.artifact, ast: {} }, outputRoot,
    runner(stageRequest) {
      return runAstBatch({ ...stageRequest.ast, queries }, { queryCacheEnabled: options.queryCacheEnabled, queryCacheObserver: event => events.push(event) }).then(value => {
        ast = value;
        return { stage: 1, status: "candidate", ast };
      });
    } });
  return { ast, events, stage0, stage1, stage1Bytes: fs.readFileSync(stage1.artifact) };
}

test("BDD: sibling inventories reuse, selectively invalidate and recover query results", async t => {
  await t.test("unchanged", async t => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "query-flow-same-"));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const repository = path.join(parent, "repo"); fs.mkdirSync(repository);
    const source = path.join(repository, "feature.js"); fs.writeFileSync(source, "class Feature { constructor() { this.shadow = 1; } }\n");
    const scope = { repositories: [{ id: "source", root: repository, role: "source" }] };
    const queries = [{ id: "shadow", command: "fields", files: [source], options: { field: "shadow" }, includeDetails: true }];
    const seed = await inventory(parent, "seed", scope, queries);
    const before = Buffer.from(seed.stage1Bytes);
    const warm = await inventory(parent, "warm", scope, queries);
    const clean = await inventory(parent, "clean", scope, queries, { queryCacheEnabled: false });
    assert.deepEqual(seed.events.map(event => event.status), ["miss"]);
    assert.deepEqual(warm.events.map(event => event.status), ["hit"]);
    assert.deepEqual(semantic(warm.ast), semantic(clean.ast));
    assert.equal(warm.stage1.status, clean.stage1.status);
    assert.deepEqual(fs.readFileSync(seed.stage1.artifact), before);
  });

  await t.test("selective file change", async t => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "query-flow-change-"));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const repository = path.join(parent, "repo"); fs.mkdirSync(repository);
    const changed = path.join(repository, "changed.js"), stable = path.join(repository, "stable.js");
    fs.writeFileSync(changed, "class Changed { constructor() { this.shadow = 1; } }\n");
    fs.writeFileSync(stable, "class Stable { constructor() { this.color = 1; } }\n");
    const scope = { repositories: [{ id: "source", root: repository, role: "source" }] };
    const queries = [
      { id: "shadow", command: "fields", files: [changed], options: { field: "shadow" } },
      { id: "color", command: "fields", files: [stable], options: { field: "color" } },
    ];
    await inventory(parent, "seed", scope, queries);
    fs.writeFileSync(changed, "class Changed { constructor() { this.shadow = 2; } }\n");
    const current = await inventory(parent, "current", scope, queries);
    const clean = await inventory(parent, "clean", scope, queries, { queryCacheEnabled: false });
    assert.deepEqual(current.events.map(event => event.status), ["miss", "hit"]);
    assert.deepEqual(semantic(current.ast), semantic(clean.ast));
  });

  await t.test("new file invalidates not-found", async t => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "query-flow-add-"));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const repository = path.join(parent, "repo"); fs.mkdirSync(repository);
    const first = path.join(repository, "first.js"), added = path.join(repository, "added.js");
    fs.writeFileSync(first, "class First {}\n"); fs.writeFileSync(added, "class Added { constructor() { this.shadow = 1; } }\n");
    const scope = { repositories: [{ id: "source", root: repository, role: "source" }] };
    const base = { id: "shadow", command: "fields", options: { field: "shadow" } };
    const seed = await inventory(parent, "seed", scope, [{ ...base, files: [first] }]);
    const current = await inventory(parent, "current", scope, [{ ...base, files: [first, added] }]);
    assert.equal(seed.ast.results[0].status, "not-found");
    assert.deepEqual(current.events.map(event => event.status), ["miss"]);
    assert.equal(current.ast.results[0].status, "candidate");
  });

  await t.test("corrupt entry fails open", async t => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "query-flow-corrupt-"));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const repository = path.join(parent, "repo"); fs.mkdirSync(repository);
    const source = path.join(repository, "feature.js"); fs.writeFileSync(source, "class Feature {}\n");
    const scope = { repositories: [{ id: "source", root: repository, role: "source" }] };
    const queries = [{ id: "feature", command: "symbols", files: [source] }];
    const seed = await inventory(parent, "seed", scope, queries);
    const cache = path.join(parent, ".runtime-cache", "ast");
    const entry = fs.readdirSync(cache, { recursive: true }).find(name => String(name).endsWith(".json") && String(name).includes("query-results"));
    assert.ok(entry);
    fs.writeFileSync(path.join(cache, entry), "broken");
    const current = await inventory(parent, "current", scope, queries);
    const clean = await inventory(parent, "clean", scope, queries, { queryCacheEnabled: false });
    assert.deepEqual(current.events.map(event => event.status), ["failed"]);
    assert.deepEqual(semantic(current.ast), semantic(clean.ast));
    assert.deepEqual(fs.readFileSync(seed.stage1.artifact), seed.stage1Bytes);
  });
});

