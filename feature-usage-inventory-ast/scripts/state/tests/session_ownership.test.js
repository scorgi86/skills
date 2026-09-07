"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { InventorySession } = require("../src/session/inventory_session.js");

test("InventorySession does not expose persistence or mutable draft internals", () => {
  const session = InventorySession.open();
  for (const name of ["store", "snapshot", "draft", "dirty", "isDirty"]) {
    assert.equal(name in session, false, `${name} must remain internal`);
  }
  assert.equal(typeof session.beginStage, "function");
});

test("pipeline delegates unit-of-work creation to InventorySession", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../flows/full-flow/src/stage_pipeline.js"), "utf8");
  assert.doesNotMatch(source, /require\([^\n]*stage_unit_of_work/);
  assert.match(source, /session\.beginStage\s*\(/);
});
