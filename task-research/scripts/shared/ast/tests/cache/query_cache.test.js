"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createQueryIdentity, isCacheableQuery } = require("../../src/query-cache/identity.js");
const { readQueryEntry, writeQueryEntry } = require("../../src/query-cache/storage.js");
const { runAstBatch } = require("../../src/batch/batch.js");

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "query-cache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("query identity contains only functional query and ordered analysis inputs", () => {
  const base = { command: "fields", options: { owner: "Shape", field: "shadow", maxResults: 1 }, analysisKeys: ["a", "b"] };
  const first = createQueryIdentity(base);
  assert.deepEqual(first, createQueryIdentity({ ...base, options: { field: "shadow", maxResults: 999, owner: "Shape" } }));
  for (const changed of [
    { ...base, command: "reads" },
    { ...base, options: { owner: "Other", field: "shadow" } },
    { ...base, analysisKeys: ["b", "a"] },
    { ...base, analysisKeys: ["a", "changed"] },
  ]) assert.notEqual(first.key, createQueryIdentity(changed).key);
  for (const command of ["stats", "chain", "future-command"]) assert.equal(isCacheableQuery(command), false);
  assert.equal(isCacheableQuery("fields"), true);
});

test("query storage validates exact entries and fails open", t => {
  const root = temporary(t);
  const identity = createQueryIdentity({ command: "fields", options: { field: "shadow" }, analysisKeys: ["a"] });
  assert.equal(readQueryEntry(root, identity).status, "miss");
  assert.equal(writeQueryEntry(root, identity, [{ field: "shadow" }]).status, "written");
  assert.deepEqual(readQueryEntry(root, identity), { status: "hit", items: [{ field: "shadow" }] });
  fs.writeFileSync(path.join(root, `${identity.key}.json`), "not json");
  assert.equal(readQueryEntry(root, identity).status, "failed");
  assert.equal(writeQueryEntry(path.join(root, "blocked"), identity, [null]).status, "failed");
});

test("concurrent query cache publication leaves one complete entry", async t => {
  const root = temporary(t);
  const identity = createQueryIdentity({ command: "symbols", analysisKeys: ["same"] });
  const storage = path.resolve(__dirname, "../../src/query-cache/storage.js");
  const script = "const [m,d,i]=process.argv.slice(1);const s=require(m);const r=s.writeQueryEntry(d,JSON.parse(i),[{kind:'class'}]);if(!['written','failed'].includes(r.status))process.exit(2)";
  const children = Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, storage, root, JSON.stringify(identity)], { windowsHide: true });
    child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`child exited ${code}`)));
  }));
  await Promise.all(children);
  assert.deepEqual(readQueryEntry(root, identity), { status: "hit", items: [{ kind: "class" }] });
  assert.equal(fs.readdirSync(root).filter(name => name.endsWith(".tmp")).length, 0);
});

test("batch reuses full query items and selectively invalidates changed analysis", async t => {
  const root = temporary(t), cache = path.join(root, "cache");
  const one = path.join(root, "one.js"), two = path.join(root, "two.js");
  fs.writeFileSync(one, "class One { constructor() { this.shadow = 1; } }\n");
  fs.writeFileSync(two, "class Two { constructor() { this.color = 1; } }\n");
  const request = { cache, queries: [
    { id: "shadow", command: "fields", files: [one], options: { field: "shadow", maxResults: 1 }, maxGroups: 10 },
    { id: "color", command: "fields", files: [two], options: { field: "color" }, maxGroups: 10 },
  ] };
  const events = [], dependencies = { queryCacheObserver: event => events.push(event) };
  const cold = await runAstBatch(request, dependencies);
  assert.deepEqual(events.map(item => item.status), ["miss", "miss"]);
  events.length = 0;
  const warm = await runAstBatch(request, dependencies);
  assert.deepEqual(events.map(item => item.status), ["hit", "hit"]);
  assert.deepEqual(warm.results, cold.results);
  events.length = 0;
  const presentationChange = await runAstBatch({ ...request, queries: [{ ...request.queries[0], options: { field: "shadow", maxResults: 999 } }, request.queries[1]] }, dependencies);
  assert.deepEqual(events.map(item => item.status), ["hit", "hit"]);
  assert.deepEqual(presentationChange.results, cold.results);
  fs.writeFileSync(one, "class One { constructor() { this.shadow = 2; } }\n");
  events.length = 0;
  await runAstBatch(request, dependencies);
  assert.deepEqual(events.map(item => item.status), ["miss", "hit"]);
});

test("not-found file-set changes, corrupt entries and excluded commands run safely", async t => {
  const root = temporary(t), cache = path.join(root, "cache");
  const one = path.join(root, "one.js"), two = path.join(root, "two.js");
  fs.writeFileSync(one, "class One {}\n");
  fs.writeFileSync(two, "class Two { constructor() { this.shadow = 1; } }\n");
  const query = { id: "missing", command: "fields", files: [one], options: { field: "shadow" } };
  const events = [], dependencies = { queryCacheObserver: event => events.push(event) };
  const empty = await runAstBatch({ cache, queries: [query] }, dependencies);
  assert.equal(empty.results[0].status, "not-found");
  const emptyKey = events[0].key;
  events.length = 0;
  await runAstBatch({ cache, queries: [{ ...query, files: [one, two] }] }, dependencies);
  assert.deepEqual(events.map(item => item.status), ["miss"]);
  fs.writeFileSync(path.join(cache, "query-results", `${emptyKey}.json`), "broken");
  events.length = 0;
  const recovered = await runAstBatch({ cache, queries: [query] }, dependencies);
  assert.equal(recovered.results[0].status, "not-found");
  assert.deepEqual(events.map(item => item.status), ["failed"]);
  events.length = 0;
  await runAstBatch({ cache, queries: [{ id: "stats", command: "stats", files: [one] }] }, dependencies);
  assert.deepEqual(events.map(item => item.status), ["ineligible"]);
});
