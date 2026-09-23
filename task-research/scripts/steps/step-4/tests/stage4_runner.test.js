"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runStage4 } = require("../src/runner.js");
const { writeCanonicalTransition } = require("../../../shared/dto/tests/test_helpers.js");

test("automatic Stage 4 reuses candidate families without running source search",t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"stage4-auto-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const family={id:"file-family",receiver:"view.js",relation:"contains exact boundary usage",status:"candidate",boundaryRefs:["b"],evidenceRefs:["ev"],absenceClaim:false,observationCount:1};
  const result=runStage4({stage:4,transitionArtifact:writeCanonicalTransition(root,3),searchFromStage3:true,recipientFamilyCandidates:[family],recipientDiscovery:{status:"complete",reasons:[],families:1}},{runEvidenceChecks(){throw new Error("must not run");}});
  assert.equal(result.status,"candidate"); assert.deepEqual(result.recipientFamilies,[family]); assert.equal(result.summary.recipientDiscovery.status,"complete");
});

test("automatic Stage 4 persists partial and exhausted decisions",t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"stage4-auto-status-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true})); const transitionArtifact=writeCanonicalTransition(root,3);
  assert.equal(runStage4({stage:4,transitionArtifact,searchFromStage3:true,recipientFamilyCandidates:[],recipientDiscovery:{status:"partial",reasons:["stale"],families:0}}).status,"partial");
  const exhausted=runStage4({stage:4,transitionArtifact,searchFromStage3:true,recipientFamilyCandidates:[],recipientDiscovery:{status:"exhausted",reasons:[],families:0}});
  assert.equal(exhausted.status,"candidate"); assert.deepEqual(exhausted.recipientFamilies,[]);
});

for (const [authored, complete, matched, expected] of [
  ["confirmed", true, 1, "confirmed"],
  ["source-confirmed", true, 1, "source-confirmed"],
  ["confirmed", false, 1, "confirmed"],
  [undefined, true, 1, "candidate"],
  [undefined, true, 0, "candidate-empty"],
  [undefined, false, 1, "partial"]
]) test(`family status ${authored || "unauthored"}, complete=${complete}, matches=${matched}`, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = { stage: 4, transitionArtifact: writeCanonicalTransition(root, 3),
    recipientFamilies: [{ id: "receiver", receiver: "Container", relation: "receives mutation", status: authored,
      metadata: { sourceConfirmedMutation: true }, checks: [{ id: "mutation", file: "fixture.js", pattern: "setValue" }] }] };
  const result = runStage4(request, { runEvidenceChecks: ({ checks }) => ({ checks: checks.map(check => ({
    id: check.id, spec: check, resultComplete: complete, totalMatches: matched, fullMatches: matched ? [{}] : []
  })) }) });
  assert.equal(result.recipientFamilies[0].status, expected);
  assert.equal(result.status, complete ? "candidate" : "partial");
  assert.equal(result.recipientFamilies[0].absenceClaim, false);
});
