"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { decide, parseArgs, summarize } = require("../query_cache.js");

const sample = (pairWallMs, digest = "same", events = [{ status: "hit" }]) => ({ pairWallMs, events, runQueryCalls: 1, runQueryMs: 4, maxRssKiB: 100, cacheBytes: 20, stages: [{ wallMs: pairWallMs / 2, semanticDigest: digest }, { wallMs: pairWallMs / 2, semanticDigest: digest }] });

test("query-cache benchmark requires balanced samples", () => {
  assert.deepEqual(parseArgs(["--runtime", "r", "--workload", "w", "--output", "o"]), { runtime: "r", workload: "w", output: "o", runs: 6, warmup: 1 });
  assert.throws(() => parseArgs(["--runtime", "r", "--workload", "w", "--output", "o", "--runs", "5"]), /even/);
});

test("query-cache benchmark summarizes paired wall samples", () => {
  const summary = summarize([sample(100), sample(80)]);
  assert.equal(summary.pairMedianMs, 90);
  assert.equal(summary.stage1MedianMs, 45);
  assert.equal(summary.runQueryMedianMs, 4);
  assert.deepEqual(summary.eventCounts.hit, [1, 1]);
});

test("query-cache decision requires semantic equality and five percent in both series", () => {
  const series = (baseline, current, currentDigest = "same") => ({ modes: { baseline: { summary: summarize([sample(baseline)]) }, current: { summary: summarize([sample(current, currentDigest)]) } } });
  assert.equal(decide([series(100, 94), series(200, 180)]).result, "retain");
  assert.equal(decide([series(100, 96), series(200, 180)]).result, "remove");
  assert.equal(decide([series(100, 90, "changed"), series(200, 180)]).result, "remove");
});
