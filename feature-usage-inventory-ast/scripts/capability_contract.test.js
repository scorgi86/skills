"use strict";
const assert=require("node:assert/strict"),test=require("node:test");const {normalizeCapabilities}=require("./capability_contract");
test("capability contract preserves generic confirmed and checked-absence evidence",()=>{const items=normalizeCapabilities([{id:"ownership",status:"confirmed",evidenceRefs:["stage:anchor"]},{id:"input",status:"checked-no-usage",expectedNames:["expected"],checkedScope:"source"}]);assert.equal(items.length,2);assert.throws(()=>normalizeCapabilities([{id:"render-output",status:"confirmed"}]));});
