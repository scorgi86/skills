"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), os=require("node:os"), path=require("node:path");
const {createCanonicalStageResult}=require("../../../shared/artifacts/src/canonical/result.js");
const {deriveStage3Search}=require("../src/derive_stage3_search.js");

test("Stage 3 scopes come only from declared consumer repositories and static profiles",t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"derive-stage3-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const producer=path.join(root,"p"),consumer=path.join(root,"c"); fs.mkdirSync(producer); fs.mkdirSync(consumer);
  const scope={repositories:[{id:"p",root:producer,role:"producer"},{id:"c",root:consumer,role:"consumer"}]};
  const stage2=createCanonicalStageResult({facts:{stage:2,status:"closed",repositoryScope:scope,summary:{boundaryDiscovery:{status:"exhausted"}}},input:{stage:2}});
  assert.deepEqual(deriveStage3Search(stage2,scope,[{id:"c",extensions:[".js"],maxMatches:7}]),{consumerScopes:[{id:"c",scope:consumer,extensions:[".js"],maxMatches:7}]});
  assert.throws(()=>deriveStage3Search(stage2,scope,[{id:"p",extensions:[".js"]}]),/non-consumer/);
  assert.throws(()=>deriveStage3Search(stage2,scope,[{id:"c",arbitrary:true}]),/unsupported/);
});
