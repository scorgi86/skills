"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {writeStageArtifact}=require("../../../shared/artifacts/src/stage_artifact_v4.js");

function fixture(t,{coverage=true,truncated=false,flow=false}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"derive-stage4-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const consumer=path.join(root,"consumer"), file=path.join(consumer,"view.js"); fs.mkdirSync(consumer); fs.writeFileSync(file,"useInnerShadow();\n");
  const scope={repositories:[{id:"consumer",root:consumer,role:"consumer"}]}, checkId="boundary-a@consumer";
  const facts={stage:3,status:"closed",repositoryScope:scope,summary:{boundaryStatus:"searched",consumerCoverage:[{boundaryId:"boundary-a",consumerRepo:"consumer",checkId,status:"candidate",resultComplete:coverage,truncated,errors:[],totalMatches:1,...(flow?{obligationRefs:["flow-parent"]}:{})}]},boundaries:[{id:"boundary-a",kind:"paired-source-term",symbol:"innerShadow",consumerRepos:["consumer"]}],canonicalEvidence:[{id:"ev-a",repository:"consumer",file,range:{startLine:1,startColumn:1,endLine:1,endColumn:17},usageKind:"source-text",rank:60,matchedTerms:["innerShadow"],provenance:[`source-evidence:${checkId}`],aliases:["ev-a"],excerpt:"useInnerShadow();",sourceHash:crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),confirmation:{status:"candidate",evidenceRefs:[],sourceHash:null}}],...(flow?{pathObligations:[{id:"flow-parent",edgeRefs:["edge-a"],frontier:"Fork",status:"open"},{id:"existing-child",parentObligationRef:"flow-parent",edgeRefs:["edge-a","edge-b"],frontier:"Other",status:"open"}],valueFlowEdges:[{id:"edge-a",relation:"return",from:"A",to:"Fork",status:"source-confirmed"},{id:"edge-b",relation:"argument",from:"Fork",to:"Other",status:"source-confirmed"}]}:{})};
  const written=writeStageArtifact({outputDir:path.join(root,"stage-3"),facts,factsPrepared:true,input:{stage:3}});
  return {root,scope,file,stage3:written.canonical,artifact:written.resultFile};
}

test("derives deterministic file-level candidate families from exact Stage 3 evidence",t=>{
  const value=fixture(t); const {deriveStage4Search}=require("../src/derive_stage4_search.js");
  const result=deriveStage4Search(value.stage3,value.artifact,value.scope);
  assert.equal(result.recipientDiscovery.status,"complete"); assert.equal(result.recipientFamilyCandidates.length,1);
  const family=result.recipientFamilyCandidates[0];
  assert.equal(family.receiver,"view.js"); assert.equal(family.relation,"contains exact boundary usage"); assert.equal(family.status,"candidate");
  assert.deepEqual(family.boundaryRefs,["boundary-a"]); assert.deepEqual(family.evidenceRefs,["ev-a"]); assert.equal(family.absenceClaim,false);
  assert.deepEqual(result,deriveStage4Search(value.stage3,value.artifact,value.scope));
});

test("a receiver reached from an existing non-leaf gets its own terminal obligation",t=>{
  const value=fixture(t,{flow:true}),{deriveStage4Search}=require("../src/derive_stage4_search.js");
  const result=deriveStage4Search(value.stage3,value.artifact,value.scope),family=result.recipientFamilyCandidates[0],child=result.pathObligations.find(row=>row.id===family.obligationRefs[0]);
  assert.notEqual(family.obligationRefs[0],"flow-parent"); assert.equal(child.parentObligationRef,"flow-parent"); assert.equal(child.frontier,"view.js");
});

test("incomplete coverage and stale evidence stay partial; canonical exhaustion stays empty",t=>{
  const {deriveStage4Search}=require("../src/derive_stage4_search.js");
  const incomplete=fixture(t,{coverage:false}); assert.equal(deriveStage4Search(incomplete.stage3,incomplete.artifact,incomplete.scope).recipientDiscovery.status,"partial");
  const stale=fixture(t); fs.appendFileSync(stale.file,"changed\n"); assert.equal(deriveStage4Search(stale.stage3,stale.artifact,stale.scope).recipientDiscovery.status,"partial");
  const exhausted=fixture(t); exhausted.stage3.summary.boundaryStatus="exhausted"; exhausted.stage3.summary.consumerCoverage=[]; exhausted.stage3.facts=[];
  exhausted.stage3.outputDigest=require("../../../shared/artifacts/src/canonical/validation.js").digest({...exhausted.stage3,outputDigest:undefined});
  assert.deepEqual(deriveStage4Search(exhausted.stage3,exhausted.artifact,exhausted.scope).recipientFamilyCandidates,[]);
  assert.equal(deriveStage4Search(exhausted.stage3,exhausted.artifact,exhausted.scope).recipientDiscovery.status,"exhausted");
});

test("full_run materializes automatic Stage 4 and rejects manual mixing",t=>{
  const value=fixture(t), {materializeStageRequest}=require("../src/full_run.js");
  const state={currentStage:4,lastCompletedStage:3,canonicalArtifact:value.artifact};
  const pkg={target:null,repositoryScope:value.scope,stages:{"4":{searchFromStage3:true}}};
  const request=materializeStageRequest(pkg,4,state);
  assert.equal(request.recipientDiscovery.status,"complete"); assert.equal(request.recipientFamilyCandidates.length,1);
  assert.throws(()=>materializeStageRequest({...pkg,stages:{"4":{searchFromStage3:true,recipientFamilies:[]}}},4,state),/conflicts/);
});
