"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { IDS } = require("../../../dto/src/capability_contract.js");
const { normalizeCoverageProfile, coverageErrors } = require("../../src/model/coverage.js");
function profile(kind = "full-inventory") {
  return { kind, requiredCapabilities: [...IDS], requiredCollections: ["scenarios", "criticalPaths", ...(kind === "full-development" ? ["gaps", "implementationEntryPoints"] : [])] };
}
function model(kind) {
  return { coverage: { profile: profile(kind) }, capabilities: [...IDS].map(id => ({ id, status: "not-applicable", requiredForFinalReport: true, reasonCode: "architecture", explanation: "Fixture has no production layer" })), scenarios: [{ id: "open", status: "confirmed", entry: "Open document", steps: ["Read stored effect"], result: "Effect state loaded" }], criticalPaths: [{ id: "load", status: "confirmed", statement: "Reader loads effect state" }] };
}
test("full profile rejects missing capabilities and goal-dependent collections", () => {
  assert.throws(() => normalizeCoverageProfile({ ...profile(), requiredCapabilities: [...IDS].slice(0, 8) }), /capabilit/i);
  assert.throws(() => normalizeCoverageProfile({ ...profile(), requiredCollections: ["criticalPaths"] }), /scenarios/);
  assert.throws(() => normalizeCoverageProfile({ ...profile("full-development"), requiredCollections: ["scenarios", "criticalPaths", "gaps"] }), /implementationEntryPoints/);
  for (const kind of ["full-inventory", "full-development"]) assert.equal(normalizeCoverageProfile(profile(kind)).kind, kind);
  assert.equal(normalizeCoverageProfile({ kind: "bounded", requiredCapabilities: ["ownership"] }).kind, "bounded");
  assert.equal(Object.hasOwn(normalizeCoverageProfile({ requiredCapabilities: ["ownership"] }), "kind"), false);
  assert.throws(() => normalizeCoverageProfile({ ...profile(), kind: "other" }), /kind/);
});
test("full scenario needs entry, steps and result; bounded and archive keep old rules", () => {
  const value = model();
  assert.deepEqual(coverageErrors(value), []);
  for (const field of ["entry", "steps", "result"]) {
    const copy = structuredClone(value); delete copy.scenarios[0][field];
    assert.ok(coverageErrors(copy).some(error => error.code === "scenario-content"));
  }
  value.scenarios = [{ id: "name-only", name: "Open", status: "confirmed" }];
  assert.ok(coverageErrors(value).some(error => error.code === "scenario-content"));
  value.coverage.profile = { kind: "bounded", requiredCapabilities: ["ownership"], requiredCollections: ["scenarios"] };
  assert.deepEqual(coverageErrors(value), []);
  delete value.coverage.profile.kind;
  assert.deepEqual(coverageErrors(value), []);
});
test("full N/A scenario and expected absence scenario use separate contracts", () => {
  const value = model();
  value.scenarios = [{ id: "na", status: "not-applicable", reasonCode: "task-scope", explanation: "No user command in fixture" }];
  assert.deepEqual(coverageErrors(value), []);
  value.scenarios = [{ id: "absence", status: "checked-no-usage", entry: "Edit effect", steps: ["Dispatch expected setter"], result: "No setter found in checked scope" }];
  assert.deepEqual(coverageErrors(value), []);
  value.scenarios[0].steps = [" "];
  assert.ok(coverageErrors(value).some(error => error.code === "scenario-content"));
});
