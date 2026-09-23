"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { decideStage2 } = require("../src/coverage_gate.js");
const { runStage2 } = require("../src/runner.js");
const { advanceOwnershipGraph, confirmedOwnershipDelta } = require("../src/runner.js");
const { discoverOwnerCandidates } = require("../../step-1/src/owner_discovery.js");
const { SourceSnapshotStore } = require("../../../shared/evidence/src/source_snapshot.js");

const graph = () => ({ schemaVersion: "1.0.0", maxOrder: 2, nodes: [
  { id: "seed", entity: "Seed", role: "seed", status: "confirmed", order: 0, evidenceRefs: [], anchors: [] },
  { id: "frontier", entity: "Frontier", role: "owner", status: "confirmed", order: 1, evidenceRefs: [], anchors: [] }
], edges: [{ id: "edge", from: "frontier", to: "seed", relation: "stores", propertyOrMethod: "value", status: "confirmed", evidenceRefs: [], anchors: [] }], frontier: [], cycles: [] });

test("Stage2 decision matrix distinguishes exhausted, advanced, partial and blocked", () => {
  assert.equal(decideStage2({ ownershipGraph: graph(), runtime: { frontierExhausted: true } }).frontierStatus, "exhausted");
  assert.equal(decideStage2({ ownershipGraph: graph(), runtime: { ownershipFrontier: [{ repository: "repo", entity: "Frontier" }] }, ownership: { groups: [{ id: "x", status: "confirmed" }] }, ownerDiscovery: { generatedIds: ["x"], unresolved: [], exhaustedSeeds: [], advancedSeeds: [{ repository: "repo", seed: "Frontier" }] } }).frontierStatus, "advanced");
  assert.equal(decideStage2({ ownershipGraph: graph(), runtime: { ownershipFrontier: [{}] }, ownership: { groups: [] }, ownerDiscovery: { generatedIds: [], unresolved: [{ reason: "truncated" }], exhaustedSeeds: [] } }).status, "partial");
  assert.equal(decideStage2({ ownershipGraph: graph(), runtime: { ownershipFrontier: [{ repository: "repo", entity: "A" }, { repository: "repo", entity: "B" }] }, ownership: { groups: [] }, ownerDiscovery: { generatedIds: [], unresolved: [], exhaustedSeeds: [{ repository: "repo", seed: "A" }], advancedSeeds: [] } }).status, "partial");
  assert.equal(decideStage2({ ownershipGraph: { nodes: [], edges: [] }, runtime: {} }).status, "blocked");
});

test("Stage2 delta starts at the prior node and stops at maxOrder", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-delta-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js"); fs.writeFileSync(file, "one\ntwo\nthree\n");
  const step = (level, owner, line) => ({ level, owner, field: "value", relation: "field-write", ownerConfidence: "exact", evidence: [{ file, range: { start: { line }, end: { line } }, confidence: "exact" }] });
  const ast = { ownerChains: [{ repository: "repo", seed: "Frontier", chains: [{ status: "leaf", chain: [{ level: 0 }, step(1, "Next", 1), step(2, "TooFar", 2)] }] }], plan: { uniqueFiles: [file] }, stats: {} };
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] }, ownershipFrontier: [{ nodeId: "frontier", entity: "Frontier", repository: "repo", order: 1 }], ownershipGraphMaxOrder: 2, ownerDiscovery: { mode: "delta" } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.equal(result.graph, null);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].entity, "Next");
  assert.equal(result.nodes[0].order, 2);
  assert.equal(result.edges[0].to, "frontier");
  assert.ok(result.nodes.every(node => node.order <= 2));
  assert.deepEqual(result.limitReachedSeeds, ["Frontier"]);
  assert.deepEqual(result.advancedSeeds, [{ repository: "repo", seed: "Frontier" }]);
});

