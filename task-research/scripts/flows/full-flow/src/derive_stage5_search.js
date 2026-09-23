"use strict";
const crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const {validateCanonicalStageResult,digest}=require("../../../shared/artifacts/src/canonical/validation.js");
const {expandedEvidence}=require("./referenced_evidence.js");
const {readCanonicalStageResult}=require("../../../shared/artifacts/src/stage_artifact_v4.js");
const {normalizeRepositoryScope}=require("../../../shared/dto/src/repository_scope.js");
const {scopeDigest}=require("../../../shared/artifacts/src/canonical/checks.js");
const unique=values=>[...new Set(values.filter(Boolean).map(String))].sort();
const stableId=(prefix,value)=>`${prefix}-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0,16)}`;
const inside=(root,file)=>{const relative=path.relative(root,file);return relative&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);};
const partial=reasons=>({checks:[],structuralChecks:[],nameCoverages:[],pathCandidates:[],pathDiscovery:{status:"partial",reasons:unique(reasons),families:0}});
function completeProfile(value){return value&&Number.isInteger(value.maxFiles)&&value.maxFiles>0&&Number.isInteger(value.maxMatches)&&value.maxMatches>0&&typeof value.followSymlinks==="boolean"&&Array.isArray(value.excludeDirs)&&Array.isArray(value.excludeFilePatterns)&&Array.isArray(value.extensions)&&value.extensions.length;}
function currentLocator(row,file,repoId,content,currentHash){
  if(!row||path.resolve(row.file||"")!==file||row.repository!==repoId||row.sourceHash!==currentHash||!row.sourceFragment)return false;
  const start=row.range?.startLine,end=row.range?.endLine||start;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start)return false;
  return content.toString("utf8").split(/\r?\n/).slice(start-1,end).join("\n")===row.sourceFragment;
}

