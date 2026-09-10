"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { combinedAst, comparable, gain, median, parseArgs, semantic, summarize } = require("../parallel_ast.js");

test("parallel AST benchmark requires balanced isolated samples", () => {
  assert.deepEqual(parseArgs(["--runtime", "r", "--workload", "w", "--output", "o", "--runs", "6", "--warmup", "1"]), { runtime: "r", workload: "w", output: "o", runs: 6, warmup: 1 });
  assert.throws(() => parseArgs(["--runtime", "r", "--workload", "w", "--output", "o", "--runs", "5"]), /even/);
  assert.deepEqual(parseArgs(["--baseline", "a", "--current", "b", "--workload", "w", "--output", "o"]),
    { baseline: "a", current: "b", workload: "w", output: "o", runs: 6, warmup: 1 });
  assert.throws(() => parseArgs(["--baseline", "a", "--current", "b", "--workload", "w", "--output", "o", "--runs", "4"]), /at least 6/);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("parallel AST benchmark semantic projection ignores runtime-only fields", () => {
  const a = { status: "candidate", stats: { elapsedMs: 10, cacheHits: 0 }, results: [{ id: "x", elapsedMs: 2 }] };
  const b = { status: "candidate", stats: { elapsedMs: 20, cacheHits: 3 }, results: [{ id: "x", elapsedMs: 5 }] };
  assert.deepEqual(semantic(a), semantic(b));
});

test("parallel AST benchmark summarizes stages independently", () => {
  const samples = [1, 2].map(value => ({ stages: [
    { stage: 1, wallMs: value, astMs: value, evidenceMs: 0, residualMs: 0, files: 2, cacheHits: 0, cacheMisses: 2, semanticDigest: "one" },
    { stage: 2, wallMs: value * 2, astMs: value, evidenceMs: value, residualMs: 0, files: 3, cacheHits: 1, cacheMisses: 2, semanticDigest: "two" },
  ] }));
  const result = summarize(samples);
  assert.equal(result[0].wallMs, 1.5);
  assert.equal(result[1].evidenceMs, 1.5);
  assert.deepEqual(result[1].semanticDigests, ["two"]);
});

test("parallel AST A/B compares quality before calculating stage gains", () => {
  const stage = { astMs: 10, semanticDigests: ["semantic"], qualityDigests: ["quality"], files: [2], queries: [3], sourceChecks: [4], cacheHits: [2], cacheMisses: [0] };
  assert.equal(comparable([stage], [{ ...stage }]), true);
  assert.equal(comparable([stage], [{ ...stage, qualityDigests: ["changed"] }]), false);
  assert.equal(combinedAst([stage, { ...stage, astMs: 5 }]), 15);
  assert.equal(gain(100, 80), 20);
});
