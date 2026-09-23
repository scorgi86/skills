"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { discoverBoundaries } = require("../src/boundary_discovery.js");

const occurrence = (file, value, hash="hash") => ({ value, kind:"identifier", file, sourceHash:hash, confidence:"exact", range:{start:{line:1,column:1,offset:0},end:{line:1,column:2,offset:1}}, evidence:[] });
const snapshots = { get: file => ({ sourceHash:"hash", lines:[file] }) };
test("pairs only the same exact term across producer and consumer", () => {
  const ast={status:"candidate",stats:{failed:0},results:[
    {id:"stage0-boundary-p",details:[occurrence("p.js","Inner")],coverage:{}},
    {id:"stage0-boundary-c",details:[occurrence("c.js","Inner"),occurrence("c.js","inner")],coverage:{}}
  ]};
  const result=discoverBoundaries(ast,{terms:["Inner"],roles:{producerRepos:["p"],consumerRepos:["c"]}},snapshots);
  assert.equal(result.status,"complete"); assert.equal(result.boundaries.length,1); assert.deepEqual(result.boundaries[0].searchTerms,["Inner"]);
});
test("reports exhausted for a complete similar-only scan and partial for missing roles",()=>{
  const ast={status:"candidate",stats:{failed:0},results:[{id:"stage0-boundary-p",details:[occurrence("p.js","Inner")],coverage:{}},{id:"stage0-boundary-c",details:[occurrence("c.js","InnerMore")],coverage:{}}]};
  assert.equal(discoverBoundaries(ast,{terms:["Inner"],roles:{producerRepos:["p"],consumerRepos:["c"]}},snapshots).status,"exhausted");
  assert.equal(discoverBoundaries(ast,{terms:["Inner"],roles:{producerRepos:["p"],consumerRepos:[]}},snapshots).status,"partial");
});
