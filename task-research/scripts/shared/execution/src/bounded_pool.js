"use strict";

async function runBounded(items, concurrency, worker) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError("Concurrency must be a positive integer");
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

module.exports = { runBounded };
