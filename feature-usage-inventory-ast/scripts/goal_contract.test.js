"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildContract } = require("./goal_contract");

const request = {
  target: "InnerShadow",
  scope: { repos: ["sdkjs", "web-apps"] },
  mode: "continuous",
  artifactDestination: "context/inventories/inner-shadow",
  exclusions: ["vendor"],
  completionCondition: "stage-8-validated",
};

test("goal contract digest is stable for material field order and ignores commentary", () => {
  const first = buildContract(request);
  const second = buildContract({ commentary: "continue", ...request, scope: { repos: ["sdkjs", "web-apps"] } });
  assert.equal(first.objectiveDigest, second.objectiveDigest);
  assert.equal(first.driver, "goal");
});

test("goal contract requires explicit mode and artifact destination", () => {
  assert.throws(() => buildContract({ ...request, mode: undefined }), /mode/);
  assert.throws(() => buildContract({ ...request, artifactDestination: "" }), /artifactDestination/);
  assert.throws(() => buildContract({ ...request, mode: "auto" }), /strict, adaptive, or continuous/);
});
