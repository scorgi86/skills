"use strict";
const crypto=require("node:crypto"),path=require("node:path");
const {validateCanonicalStageResult}=require("../../../shared/artifacts/src/canonical/validation.js");
const {validateStageArtifact}=require("../../../shared/artifacts/src/stage_artifact_v4.js");
const {expandedEvidence}=require("./referenced_evidence.js");
const {normalizeRepositoryScope}=require("../../../shared/dto/src/repository_scope.js");
const {scopeDigest}=require("../../../shared/artifacts/src/canonical/checks.js");
const {SourceSnapshotStore}=require("../../../shared/evidence/src/source_snapshot.js");

const inside=(root,file)=>{const relative=path.relative(root,file);return relative&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);};
const unique=values=>[...new Set(values)].sort();
const familyId=value=>`recipient-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0,16)}`;

function partial(reasons){return {recipientFamilyCandidates:[],pathObligations:[],valueFlowEdges:[],recipientDiscovery:{status:"partial",reasons:unique(reasons),families:0}};}

function deriveStage4Search(stage3,artifactFile,repositoryScope,dependencies={}){
  if(!validateCanonicalStageResult(stage3).ok||stage3.stage!==3||stage3.status!=="closed") throw new Error("Stage 4 search requires a valid closed Stage 3 artifact");
  const scope=normalizeRepositoryScope(repositoryScope,{requireExisting:false});
  if(scopeDigest(scope)!==scopeDigest(normalizeRepositoryScope(stage3.summary.repositoryScope,{requireExisting:false}))) throw new Error("Stage 4 search repository scope differs from Stage 3");
  const artifactRoot=path.dirname(path.dirname(path.resolve(artifactFile))), artifact=validateStageArtifact(artifactRoot);
  if(!artifact.ok)return partial(artifact.errors.map(error=>`Stage 3 artifact: ${error}`));
  let evidence;try{evidence=expandedEvidence(artifactFile);}catch(error){return partial([error.message]);}
  const carriedObligations=stage3.facts.filter(row=>row.kind==="path-obligation").map(({kind,...row})=>row),carriedEdges=stage3.facts.filter(row=>row.kind==="value-flow-edge").map(({kind,...row})=>row);
  if(stage3.summary.boundaryStatus==="exhausted")return {recipientFamilyCandidates:[],pathObligations:carriedObligations,valueFlowEdges:carriedEdges,recipientDiscovery:{status:"exhausted",reasons:[],families:0}};
  if(stage3.summary.boundaryStatus!=="searched")return partial(["Stage 3 boundary search is incomplete"]);
  const repositories=new Map(scope.repositories.filter(row=>row.role==="consumer").map(row=>[row.id,row]));
  const boundaries=new Map(stage3.facts.filter(row=>row.kind==="boundary").map(row=>[row.id,row]));
  const pathObligations=carriedObligations,valueFlowEdges=carriedEdges;
  const coverage=stage3.summary.consumerCoverage||[], pairs=new Set(), checks=new Map(), reasons=[];
  for(const row of coverage){
    const pair=`${row.boundaryId}\0${row.consumerRepo}`;
    if(pairs.has(pair))reasons.push(`${row.boundaryId}@${row.consumerRepo}: duplicate coverage`); pairs.add(pair);
    const boundary=boundaries.get(row.boundaryId), repo=repositories.get(row.consumerRepo);
    if(!boundary||!repo||!(boundary.consumerRepos||[]).includes(row.consumerRepo))reasons.push(`${row.boundaryId}@${row.consumerRepo}: unmapped boundary or consumer`);
    if(!row.checkId||checks.has(row.checkId))reasons.push(`${row.boundaryId}@${row.consumerRepo}: missing or duplicate check id`);
    else checks.set(row.checkId,{...row,boundary,repo});
    if(row.resultComplete!==true||row.truncated===true||(row.errors||[]).length)reasons.push(`${row.boundaryId}@${row.consumerRepo}: incomplete Stage 3 check`);
  }
  for(const boundary of boundaries.values())for(const consumerRepo of boundary.consumerRepos||[])if(!pairs.has(`${boundary.id}\0${consumerRepo}`))reasons.push(`${boundary.id}@${consumerRepo}: coverage is missing`);
  if(reasons.length)return partial(reasons);
  const positive=[...checks.entries()].filter(([,row])=>Number(row.totalMatches||0)>0);
  if(!positive.length)return {recipientFamilyCandidates:[],pathObligations,valueFlowEdges,recipientDiscovery:{status:"exhausted",reasons:[],families:0}};
  const snapshots=dependencies.sourceSnapshots||new SourceSnapshotStore(), found=new Set(), groups=new Map();
  for(const item of evidence){
    const provenance=new Set(item.provenance||[]);
    for(const [checkId,row] of positive){
      if(!provenance.has(`source-evidence:${checkId}`))continue;
      found.add(checkId); const file=path.resolve(item.file||"");
      const snapshot=snapshots.get(file);
      if(item.repository!==row.consumerRepo||!inside(row.repo.root,file)||!snapshot||snapshot.sourceHash!==item.sourceHash){reasons.push(`${checkId}: stale or out-of-scope evidence ${file}`);continue;}
      const relative=path.relative(row.repo.root,file).split(path.sep).join("/"),refs=row.obligationRefs?.length?row.obligationRefs:[null];
      for(const obligationRef of refs){const key=`${row.consumerRepo}\0${relative}\0${obligationRef||""}`;
      const group=groups.get(key)||{consumerRepo:row.consumerRepo,receiver:relative,boundaryRefs:[],evidenceRefs:[],...(obligationRef?{obligationRefs:[obligationRef]}:{})};
      group.boundaryRefs.push(row.boundaryId); group.evidenceRefs.push(item.id); groups.set(key,group);}
    }
  }
  for(const [checkId] of positive)if(!found.has(checkId))reasons.push(`${checkId}: Stage 3 evidence is missing`);
  if(reasons.length)return partial(reasons);
  let obligationRows=[...pathObligations];const grouped=[...groups.values()],byObligation=new Map(),existingParents=new Set(pathObligations.map(row=>row.parentObligationRef).filter(Boolean));
  for(const group of grouped)for(const ref of group.obligationRefs||[])byObligation.set(ref,[...(byObligation.get(ref)||[]),group]);
  for(const [ref,branches] of byObligation){if(branches.length<2&&!existingParents.has(ref))continue;const parent=pathObligations.find(row=>row.id===ref);if(!parent)continue;for(const group of branches){const [child]=require("../../../shared/value-flow/src/value_flow.js").splitObligation(parent,[{key:[group.consumerRepo,group.receiver,unique(group.boundaryRefs)],frontier:group.receiver}]);obligationRows.push(child);group.obligationRefs=[child.id];}}
  obligationRows=[...new Map(obligationRows.map(row=>[row.id,row])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const recipientFamilyCandidates=grouped.map(group=>{
    const boundaryRefs=unique(group.boundaryRefs),evidenceRefs=unique(group.evidenceRefs);
    return {id:familyId([group.consumerRepo,group.receiver,boundaryRefs,group.obligationRefs||[]]),receiver:group.receiver,relation:"contains exact boundary usage",status:"candidate",consumerRepo:group.consumerRepo,boundaryRefs,evidenceRefs,obligationRefs:group.obligationRefs||[],observationCount:evidenceRefs.length,absenceClaim:false};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  return {recipientFamilyCandidates,pathObligations:obligationRows,valueFlowEdges,recipientDiscovery:{status:"complete",reasons:[],families:recipientFamilyCandidates.length}};
}
module.exports={deriveStage4Search};
