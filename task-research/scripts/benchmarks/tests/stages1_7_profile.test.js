"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { compareSignature, createSampleLayout, gitSignature, median, operationMedians, parseArgs, unionDuration } = require("../stages1_7_profile.js");

test("stage profile isolates each sample cache under a disposable parent", t => {
  const first = createSampleLayout();
  const second = createSampleLayout();
  t.after(() => { fs.rmSync(first.parent, { recursive: true, force: true }); fs.rmSync(second.parent, { recursive: true, force: true }); });
  assert.equal(path.dirname(first.outputRoot), first.parent);
  assert.notEqual(first.parent, second.parent);
  assert.equal(path.dirname(first.parent), path.dirname(second.parent));
});

test("stage profile parses counts and rejects incomplete options", () => {
  assert.deepEqual(parseArgs(["--runtime", "r", "--requests", "q", "--output", "o", "--runs", "5", "--warmup", "0"]), { runtime: "r", requests: "q", output: "o", runs: 5, warmup: 0 });
  assert.throws(() => parseArgs(["--runtime", "r"]), /--requests/);
});
test("stage profile median and interval union do not double count", () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(unionDuration([{ startMs: 1, endMs: 5 }, { startMs: 3, endMs: 8 }, { startMs: -2, endMs: 1 }], 10), 8);
  assert.throws(() => unionDuration([{ startMs: 0, endMs: 20 }], -1), /exceeds/);
});
test("stage profile summarizes repeated operation intervals per sample", () => {
  const values = [
    { wallMs: 10, operations: [{ kind: "coverage", startMs: 1, endMs: 3 }, { kind: "coverage", startMs: 4, endMs: 5 }] },
    { wallMs: 10, operations: [{ kind: "coverage", startMs: 2, endMs: 4 }] }
  ];
  assert.equal(operationMedians(values).coverage, 2.5);
});
test("profile comparison rejects changed harness, requests, repositories or environment", () => {
  const signature = { harnessDigest: "h", requestDigest: "q", environmentDigest: "e", targetRepositoriesDigest: "r", workloadDigest: "w", implementationDigest: "old" };
  assert.doesNotThrow(() => compareSignature({ signature: { ...signature, implementationDigest: "new" } }, { signature }));
  for (const key of ["harnessDigest", "requestDigest", "environmentDigest", "targetRepositoriesDigest", "workloadDigest"]) assert.throws(() => compareSignature({ signature: { ...signature, [key]: "changed" } }, { signature }), new RegExp(key));
});
test("repository provenance fails closed outside Git", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-profile-no-git-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".git"), "gitdir: missing\n");
  assert.throws(() => gitSignature(root), /Cannot capture repository HEAD/);
});
test("repository provenance binds tracked content and untracked files", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-profile-git-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => { const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); };
  git(["init", "--quiet"]);
  git(["config", "user.email", "benchmark@example.invalid"]);
  git(["config", "user.name", "Benchmark"]);
  fs.writeFileSync(path.join(root, "tracked.txt"), "one\n");
  git(["add", "tracked.txt"]);
  git(["commit", "--quiet", "-m", "fixture"]);
  const clean = gitSignature(root);
  fs.writeFileSync(path.join(root, "tracked.txt"), "two\n");
  const tracked = gitSignature(root);
  assert.notEqual(tracked.worktreeDigest, clean.worktreeDigest);
  fs.writeFileSync(path.join(root, "new.txt"), "first\n");
  const untracked = gitSignature(root);
  fs.writeFileSync(path.join(root, "new.txt"), "second\n");
  assert.notEqual(gitSignature(root).worktreeDigest, untracked.worktreeDigest);
});
