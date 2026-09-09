"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { runBounded } = require("../src/bounded_pool.js");

test("bounded pool limits active work and preserves input order", async () => {
  let active = 0;
  let maximum = 0;
  const values = await runBounded([30, 5, 15, 1], 2, async (delay, index) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return index;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(values, [0, 1, 2, 3]);
});

test("bounded pool supports empty and sequential work and rejects invalid limits", async () => {
  assert.deepEqual(await runBounded([], 2, () => assert.fail()), []);
  let active = 0;
  await runBounded([1, 2], 1, async () => { active += 1; assert.equal(active, 1); await Promise.resolve(); active -= 1; });
  await assert.rejects(runBounded([1], 0, async () => 1), /positive integer/);
});
