"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {matchStructuralUse}=require("../src/structural_match.js");
const range=(start,end)=>({start:{offset:start,line:1,column:start+1},end:{offset:end,line:1,column:end+1}});
const occurrence=(value,start)=>({value,kind:"property",file:"x.js",range:range(start,start+value.length),sourceHash:"hash",confidence:"exact"});
const relation=(participant,overrides={})=>({relation:"call",dynamic:false,analysisSourceHash:"hash",evidence:[{confidence:"exact",file:"x.js",range:range(0,30)}],participants:[participant],...overrides});

test("matcher accepts one exact structural operand",()=>{const item=occurrence("apply",5),result=matchStructuralUse({term:"apply",file:"x.js",sourceHash:"hash"},[item],[relation({role:"callee",...item})]);assert.equal(result.status,"source-confirmed");});
test("matcher rejects containment-only text and unsupported roles",()=>{const item=occurrence("apply",5);assert.equal(matchStructuralUse({term:"apply",file:"x.js",sourceHash:"hash"},[item],[relation({role:"source-value",...item})]).reason,"unsupported-relation");assert.equal(matchStructuralUse({term:"apply",file:"x.js",sourceHash:"hash"},[item],[relation({role:"callee",...occurrence("other",20)})]).reason,"non-structural-occurrence");});
test("matcher fails closed for ambiguity, stale source, and local-instance",()=>{const item=occurrence("apply",5),row=relation({role:"callee",...item});assert.equal(matchStructuralUse({term:"apply",file:"x.js",sourceHash:"hash"},[item],[row,{...row,ownerQualifiedName:"Other"}]).reason,"ast-ambiguous");assert.equal(matchStructuralUse({term:"apply",file:"x.js",sourceHash:"new"},[item],[row]).reason,"stale-source");assert.equal(matchStructuralUse({term:"apply",file:"x.js",sourceHash:"hash"},[item],[{...row,relation:"local-instance"}]).reason,"unsupported-relation");});
test("matcher rejects a participant from another source snapshot",()=>{const item=occurrence("apply",5),row=relation({role:"callee",...item,sourceHash:"wrong"});assert.deepEqual(matchStructuralUse({term:"apply",file:"x.js",sourceHash:"hash"},[item],[row]),{status:"unresolved",reason:"stale-source"});});
