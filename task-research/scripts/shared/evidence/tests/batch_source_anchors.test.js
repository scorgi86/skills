"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { batchSourceAnchors } = require("../src/batch_source_anchors.js");
const { confirmationOf } = require("../src/canonicalization/source_confirmation.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch-anchors-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "file.js"), "one\r\ntwo\r\nthree\r\n");
  const repositoryScope = { repositories: [{ id: "repo", root: repo }] };
  const row = (id, line, endLine) => ({ id, repository: "repo", file: "file.js", line, endLine, status: "source-confirmed" });
  const request = { stage: 6, repositoryScope, canonicalEvidence: [row("a", 1, 2), row("b", 3, 3), { id: "absent", status: "checked-no-usage" }] };
  return { root, repo, request, row };
}

test("fills two anchors from one snapshot and preserves other facts", () => {
  const { root, request } = fixture();
  try {
    let reads = 0;
    const result = batchSourceAnchors(request, { readFileSync(file) { reads++; return fs.readFileSync(file); } });
    assert.equal(reads, 1);
    assert.equal(result.count, 2);
    assert.equal(result.request.canonicalEvidence[0].sourceFragment, "one\ntwo");
    assert.equal(result.request.canonicalEvidence[1].sourceFragment, "three");
    assert.equal(result.request.canonicalEvidence[0].sourceHash, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "repo/file.js"))).digest("hex"));
    assert.deepEqual(result.request.canonicalEvidence[2], request.canonicalEvidence[2]);
    assert.equal(Object.hasOwn(request.canonicalEvidence[0], "sourceHash"), false);
    assert.equal(confirmationOf(result.request.canonicalEvidence[0], { repositoryScope: request.repositoryScope }).status, "source-confirmed");
    fs.writeFileSync(path.join(root, "repo/file.js"), "changed\n");
    assert.equal(confirmationOf(result.request.canonicalEvidence[0], { repositoryScope: request.repositoryScope }).status, "candidate");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("rejects malformed selections without changing input", () => {
  const { root, request, row } = fixture();
  try {
    const invalid = [
      { ...request, stage: 5 },
      { ...request, canonicalEvidence: [row("a", 0, 1)] },
      { ...request, canonicalEvidence: [row("a", 1, 9)] },
      { ...request, canonicalEvidence: [row("a", 1, 1), row("a", 2, 2)] },
      { ...request, canonicalEvidence: [{ ...row("a", 1, 1), sourceHash: "x" }] },
      { ...request, canonicalEvidence: [row("a", 1, 1)], repositoryScope: { repositories: [] } },
      { ...request, canonicalEvidence: [{ ...row("a", 1, 1), file: "../outside.js" }] }
    ];
    for (const value of invalid) assert.throws(() => batchSourceAnchors(value), (error) => Boolean(error.code && Number.isInteger(error.index ?? 0)));
    assert.equal(Object.hasOwn(request.canonicalEvidence[0], "sourceHash"), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("keeps completed rows and handles an empty selection", () => {
  const { root, request } = fixture();
  try {
    const complete = { ...request.canonicalEvidence[0], sourceHash: "existing", sourceFragment: "existing" };
    request.canonicalEvidence = [complete, request.canonicalEvidence[2]];
    const result = batchSourceAnchors(request);
    assert.equal(result.count, 0);
    assert.deepEqual(result.request, request);
    assert.deepEqual(result.request.canonicalEvidence[0], complete);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("rejects a symlink escaping the declared repository", (context) => {
  const { root, repo, request } = fixture();
  try {
    const outside = path.join(root, "outside.js");
    fs.writeFileSync(outside, "outside\n");
    try { fs.symlinkSync(outside, path.join(repo, "link.js")); }
    catch (error) { if (error.code === "EPERM") return context.skip("symlinks unavailable"); throw error; }
    request.canonicalEvidence = [{ ...request.canonicalEvidence[0], file: "link.js" }];
    assert.throws(() => batchSourceAnchors(request), { code: "repository-attribution" });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI creates a separate ready request and no output on validation failure", () => {
  const { root, request } = fixture();
  const cli = path.resolve(__dirname, "../../../index.js");
  const draft = path.join(root, "draft.json"), ready = path.join(root, "ready.json");
  try {
    fs.writeFileSync(draft, JSON.stringify(request));
    const run = (output) => spawnSync(process.execPath, [cli, "batch_source_anchors", "--request", draft, "--output", output], { encoding: "utf8" });
    const ok = run(ready);
    assert.equal(ok.status, 0, ok.stdout || ok.stderr);
    assert.equal(JSON.parse(ok.stdout).count, 2);
    assert.equal(JSON.parse(fs.readFileSync(ready)).canonicalEvidence[0].sourceFragment, "one\ntwo");
    assert.deepEqual(JSON.parse(fs.readFileSync(draft)), request);
    assert.equal(run(ready).status, 2);
    assert.equal(run(draft).status, 2);
    const bad = path.join(root, "bad.json");
    request.canonicalEvidence[1].line = 99;
    fs.writeFileSync(draft, JSON.stringify(request));
    const fail = run(bad);
    assert.equal(fail.status, 2);
    assert.equal(fs.existsSync(bad), false);
    assert.equal(JSON.parse(fail.stdout).errors[0].id, "b");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI removes only its newly created output after a write failure", () => {
  const { root, request } = fixture();
  const draft = path.join(root, "draft.json"), ready = path.join(root, "ready.json");
  try {
    fs.writeFileSync(draft, JSON.stringify(request));
    const command = path.resolve(__dirname, "../../../cli/src/commands/batch_source_anchors.js");
    const program = `const fs = require('node:fs');
      const write = fs.writeFileSync;
      fs.writeFileSync = (target, data, options) => {
        if (typeof target === 'number') { write(target, 'partial'); throw Error('simulated write failure'); }
        return write(target, data, options);
      };
      process.argv = [process.execPath, ${JSON.stringify(command)}, '--request', ${JSON.stringify(draft)}, '--output', ${JSON.stringify(ready)}];
      require(${JSON.stringify(command)})();`;
    const result = spawnSync(process.execPath, ["-e", program], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.equal(fs.existsSync(ready), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(draft)), request);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
