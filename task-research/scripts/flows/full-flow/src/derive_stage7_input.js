"use strict";
const path=require("node:path");
const {readCanonicalStageResult}=require("../../../shared/artifacts/src/stage_artifact_v4.js");
const {scopeDigest}=require("../../../shared/artifacts/src/canonical/checks.js");
const {normalizeRepositoryScope}=require("../../../shared/dto/src/repository_scope.js");
const {buildPlanningProjection,PLANNING_COLLECTIONS}=require("../../../shared/dto/src/planning_contract.js");
const {identityKey,matchesRef,readCanonicalEvidence}=require("../../../shared/artifacts/src/exact_evidence.js");
const unique=values=>[...new Set(values.filter(Boolean).map(String))].sort();
const lineagePair=(row,scope)=>`${identityKey(row,scope)}\0${row.sourceHash||""}\0${row.sourceFragment||""}`;
const confirmed=row=>row.status==="source-confirmed"||row.confirmation?.status==="source-confirmed";

function deriveStage7Input(stage6,priorArtifacts,repositoryScope,target){
  const reasons=[];
  try{
    if(!Array.isArray(priorArtifacts)||priorArtifacts.length!==7)throw new Error("Stage 7 automatic handoff requires artifacts 0..6");
    const scope=normalizeRepositoryScope(repositoryScope,{requireExisting:false}),scopeHash=scopeDigest(scope),rows=priorArtifacts.map((artifact,stage)=>({stage,artifact:path.resolve(artifact),result:readCanonicalStageResult(artifact)}));
    for(const row of rows){if(row.result.stage!==row.stage||row.result.status!=="closed")reasons.push(`Stage ${row.stage} is not the expected closed artifact`);if(scopeDigest(normalizeRepositoryScope(row.result.summary?.repositoryScope,{requireExisting:false}))!==scopeHash)reasons.push(`Stage ${row.stage} scope mismatch`);if(row.result.summary?.target!==target)reasons.push(`Stage ${row.stage} target mismatch`);}
    if(stage6.stage!==6||stage6.status!=="closed"||stage6.outputDigest!==rows[6].result.outputDigest)reasons.push("Active Stage 6 artifact mismatch");
    const descriptors=stage6.summary?.lineage||[];
    for(let stage=0;stage<6;stage++){const descriptor=descriptors.find(item=>Number(item.stage)===stage),row=rows[stage];if(!descriptor||path.resolve(descriptor.artifact)!==row.artifact||descriptor.outputDigest!==row.result.outputDigest)reasons.push(`Stage ${stage} lineage descriptor mismatch`);}
    if(reasons.length)return {status:"partial",reasons:unique(reasons),evidenceSelectors:[]};
    const planning=buildPlanningProjection(rows.map(row=>row.result)),capabilities=rows.flatMap(row=>row.result.facts.filter(fact=>fact.kind==="capability")),reportRows=[...capabilities,...PLANNING_COLLECTIONS.flatMap(name=>planning[name])],refs=unique(reportRows.flatMap(row=>row.evidenceRefs||[]));
    const evidence=rows.map(row=>({...row,evidence:readCanonicalEvidence(row.artifact)})),owners=new Map();
    for(const ref of refs){const matches=evidence.flatMap(owner=>owner.evidence.filter(row=>matchesRef(row,ref)).map(row=>({owner,row,pair:lineagePair(row,scope)})));if(!matches.length){reasons.push(`Missing evidence: ${ref}`);continue;}if(new Set(matches.map(item=>item.pair)).size!==1){reasons.push(`Ambiguous evidence: ${ref}`);continue;}owners.set(ref,matches.sort((a,b)=>Number(confirmed(b.row))-Number(confirmed(a.row))||a.owner.stage-b.owner.stage||a.owner.artifact.localeCompare(b.owner.artifact))[0].owner);}
    if(reasons.length)return {status:"partial",reasons:unique(reasons),evidenceSelectors:[]};
    const grouped=new Map();for(const [ref,owner] of owners)grouped.set(owner.artifact,unique([...(grouped.get(owner.artifact)||[]),ref]));
    return {status:"complete",reasons:[],evidenceSelectors:[...grouped].map(([artifact,ids])=>({artifact,ids})).sort((a,b)=>a.artifact.localeCompare(b.artifact))};
  }catch(error){return {status:"partial",reasons:[error.message],evidenceSelectors:[]};}
}
module.exports={deriveStage7Input};
