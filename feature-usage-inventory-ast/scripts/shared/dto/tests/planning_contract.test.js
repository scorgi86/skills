"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPlanningProjection } = require("../src/planning_contract");

test("planning projection preserves typed cross-stage facts and merges stable ids", () => {
  const projection = buildPlanningProjection([
    { stage: 3, facts: [{ kind: "scenario", id: "draw", status: "candidate", evidenceRefs: ["ev-1"] }] },
    { stage: 5, facts: [{ kind: "scenario", id: "draw", status: "source-confirmed", recipientRefs: ["shape"] }, { kind: "critical-path", id: "render", scenarioRefs: ["draw"] }] },
    { stage: 6, facts: [{ kind: "gap", id: "missing-export", expectedPath: "export", pathRefs: ["render"] }] },
  ]);
  assert.equal(projection.scenarios.length, 1);
  assert.equal(projection.scenarios[0].status, "confirmed");
  assert.deepEqual(projection.scenarios[0].sourceStages, [3, 5]);
  assert.equal(projection.criticalPaths[0].id, "render");
  assert.equal(projection.gaps[0].expectedPath, "export");
});
