"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SourceSnapshotStore } = require("../src/source_snapshot.js");
const { writeCanonicalTransition } = require("../../dto/tests/test_helpers.js");

test("source snapshot reads and derives one value per physical file", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "source.js");
  fs.writeFileSync(file, "first\r\nsecond\n");
  const calls = { realpath: 0, stat: 0, read: 0, hash: 0 };
  const originalCreateHash = crypto.createHash;
  t.mock.method(crypto, "createHash", (...args) => { calls.hash += 1; return originalCreateHash(...args); });
  const store = new SourceSnapshotStore({
    realpathSync(target) { calls.realpath += 1; return fs.realpathSync(target); },
    statSync(target) { calls.stat += 1; return fs.statSync(target); },
    readFileSync(target) { calls.read += 1; return fs.readFileSync(target); }
  });

  const first = store.get(file);
  const second = store.get(path.join(root, ".", "source.js"));

  assert.strictEqual(second, first);
  assert.deepEqual(calls, { realpath: 1, stat: 1, read: 1, hash: 1 });
  assert.equal(first.text, "first\r\nsecond\n");
  assert.deepEqual(first.lines, ["first", "second", ""]);
  assert.equal(first.sourceHash, crypto.createHash("sha256").update(first.bytes).digest("hex"));
});

test("a new source snapshot store observes a later file version", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-snapshot-refresh-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "source.js");
  fs.writeFileSync(file, "before\n");
  const first = new SourceSnapshotStore().get(file);
  fs.writeFileSync(file, "after\n");
  const second = new SourceSnapshotStore().get(file);
  assert.notEqual(second.sourceHash, first.sourceHash);
  assert.equal(second.text, "after\n");
});

test("source snapshot memoizes misses only for its own lifetime", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-snapshot-lifetime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "later.js");
  const first = new SourceSnapshotStore();
  assert.equal(first.get(file), null);
  fs.writeFileSync(file, "const later = true;\n");
  assert.equal(first.get(file), null);
  assert.match(new SourceSnapshotStore().get(file).text, /later/);
  assert.equal(new SourceSnapshotStore().get(root), null);
});

test("Stage 1 and Stage 2 direct runners share collection and confirmation snapshots", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-snapshot-runners-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "source.js");
  const text = "const Feature = true;\n";
  fs.writeFileSync(file, text);
  const sourceHash = crypto.createHash("sha256").update(text).digest("hex");
  const repositoryScope = { repositories: [{ id: "source", root, role: "source" }] };
  const ast = { status: "candidate", results: [], stats: { parseCounts: {} }, plan: { compiledBeforeParse: true, lateQueries: 0 } };
  for (const stage of [1, 2]) {
    let reads = 0;
    const sourceSnapshots = new SourceSnapshotStore({ readFileSync(file) { reads += 1; return fs.readFileSync(file); } });
    const transitionArtifact = writeCanonicalTransition(root, stage - 1, { facts: { repositoryScope } });
    const request = { stage, transitionArtifact, repositoryScope, repository: "source", ast: { queries: [] }, evidence: { checks: [{
      id: "feature", file, repository: "source", pattern: "Feature",
      confirmation: { status: "source-confirmed", line: 1, endLine: 1, sourceFragment: text.trim(), sourceHash }
    }] } };
    const runner = require(`../../../steps/step-${stage}/src/runner.js`)[`runStage${stage}`];
    const result = await runner(request, {
      sourceSnapshots,
      runAstBatch: async () => ast,
      ...(stage === 1 ? { runGitNexusContext: () => ({ status: "candidate", requests: [] }) } : {})
    });
    assert.equal(reads, 1, `Stage ${stage}`);
    assert.equal(result.canonicalEvidence[0].confirmation.status, "source-confirmed");
    assert.doesNotMatch(JSON.stringify(result), /sourceSnapshots|SourceSnapshotStore|"type":"Buffer"/);
  }
});
