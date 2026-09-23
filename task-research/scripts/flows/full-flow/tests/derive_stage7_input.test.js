"use strict";
const assert=require("node:assert/strict"),crypto=require("node:crypto"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),test=require("node:test");
const {writeStageArtifact}=require("../../../shared/artifacts/src/stage_artifact_v4.js");
const {buildLineageFromPrevious}=require("../../../shared/artifacts/src/canonical/lineage.js");
const {deriveStage7Input}=require("../src/derive_stage7_input.js");

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"derive-stage7-")),source=path.join(root,"source.js"),scope={repositories:[{id:"repo",root,role:"source"}]}; fs.writeFileSync(source,"const A = 1;\n");
  const hash=crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"),files=[];
  for(let stage=0;stage<=6;stage++){
    const facts={stage,target:"Feature",status:"closed",repositoryScope:scope,summary:{lineage:stage?buildLineageFromPrevious(files.at(-1),stage,scope):[]}};
    if(stage===1||stage===4)facts.canonicalEvidence=[{id:"ev-early",status:"source-confirmed",repository:"repo",file:"source.js",line:1,endLine:1,sourceFragment:"const A = 1;",sourceHash:hash}];
    if(stage===4)facts.canonicalFacts=[{kind:"critical-path",id:"path-a",status:"candidate",evidenceRefs:["ev-early"]}];
    files.push(writeStageArtifact({outputDir:path.join(root,`stage-${stage}`),facts,input:{stage}}).resultFile);
  }
  return {root,scope,files,stage6:JSON.parse(fs.readFileSync(files[6],"utf8"))};
}

test("derives exact cross-stage evidence selectors from closed lineage",()=>{const f=fixture();try{const value=deriveStage7Input(f.stage6,f.files,f.scope,"Feature"),ref=JSON.parse(fs.readFileSync(f.files[4],"utf8")).facts.find(row=>row.kind==="critical-path").evidenceRefs[0];assert.equal(value.status,"complete",JSON.stringify(value));assert.deepEqual(value.evidenceSelectors,[{artifact:f.files[1],ids:[ref]}]);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});
test("rejects stale lineage descriptors and missing evidence before Stage 7",()=>{const f=fixture();try{const stale=structuredClone(f.stage6);stale.summary.lineage[0].outputDigest="0".repeat(64);assert.equal(deriveStage7Input(stale,f.files,f.scope,"Feature").status,"partial");for(const stage of [1,4])fs.writeFileSync(path.join(f.root,`stage-${stage}`,"canonical","evidence.json"),JSON.stringify({schemaVersion:"canonical-evidence/4.0.0",stage,files:[],evidence:[]}));assert.equal(deriveStage7Input(f.stage6,f.files,f.scope,"Feature").status,"partial");}finally{fs.rmSync(f.root,{recursive:true,force:true});}});
test("rejects conflicting copies of one evidence identity",()=>{const f=fixture();try{const file=path.join(f.root,"stage-4","canonical","evidence.json"),value=JSON.parse(fs.readFileSync(file,"utf8"));value.evidence[0].sourceFragment="different";fs.writeFileSync(file,JSON.stringify(value));const result=deriveStage7Input(f.stage6,f.files,f.scope,"Feature");assert.equal(result.status,"partial");assert.match(result.reasons.join("\n"),/Ambiguous evidence/);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});
test("accepts candidate to source-confirmed evidence strengthening",()=>{const f=fixture();try{const file=path.join(f.root,"stage-1","canonical","evidence.json"),value=JSON.parse(fs.readFileSync(file,"utf8"));delete value.evidence[0].status;value.evidence[0].confirmation={status:"candidate",evidenceRefs:[],sourceHash:null};fs.writeFileSync(file,JSON.stringify(value));const result=deriveStage7Input(f.stage6,f.files,f.scope,"Feature");assert.equal(result.status,"complete",JSON.stringify(result));assert.deepEqual(result.evidenceSelectors,[{artifact:f.files[4],ids:[JSON.parse(fs.readFileSync(f.files[4],"utf8")).facts.find(row=>row.kind==="critical-path").evidenceRefs[0]]}]);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});
test("automatic selector order is deterministic",()=>{const f=fixture();try{const first=deriveStage7Input(f.stage6,f.files,f.scope,"Feature"),stage4=path.join(f.root,"stage-4","canonical","evidence.json"),value=JSON.parse(fs.readFileSync(stage4,"utf8"));value.evidence.reverse();fs.writeFileSync(stage4,JSON.stringify(value));assert.deepEqual(deriveStage7Input(f.stage6,f.files,f.scope,"Feature"),first);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});
