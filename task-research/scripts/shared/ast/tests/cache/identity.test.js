const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { createIdentity } = require("../../src/cache/identity.js");
const parser = { name: "@swc/core", version: "1", options: { syntax: "ecmascript" } };

test("cache identity is deterministic and binds raw bytes, path, parser and versions", () => {
  const make = (bytes = Buffer.from("abc"), file = "one.js", metadata = parser, versions) => createIdentity(bytes, file, metadata, versions);
  const original = make();
  assert.match(original.key, /^[a-f0-9]{64}$/);
  assert.equal(original.file, path.resolve("one.js"));
  assert.deepEqual(make(), original);
  for (const changed of [
    make(Buffer.from("abd")), make(Buffer.from("abc"), "two.js"),
    make(undefined, undefined, { ...parser, version: "2" }),
    make(undefined, undefined, { ...parser, options: { syntax: "typescript" } }),
    make(undefined, undefined, parser, { analyzerVersion: "next" }),
    make(undefined, undefined, parser, { formatVersion: "next" }),
  ]) assert.notEqual(changed.key, original.key);
  // These bytes decode identically; identity must still distinguish their raw content.
  assert.notEqual(make(Buffer.from([0xff])).key, make(Buffer.from([0xfe])).key);
});
