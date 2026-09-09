"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveChecks } = require("../../src/canonical/checks.js");
const { createCanonicalStageResult } = require("../../src/canonical/result.js");
const { digest, validateCanonicalStageResult } = require("../../src/canonical/validation.js");
const previous = () => createCanonicalStageResult({facts:{stage:2,status:"partial",openChecks:["verify owner"]}});
test("omission cannot erase persisted checks",()=>assert.deepEqual(resolveChecks(previous(),{openChecks:[]}).openChecks,["verify owner"]));
test("receipt binds origin and evidence; replay remains idempotent",()=>{
 const prior=previous(), receipt={kind:"check-resolution",check:"verify owner",originDigest:prior.outputDigest,disposition:"checked",reason:"source checked",evidenceRefs:["ev"]};
 const facts=resolveChecks(prior,{stage:2,status:"closed"},[receipt],[{id:"ev"}],{});
 assert.deepEqual(facts.openChecks,[]);
 const result=createCanonicalStageResult({facts});
 assert.deepEqual(result.facts,[receipt]);
 assert.equal(validateCanonicalStageResult(result).ok,true);
 assert.deepEqual(resolveChecks(result,{stage:2},[receipt],[{id:"ev"}],{}).openChecks,[]);
 assert.throws(()=>resolveChecks(prior,{},[{...receipt,originDigest:"a".repeat(64)}],[{id:"ev"}],{}),/origin/);
 assert.throws(()=>resolveChecks(prior,{},[receipt],[],{}),/evidence/);
});
test("same text reintroduced after resolution gets a fresh origin",()=>{
 const prior=previous(), receipt={kind:"check-resolution",check:"verify owner",originDigest:prior.outputDigest,disposition:"checked",reason:"checked",evidenceRefs:["ev"]};
 const closed=createCanonicalStageResult({facts:resolveChecks(prior,{stage:2,status:"closed"},[receipt],[{id:"ev"}],{})});
 const again=createCanonicalStageResult({facts:resolveChecks(closed,{stage:2,status:"partial",openChecks:[receipt.check]},[],[],{})});
 assert.deepEqual(resolveChecks(again,{},[receipt],[{id:"ev"}],{}).openChecks,[receipt.check]);
});
test("not applicable requires exact scope and justification",()=>{
 const scope={repositories:[{id:"a",exclusions:["owner/**"]}]}, prior=previous(), receipt={kind:"check-resolution",check:"verify owner",originDigest:prior.outputDigest,disposition:"not-applicable",reason:"outside scope",scopeDigest:digest(scope),scopeJustification:"owner subsystem excluded",repository:"a",exclusion:"owner/**"};
 assert.deepEqual(resolveChecks(prior,{},[receipt],[],scope).openChecks,[]);
 assert.throws(()=>resolveChecks(prior,{},[{...receipt,exclusion:"made-up"}],[],scope),/scope exclusion/);
 assert.throws(()=>resolveChecks(prior,{},[{...receipt,scopeDigest:digest({other:true})}],[],scope),/scope/);
});
test("closed canonical blockers are rejected",()=>assert.equal(validateCanonicalStageResult(createCanonicalStageResult({facts:{stage:3,status:"closed",openChecks:["pending"]}})).ok,false));
test("same text from independent origins needs both receipts",()=>{
 const prior=previous();prior.summary.checkOrigins=[{check:"verify owner",originDigest:"a".repeat(64)},{check:"verify owner",originDigest:"b".repeat(64)}];
 const receipt={kind:"check-resolution",check:"verify owner",originDigest:"a".repeat(64),disposition:"checked",reason:"checked",evidenceRefs:["ev"]};
 const next=resolveChecks(prior,{},[receipt],[{id:"ev"}],{});
 assert.deepEqual(next.openChecks,["verify owner"]);
 assert.equal(next.summary.checkOrigins[0].originDigest,"b".repeat(64));
});
test("receipts survive canonical file serialization and bounded fact query",()=>{
 const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
 const {writeStageArtifact,readCanonicalStageResult}=require("../../src/stage_artifact_v4.js");
 const {queryStageArtifacts}=require("../../src/query_stage_artifacts.js");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"receipt-query-"));
 try {
  const prior=previous(),receipt={kind:"check-resolution",check:"verify owner",originDigest:prior.outputDigest,disposition:"checked",reason:"reviewed evidence",evidenceRefs:["ev"]};
  const facts=resolveChecks(prior,{stage:3,status:"closed",canonicalEvidence:[{id:"ev",status:"candidate"}]},[receipt],[{id:"ev"}],{});
  const written=writeStageArtifact({outputDir:root,facts});
  assert.deepEqual(readCanonicalStageResult(written.resultFile).facts,[receipt]);
  assert.deepEqual(queryStageArtifacts({artifact:root,"fact-kind":"check-resolution",limit:10}).facts,[receipt]);
  const report=createCanonicalStageResult({facts:{stage:7,status:"closed",modelType:"inventory-report-model",provenance:{checkResolutions:[receipt]}}});
  assert.deepEqual(report.facts.find(row=>row.kind==="check-resolution"),receipt);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