function deriveStage5Search(stage4,artifactFile,repositoryScope){
  if(!validateCanonicalStageResult(stage4).ok||stage4.stage!==4||stage4.status!=="closed")throw new Error("Stage 5 search requires a valid closed Stage 4 artifact");
  const scope=normalizeRepositoryScope(repositoryScope,{requireExisting:false});
  if(scopeDigest(scope)!==scopeDigest(normalizeRepositoryScope(stage4.summary.repositoryScope,{requireExisting:false})))throw new Error("Stage 5 search repository scope differs from Stage 4");
  const families=stage4.facts.filter(row=>row.kind==="recipient-family"),discovery=stage4.summary.recipientDiscovery;
  const pathObligations=stage4.facts.filter(row=>row.kind==="path-obligation").map(({kind,...row})=>row),valueFlowEdges=stage4.facts.filter(row=>row.kind==="value-flow-edge").map(({kind,...row})=>row);
  if(discovery?.status==="exhausted"&&families.length)return partial(["Stage 4 exhaustion conflicts with recipient families"]);
  if(discovery?.status==="exhausted"&&!families.length&&!pathObligations.length)return {checks:[],nameCoverages:[],pathCandidates:[],pathDiscovery:{status:"exhausted",reasons:[],families:0}};
  if(!["complete","exhausted"].includes(discovery?.status)||(!families.length&&!pathObligations.length))return partial(["Stage 4 recipient discovery is incomplete"]);
  const lineage=[];
  for(const descriptor of stage4.summary.lineage||[]){
    const loaded=readCanonicalStageResult(descriptor.artifact);
    if(loaded.stage!==descriptor.stage||loaded.outputDigest!==descriptor.outputDigest)return partial([`Stage ${descriptor.stage} lineage digest mismatch`]);
    lineage.push(loaded);
  }
  const boundaryRows=lineage.flatMap(row=>row.facts||[]).filter(row=>row.kind==="boundary"),boundaries=new Map(),boundaryConflicts=new Set();
  for(const row of boundaryRows){const previous=boundaries.get(row.id);if(previous&&digest(previous)!==digest(row))boundaryConflicts.add(row.id);else boundaries.set(row.id,row);}
  const stage3=lineage.find(row=>row.stage===3),profiles=new Map(),profileErrors=[];
  for(const row of stage3?.summary?.consumerCoverage||[]){
    const key=row.consumerRepo,value=row.searchProfile;
    if(!completeProfile(value)){profileErrors.push(`${key}: Stage 3 search profile is missing or incomplete`);continue;}
    const hash=digest(value),previous=profiles.get(key);
    if(previous&&previous.hash!==hash)profileErrors.push(`${key}: Stage 3 search profile is ambiguous`); else profiles.set(key,{hash,value});
  }
  const repos=new Map(scope.repositories.filter(row=>row.role==="consumer").map(row=>[row.id,row])),evidenceRows=expandedEvidence(artifactFile),evidence=new Map(evidenceRows.map(row=>[row.id,row])),reasons=[...profileErrors],checks=[],structuralChecks=[],pathCandidates=[],coverageTerms=new Map(),mappedFiles=new Map();
  for(const boundary of boundaries.values())for(const repoId of boundary.consumerRepos||[])if(repos.has(repoId))coverageTerms.set(repoId,unique([...(coverageTerms.get(repoId)||[]),...(boundary.searchTerms||[])]));
  for(const family of families){
    const repo=repos.get(family.consumerRepo),file=repo&&path.resolve(repo.root,family.receiver||"");
    if(!repo||!family.receiver||!inside(repo.root,file)){reasons.push(`${family.id}: invalid consumer receiver`);continue;}
    mappedFiles.set(repo.id,unique([...(mappedFiles.get(repo.id)||[]),file]));
    const content=fs.existsSync(file)?fs.readFileSync(file):null,currentHash=content&&crypto.createHash("sha256").update(content).digest("hex");
    const familyEvidence=(family.evidenceRefs||[]).map(id=>evidence.get(id));
    if(familyEvidence.some(row=>!currentLocator(row,file,repo.id,content,currentHash))){reasons.push(`${family.id}: Stage 4 locator is missing, stale, or out of scope`);continue;}
    for(const boundaryId of unique(family.boundaryRefs||[])){
      const boundary=boundaries.get(boundaryId),terms=unique(boundary?.searchTerms||[]);
      if(!boundary||boundaryConflicts.has(boundaryId)||(boundary.consumerRepos||[]).filter(id=>id===repo.id).length!==1||!terms.length){reasons.push(`${family.id}/${boundaryId}: boundary is missing or ambiguous`);continue;}
      const locators=familyEvidence.filter(row=>(row.provenance||[]).includes(`source-evidence:${boundaryId}@${repo.id}`));
      const valid=locators.some(row=>currentLocator(row,file,repo.id,content,currentHash));
      if(!valid){reasons.push(`${family.id}/${boundaryId}: current Stage 4 locator is missing`);continue;}
      for(const term of terms){const id=stableId("path-check",[repo.id,family.receiver,boundaryId,term]);checks.push({id,familyId:family.id,boundaryId,term,repository:repo.id,file,patterns:[{id:term,value:term,caseSensitive:true}],retainAllMatches:true});structuralChecks.push({id,familyId:family.id,boundaryId,term,repository:repo.id,file,sourceHash:currentHash,obligationRefs:unique(family.obligationRefs||[])});}
    }
    pathCandidates.push({id:stableId("critical-path",[repo.id,family.receiver,unique(family.boundaryRefs||[]),family.obligationRefs||[]]),familyId:family.id,receiver:family.receiver,consumerRepo:repo.id,boundaryRefs:unique(family.boundaryRefs||[]),obligationRefs:unique(family.obligationRefs||[])});
  }
  for(const repoId of coverageTerms.keys())if(!profiles.has(repoId))reasons.push(`${repoId}: Stage 3 search profile is missing`);
  if(reasons.length)return partial(reasons);
  const nameCoverages=[...coverageTerms].map(([repoId,terms])=>({id:stableId("path-coverage",[repoId,terms]),consumerRepo:repoId,scope:repos.get(repoId).root,terms,searchProfile:profiles.get(repoId).value,mappedFiles:mappedFiles.get(repoId)||[]})).sort((a,b)=>a.id.localeCompare(b.id));
  const parents=new Set(pathObligations.map(row=>row.parentObligationRef).filter(Boolean)),mapped=new Set(pathCandidates.flatMap(row=>row.obligationRefs||[])),edges=new Map(valueFlowEdges.map(row=>[row.id,row]));
  for(const obligation of pathObligations.filter(row=>!parents.has(row.id)&&!mapped.has(row.id))){const edgeRefs=obligation.edgeRefs||[],terminalEdges=edgeRefs.map(ref=>edges.get(ref)),presentEdges=terminalEdges.filter(Boolean),evidenceRefs=unique(presentEdges.flatMap(edge=>evidenceRows.filter(row=>path.resolve(row.file||"")===path.resolve(edge.file||"")&&row.sourceHash===edge.sourceHash&&(row.line??row.range?.startLine)===edge.line).map(row=>row.id))),missingEdge=terminalEdges.some(edge=>!edge),unconfirmedEdge=presentEdges.some(edge=>edge.status!=="source-confirmed"),unresolved=obligation.status==="unresolved"||missingEdge||unconfirmedEdge||evidenceRefs.length!==edgeRefs.length,reason=obligation.reason||(missingEdge?"missing-edge":unconfirmedEdge?"upstream-unresolved":evidenceRefs.length!==edgeRefs.length?"ast-not-found":undefined);pathCandidates.push({id:stableId("critical-path",["internal",obligation.id]),receiver:obligation.frontier,internal:true,unresolved,reason,obligationRefs:[obligation.id],edgeRefs,evidenceRefs});}
  return {checks:checks.sort((a,b)=>a.id.localeCompare(b.id)),structuralChecks:structuralChecks.sort((a,b)=>a.id.localeCompare(b.id)),nameCoverages,pathCandidates:pathCandidates.sort((a,b)=>a.id.localeCompare(b.id)),pathObligations,valueFlowEdges,pathDiscovery:{status:"complete",reasons:[],families:pathCandidates.length}};
}
module.exports={deriveStage5Search};
