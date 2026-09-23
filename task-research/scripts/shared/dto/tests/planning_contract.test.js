"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPlanningProjection } = require("../src/planning_contract");
test("merged planning provenance retains Stage0", () => {
  const projection = buildPlanningProjection([0, 1].map(stage => ({ stage, facts: [{ kind: "dictionary", id: "term", status: "candidate" }] })));
  assert.deepEqual(projection.dictionary[0].sourceStages, [0, 1]);
});

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

test("intermediate states preserve proof and never promote process completion", () => {
 const {normalizeStatus,normalizePlanningFact,mergeRows}=require("../src/planning_contract");
 assert.equal(normalizeStatus("candidate"),"candidate"); assert.equal(normalizeStatus("closed"),"unknown"); assert.equal(normalizeStatus("matched"),"candidate");
 assert.throws(()=>normalizeStatus("made-up"),/Unsupported.*status/);
 const fact=normalizePlanningFact({kind:"gap",id:"g",status:"product-gap",statement:"Missing setter"},6,0).row;
 assert.equal(fact.status,"unknown");assert.equal(fact.category,"product-gap");
 const merged=mergeRows([{id:"x",role:"owner",status:"candidate",sourceStage:1},{id:"x",role:"consumer",status:"confirmed",sourceStage:6}])[0];
 assert.deepEqual(merged.roles,["consumer","owner"]);assert.ok(merged.conflicts.some(x=>x.field==="role")); assert.deepEqual(merged.sourceStages,[1,6]);
});

test("planning merge rejects missing identity and filled conflicts before merging", () => {
  const { mergePlanningRows } = require("../src/planning_contract");
  assert.throws(() => mergePlanningRows([{ entry: "A" }, { entry: "B" }], "scenarios"), /scenarios.*id/);
  assert.throws(() => mergePlanningRows([{ id: "s", entry: "A" }, { id: "s", entry: "B" }], "scenarios"), /scenarios.*s.*entry/);
  assert.throws(() => mergePlanningRows([{ id: "s", steps: ["A", "B"] }, { id: "s", steps: ["B", "A"] }], "scenarios"), /steps/);
  assert.throws(() => mergePlanningRows([{ id: "s", status: "confirmed" }, { id: "s", status: "candidate" }], "scenarios"), /status/);
});

test("planning merge is idempotent and enriches empty fields without clearing filled ones", () => {
  const { mergePlanningRows } = require("../src/planning_contract");
  const rows = [
    { id: "s", status: "candidate", entry: " ", steps: [], result: null, evidenceRefs: ["ev-a"], sourceStage: 1 },
    { id: "s", status: "source-confirmed", entry: "Open", steps: ["Read"], result: "Loaded", evidenceRefs: ["ev-b"], sourceStage: 3 },
    { id: "s", entry: "", steps: [], result: undefined, evidenceRefs: ["ev-a"] }
  ];
  const merged = mergePlanningRows(rows, "scenarios");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "source-confirmed");
  assert.equal(merged[0].entry, "Open");
  assert.deepEqual(merged[0].steps, ["Read"]);
  assert.equal(merged[0].result, "Loaded");
  assert.deepEqual(merged[0].evidenceRefs, ["ev-a", "ev-b"]);
  assert.deepEqual(mergePlanningRows([...merged, ...merged], "scenarios"), merged);
});
test("mergeRows unions aliases of same-id rows", () => {
  const {mergeRows}=require("../src/planning_contract");
  const merged = mergeRows([{ id: "ev-1", aliases: ["check-a"] }, { id: "ev-1", aliases: ["ev-1", "query-a"] }])[0];
  assert.deepEqual(merged.aliases, ["check-a", "ev-1", "query-a"]);
  const distinct = mergeRows([{ id: "a", aliases: ["x"] }, { id: "b", aliases: ["x"] }]);
  assert.deepEqual(distinct.map(row => row.aliases), [["x"], ["x"]]);
});
