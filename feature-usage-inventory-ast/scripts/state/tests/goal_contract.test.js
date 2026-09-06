"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildContract } = require("../src/goal_contract");

const request = {
  target: "FeatureValue",
  scope: { repositories: ["repository-a", "repository-b"] },
  mode: "continuous",
  artifactDestination: "context/inventories/target-feature",
  exclusions: ["vendor"],
  completionCondition: "stage-8-validated",
};

test("goal contract digest is stable for material field order and ignores commentary", () => {
  const first = buildContract(request);
  const second = buildContract({ commentary: "continue", ...request, scope: { repositories: ["repository-a", "repository-b"] } });
  assert.equal(first.objectiveDigest, second.objectiveDigest);
  assert.equal(first.driver, "goal");
});

test("goal contract defaults mode and derives artifact destination", () => {
  assert.equal(buildContract({ ...request, mode: undefined }).material.mode, "continuous");
  assert.match(buildContract({ ...request, artifactDestination: "" }).material.artifactDestination, /^\.codex\/inventory-artifacts\/featurevalue-/);
  assert.throws(() => buildContract({ ...request, mode: "auto" }), /strict, adaptive, or continuous/);
});
