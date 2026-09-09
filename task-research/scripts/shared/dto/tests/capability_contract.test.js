"use strict";
const assert=require("node:assert/strict"),test=require("node:test");const {normalizeCapabilities}=require("../src/capability_contract");
test("capability contract preserves confirmed evidence and requires the full absence protocol",()=>{const absence={id:"input",status:"checked-no-usage",expectedNames:["expected"],reason:"peer API expected",repository:"source",searchScope:"src",performedChecks:["text"],ordersChecked:["N/A"],linkingMethodsChecked:["N/A"],resultComplete:true,resultTruncated:false,consequence:"path absent",evidenceRefs:["ev-absence"]};const items=normalizeCapabilities([{id:"ownership",status:"confirmed",evidenceRefs:["stage:anchor"]},absence]);assert.equal(items.length,2);assert.throws(()=>normalizeCapabilities([{id:"render-output",status:"confirmed"}]));assert.throws(()=>normalizeCapabilities([{...absence,performedChecks:[]}]),/complete absence protocol/);});
test("capability intermediate status stays conservative and preserves its origin",()=>{
 const values=normalizeCapabilities([{id:"reference",status:"source-confirmed",evidenceRefs:["ev"]},{id:"tests",status:"candidate",requiredForFinalReport:false},{id:"mutation",status:"matched",requiredForFinalReport:false}]);
 assert.equal(values[0].status,"confirmed");assert.equal(values[0].originalStatus,"source-confirmed");assert.equal(values[1].status,"candidate");assert.equal(values[2].status,"candidate");
 assert.throws(()=>normalizeCapabilities([{id:"tests",status:"invented"}]),/Unsupported.*status/);
});