test("ownership exhaustion still runs the boundary scan and closes when it is exhausted", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-exhausted-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = require("../../../shared/dto/tests/test_helpers.js").writeCanonicalTransition(root, 1);
  let astRuns = 0;
  const facts = await runStage2({ stage: 2, transitionArtifact: previous, searchFromStage1: true, frontierExhausted: true, ownershipGraph: graph(), ownershipGraphMaxOrder: 2,
    boundaryDiscovery: { terms: ["Seed"], roles: { producerRepos: ["producer"], consumerRepos: ["consumer"] } }, ast: { queries: [{}] }, evidence: { checks: [] } }, {
    runAstBatch() { astRuns += 1; return { status: "candidate", results: ["producer", "consumer"].map(id => ({ id: `stage0-boundary-${id}`, details: [], coverage: {} })), ownerChains: [], stats: { failed: 0, parseCounts: {} }, plan: { compiledBeforeParse: true, lateQueries: 0, uniqueFiles: [] } }; },
    runEvidenceChecks() { return { checks: [] }; }
  });
  assert.equal(astRuns, 1);
  assert.equal(facts.status, "candidate");
  assert.equal(facts.summary.frontierStatus, "exhausted");
  assert.equal(facts.quality.coverageGate.ok, true);
  assert.equal(facts.summary.boundaryDiscovery.status, "exhausted");
});

test("complete automatic boundary discovery emits confirmed dictionary facts",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"stage2-dictionary-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const producer=path.join(root,"producer.js"),consumer=path.join(root,"consumer.js");fs.writeFileSync(producer,"const Inner = 1;\n");fs.writeFileSync(consumer,"use(Inner);\n");
  const scope={repositories:[{id:"producer",root,role:"producer"},{id:"consumer",root,role:"consumer"}]},previous=require("../../../shared/dto/tests/test_helpers.js").writeCanonicalTransition(root,1,{facts:{repositoryScope:scope}}),hash=file=>require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const occurrence=(file,sourceHash)=>({value:"Inner",file,sourceHash,confidence:"exact",range:{start:{line:1,column:7,offset:6},end:{line:1,column:12,offset:11}}});
  const facts=await runStage2({stage:2,transitionArtifact:previous,repositoryScope:scope,searchFromStage1:true,frontierExhausted:true,ownershipGraph:graph(),ownershipGraphMaxOrder:2,boundaryDiscovery:{terms:["Inner"],roles:{producerRepos:["producer"],consumerRepos:["consumer"]}},ast:{queries:[{}]},evidence:{checks:[]}},{runAstBatch(){return {status:"candidate",results:[{id:"stage0-boundary-producer",details:[occurrence(producer,hash(producer))],coverage:{}},{id:"stage0-boundary-consumer",details:[occurrence(consumer,hash(consumer))],coverage:{}}],ownerChains:[],stats:{failed:0,parseCounts:{}},plan:{compiledBeforeParse:true,lateQueries:0,uniqueFiles:[]}};},runEvidenceChecks(){return {checks:[]};}});
  assert.equal(facts.quality.coverageGate.ok,true);assert.equal(facts.dictionary.length,1);assert.equal(facts.dictionary[0].status,"confirmed");assert.deepEqual(facts.dictionary[0].consumerRepos,["consumer"]);
  assert.ok(facts.dictionary[0].evidenceRefs.length>0);assert.ok(facts.dictionary[0].evidenceRefs.every(ref=>!ref.startsWith("boundary-")));
});

test("Stage2 merge preserves prior node order and excludes candidate delta", () => {
  const prior = graph();
  const merged = advanceOwnershipGraph(prior, {
    ownershipGraphMaxOrder: 2,
    ownershipGraphNodes: [{ id: "seed", entity: "Seed", order: 2 }, { id: "candidate", entity: "Candidate", order: 2 }],
    ownershipGraphCandidates: []
  });
  assert.equal(merged.nodes.find(node => node.id === "seed").order, 0);
  assert.equal(merged.nodes.some(node => node.id === "candidate"), true);
  const delta = confirmedOwnershipDelta({ nodes: [{ id: "confirmed" }, { id: "candidate" }], edges: [
    { id: "yes", from: "confirmed", to: "frontier", status: "confirmed" },
    { id: "no", from: "candidate", to: "frontier", status: "candidate" }
  ] });
  assert.deepEqual(delta.edges.map(edge => edge.id), ["yes"]);
  assert.deepEqual(delta.nodes.map(node => node.id), ["confirmed"]);
});
