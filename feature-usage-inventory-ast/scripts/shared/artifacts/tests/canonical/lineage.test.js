"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), os=require("node:os"), path=require("node:path");
const {createCanonicalStageResult}=require("../../src/canonical/result.js");
const {validatePriorLineage,buildLineageFromPrevious}=require("../../src/canonical/lineage.js");
const {validateCheckHistory}=require("../../src/canonical/lineage.js");
const {resolveChecks}=require("../../src/canonical/checks.js");
test("lineage rejects each mismatched supplied descriptor field", () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"lineage-descriptor-")), scope={repositories:[{id:"a",root}]};
 try {
  const result=createCanonicalStageResult({facts:{stage:0,status:"closed",repositoryScope:scope}});
  const artifact=path.join(root,"0.json"); fs.writeFileSync(artifact,JSON.stringify(result));
  const descriptor=validatePriorLineage({stage:1,repositoryScope:scope,priorArtifacts:[artifact]}).lineage[0];
  for(const change of [{stage:5},{outputDigest:"a".repeat(64)},{scopeDigest:"b".repeat(64)}]) {
   assert.throws(()=>validatePriorLineage({stage:1,repositoryScope:scope,priorArtifacts:[{...descriptor,...change}]}),/descriptor/);
  }
  assert.equal(validatePriorLineage({stage:1,repositoryScope:scope,priorArtifacts:[descriptor]}).lineage.length,1);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("lineage validates full selected chain and rejects missing or changed ancestors",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"lineage-")), scope={repositories:[{id:"a",root}]}, files=[];
 try {
  for(let stage=0;stage<3;stage++){
   const lineage=stage?buildLineageFromPrevious(files.at(-1),stage,scope):[];
   const result=createCanonicalStageResult({facts:{stage,status:"closed",repositoryScope:scope,summary:{lineage}}});
   const file=path.join(root,`${stage}.json`);fs.writeFileSync(file,JSON.stringify(result));files.push(file);
  }
  assert.equal(validatePriorLineage({stage:3,repositoryScope:scope,priorArtifacts:files,expectedArtifact:files[2]}).lineage.length,3);
  assert.throws(()=>validatePriorLineage({stage:3,repositoryScope:scope,priorArtifacts:files.slice(1)}),/reissue/);
  const first=JSON.parse(fs.readFileSync(files[0]));first.summary.target="tamper";fs.writeFileSync(files[0],JSON.stringify(first));
  assert.throws(()=>buildLineageFromPrevious(files[2],3,scope),/digest|Digest/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("immutable partial history proves receipt origins and omitted questions fail",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"history-")), scope={repositories:[{id:"a",root}]};
 try{
  const partial=createCanonicalStageResult({facts:{stage:0,status:"partial",repositoryScope:scope,openChecks:["verify owner"]}}), file=path.join(root,"partial.json");fs.writeFileSync(file,JSON.stringify(partial));
  const history=[{artifact:file,outputDigest:partial.outputDigest}], receipt={kind:"check-resolution",check:"verify owner",originDigest:partial.outputDigest,disposition:"checked",reason:"checked source",evidenceRefs:["ev"]};
  const facts=resolveChecks(partial,{stage:0,status:"closed",repositoryScope:scope,summary:{checkHistory:history}},[receipt],[{id:"ev"}],scope);
  assert.equal(validateCheckHistory(createCanonicalStageResult({facts})).ok,true);
  assert.throws(()=>validateCheckHistory(createCanonicalStageResult({facts:{stage:0,status:"closed",repositoryScope:scope,summary:{checkHistory:history}}})),/disappeared/);
  assert.throws(()=>validateCheckHistory(createCanonicalStageResult({facts:{...facts,summary:{checkHistory:[]}}})),/historical question/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
