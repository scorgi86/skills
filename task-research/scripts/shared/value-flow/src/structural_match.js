"use strict";
const path=require("node:path");
const {normalizedTerm}=require("../../ast/src/analysis/occurrences.js");

const ROLES={
  construct:new Set(["callee"]),call:new Set(["callee"]),"field-read":new Set(["source-field"]),
  "field-to-call-argument":new Set(["source-field"]),"field-to-return":new Set(["source-field"]),
  "field-write":new Set(["target-field","source-value"]),"computed-write":new Set(["target-field","source-value"]),
  "parameter-to-field":new Set(["target-field","source-value"]),"call-result-to-field":new Set(["target-field","source-value"]),
  "object-field":new Set(["target-field","source-value"]),"collection-push":new Set(["receiver-field","source-value"]),
  "collection-add":new Set(["receiver-field","source-value"]),"collection-set":new Set(["receiver-field","source-value"]),
  "setter-argument-to-field":new Set(["source-value"]),import:new Set(["module-source"]),export:new Set(["exported-value"]),
};
const sameRange=(a,b)=>a?.start?.offset===b?.start?.offset&&a?.end?.offset===b?.end?.offset;
const exactRelation=row=>row&&row.dynamic!==true&&(row.evidence||[]).some(item=>["exact","resolved"].includes(item.confidence));
function matchStructuralUse(expected,occurrences,relations){
  const file=path.resolve(expected.file),term=normalizedTerm(expected.term),sameFile=row=>path.resolve(row.file||"")===file;
  const terms=(occurrences||[]).filter(row=>sameFile(row)&&normalizedTerm(row.value)===term);
  if((terms.length&&(terms.some(row=>row.sourceHash!==expected.sourceHash)))||!expected.sourceHash)return {status:"unresolved",reason:"stale-source"};
  const unsupported=[];const matches=[];let stale=false;
  for(const relation of relations||[])for(const participant of relation.participants||[]){
    if(!sameFile(participant)||normalizedTerm(participant.value)!==term)continue;
    const allowed=ROLES[relation.relation];if(!allowed||!allowed.has(participant.role)){unsupported.push(relation);continue;}
    if(participant.sourceHash!==expected.sourceHash){stale=true;continue;}
    if(!exactRelation(relation)||relation.analysisSourceHash&&relation.analysisSourceHash!==expected.sourceHash)continue;
    if(terms.some(row=>row.sourceHash===expected.sourceHash&&sameRange(row.range,participant.range)))matches.push({relation,participant});
  }
  const unique=[...new Map(matches.map(row=>[[row.relation.relation,row.relation.ownerQualifiedName,row.relation.targetQualifiedName,row.participant.role,row.participant.range.start.offset,row.participant.range.end.offset].join("|"),row])).values()];
  if(unique.length===1)return {status:"source-confirmed",...unique[0]};
  if(unique.length>1)return {status:"unresolved",reason:"ast-ambiguous"};
  if(stale)return {status:"unresolved",reason:"stale-source"};
  if(unsupported.length)return {status:"unresolved",reason:"unsupported-relation"};
  return {status:"unresolved",reason:terms.length?"non-structural-occurrence":"ast-not-found"};
}
module.exports={ROLES,matchStructuralUse};
