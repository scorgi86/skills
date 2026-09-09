"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const ast = require("../..");
test("bounded queries retain complete non-enumerable items and stable public API", () => {
  const symbols = [{ name: "first", kind: "function" }, { name: "second", kind: "function" }];
  const result = ast.queries.runQuery("symbols", { results: [{ symbols, relations: [] }] }, { maxResults: 1 });
  assert.deepEqual(result.items, symbols.slice(0, 1));
  assert.deepEqual(result._allItems, symbols);
  const descriptor = Object.getOwnPropertyDescriptor(result, "_allItems");
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  assert.equal(JSON.stringify(result).includes("_allItems"), false);
  assert.equal(ast.queries, ast.queries);
});
