"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {writeStageArtifact}=require("../../../shared/artifacts/src/stage_artifact_v4.js");

function fixture(t,{stale=false,exhausted=false,extraConsumer=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"derive-stage5-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const consumer=path.join(root,"consumer"),file=path.join(consumer,"view.js"); fs.mkdirSync(consumer); fs.writeFileSync(file,"A.B();\nA+B;\n");
  const other=path.join(root,"other"); if(extraConsumer)fs.mkdirSync(other);
  const scope={repositories:[{id:"consumer",root:consumer,role:"consumer"},...(extraConsumer?[{id:"other",root:other,role:"consumer"}]:[])]},hash=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),consumerRepos=["consumer",...(extraConsumer?["other"]:[])];
  const stage2=writeStageArtifact({outputDir:path.join(root,"stage-2"),facts:{stage:2,status:"closed",repositoryScope:scope,boundaries:[{id:"boundary-a",symbol:"A.B",searchTerms:["A.B","A+B"],consumerRepos}]},factsPrepared:true,input:{stage:2}});
  const profiles=consumerRepos.map(consumerRepo=>({boundaryId:"boundary-a",consumerRepo,searchProfile:{extensions:[".js"],maxFiles:9,maxMatches:7,followSymlinks:false,excludeDirs:["vendor"],excludeFilePatterns:[]}}));
  const stage3=writeStageArtifact({outputDir:path.join(root,"stage-3"),facts:{stage:3,status:"closed",repositoryScope:scope,summary:{consumerCoverage:profiles},canonicalEvidence:[]},factsPrepared:true,input:{stage:3}});
  const evidence={id:"ev-a",repository:"consumer",file,range:{startLine:1,startColumn:1,endLine:1,endColumn:6},usageKind:"source-text",rank:60,matchedTerms:[],provenance:["source-evidence:boundary-a@consumer"],aliases:["ev-a"],excerpt:"A.B();",sourceFragment:"A.B();",sourceHash:hash,confirmation:{status:"candidate",evidenceRefs:[],sourceHash:null}};
  const facts={stage:4,status:"closed",repositoryScope:scope,summary:{recipientDiscovery:{status:exhausted?"exhausted":"complete",reasons:[],families:exhausted?0:1},lineage:[{stage:2,artifact:stage2.resultFile,outputDigest:stage2.canonical.outputDigest},{stage:3,artifact:stage3.resultFile,outputDigest:stage3.canonical.outputDigest}]},recipientFamilies:exhausted?[]:[{id:"family-a",receiver:"view.js",consumerRepo:"consumer",boundaryRefs:["boundary-a"],evidenceRefs:["ev-a"],status:"candidate"}],canonicalEvidence:exhausted?[]:[evidence]};
  const stage4=writeStageArtifact({outputDir:path.join(root,"stage-4"),facts,factsPrepared:true,input:{stage:4}});
  if(stale)fs.appendFileSync(file,"changed\n");
  return {scope,stage4:stage4.canonical,artifact:stage4.resultFile,file};
}

test("derives literal case-sensitive checks and repository coverage deterministically",t=>{
  const value=fixture(t),{deriveStage5Search}=require("../src/derive_stage5_search.js");
  const result=deriveStage5Search(value.stage4,value.artifact,value.scope);
  assert.equal(result.pathDiscovery.status,"complete"); assert.equal(result.checks.length,2); assert.equal(result.structuralChecks.length,2); assert.equal(result.nameCoverages.length,1);
  assert.equal(result.structuralChecks.every(row=>row.file===value.file&&row.sourceHash.length===64),true);
  assert.deepEqual(result.checks.map(x=>x.patterns[0]),[{id:"A+B",value:"A+B",caseSensitive:true},{id:"A.B",value:"A.B",caseSensitive:true}]);
  assert.deepEqual(result.nameCoverages[0].terms,["A+B","A.B"]); assert.deepEqual(result,deriveStage5Search(value.stage4,value.artifact,value.scope));
});

test("derives full profiles and coverage for consumer repositories without families",t=>{
  const value=fixture(t,{extraConsumer:true}),{deriveStage5Search}=require("../src/derive_stage5_search.js"),result=deriveStage5Search(value.stage4,value.artifact,value.scope);
  assert.deepEqual(result.nameCoverages.map(row=>row.consumerRepo).sort(),["consumer","other"]);
  assert.equal(result.nameCoverages[0].searchProfile.maxMatches,7);
});

test("incomplete legacy Stage 3 profiles stay partial",t=>{
  const value=fixture(t),stage3Path=value.stage4.summary.lineage.find(row=>row.stage===3).artifact,stage3=JSON.parse(fs.readFileSync(stage3Path));
  delete stage3.summary.consumerCoverage[0].searchProfile.maxFiles; stage3.outputDigest=require("../../../shared/artifacts/src/canonical/validation.js").digest({...stage3,outputDigest:undefined}); fs.writeFileSync(stage3Path,JSON.stringify(stage3));
  const {deriveStage5Search}=require("../src/derive_stage5_search.js"); assert.equal(deriveStage5Search(value.stage4,value.artifact,value.scope).pathDiscovery.status,"partial");
});

test("tampered lineage digest stays partial",t=>{
  const value=fixture(t),descriptor=value.stage4.summary.lineage.find(row=>row.stage===3),stage3=JSON.parse(fs.readFileSync(descriptor.artifact));
  stage3.summary.consumerCoverage[0].searchProfile.maxFiles=10; stage3.outputDigest=require("../../../shared/artifacts/src/canonical/validation.js").digest({...stage3,outputDigest:undefined}); fs.writeFileSync(descriptor.artifact,JSON.stringify(stage3));
  const {deriveStage5Search}=require("../src/derive_stage5_search.js"); assert.equal(deriveStage5Search(value.stage4,value.artifact,value.scope).pathDiscovery.status,"partial");
});

test("stale locators stay partial and canonical exhaustion produces no search",t=>{
  const {deriveStage5Search}=require("../src/derive_stage5_search.js"),stale=fixture(t,{stale:true}),empty=fixture(t,{exhausted:true});
  assert.equal(deriveStage5Search(stale.stage4,stale.artifact,stale.scope).pathDiscovery.status,"partial");
  assert.deepEqual(deriveStage5Search(empty.stage4,empty.artifact,empty.scope),{checks:[],nameCoverages:[],pathCandidates:[],pathDiscovery:{status:"exhausted",reasons:[],families:0}});
});

test("full_run materializes automatic Stage 5 and rejects manual mixing",t=>{
  const value=fixture(t),{materializeStageRequest}=require("../src/full_run.js"),state={currentStage:5,lastCompletedStage:4,canonicalArtifact:value.artifact};
  const pkg={target:null,repositoryScope:value.scope,stages:{"5":{searchFromStage4:true}}};
  assert.equal(materializeStageRequest(pkg,5,state).checks.length,2);assert.equal(materializeStageRequest(pkg,5,state).structuralChecks.length,2);
  assert.throws(()=>materializeStageRequest({...pkg,stages:{"5":{searchFromStage4:true,criticalPaths:[]}}},5,state),/conflicts/);
});
