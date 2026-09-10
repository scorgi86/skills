"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { median, parseArgs, semantic, summarize } = require("../parallel_ast.js");

test("parallel AST benchmark requires balanced isolated samples", () => {
  assert.deepEqual(parseArgs(["--runtime", "r", "--workload", "w", "--output", "o", "--runs", "6", "--warmup", "1"]), { runtime: "r", workload: "w", output: "o", runs: 6, warmup: 1 });
  assert.throws(() => parseArgs(["--runtime", "r", "--workload", "w", "--output", "o", "--runs", "5"]), /even/);
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
