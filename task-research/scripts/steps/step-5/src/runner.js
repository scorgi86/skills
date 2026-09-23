"use strict";

const path = require("node:path");

const { runFileBacked } = require("../../../shared/diagnostics/src/subprocess_output.js");
const { normalizeSearchProfile } = require("../../../shared/search/src/search_profile.js");

const { stableHash } = require("../../../shared/output/src/fact_projection.js");

const crypto = require("node:crypto");

const fs = require("node:fs");

const { extractTransition } = require("../../../shared/dto/src/extract_stage_transition.js");
const { transitionForRequest } = require("../../../state/src/session/inventory_session.js");

const { runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");
const { validateSourceAnchor } = require("../../../shared/evidence/src/canonicalization/source_anchor.js");

function normalizeCoverage(config) {
  if (!config || !config.id || !config.scope || !Array.isArray(config.terms) || !config.terms.length) throw new Error("Stage 5 requires nameCoverage with id, scope, and terms");
  const profile=config.searchProfile||config;
  return {
    id: String(config.id),
    scope: path.resolve(config.scope),
    terms: config.terms.map(String),
    extensions: normalizeSearchProfile(config.searchProfile || config.languages || config.extensions ? config : { extensions: [".js"] }).extensions.map(extension => `*${extension}`),
    excludeDirs: [...new Set((profile.excludeDirs || []).map(String))].sort(),
    excludeFilePatterns: (profile.excludeFilePatterns || []).map(String),
    followSymlinks: profile.followSymlinks === true,
    maxFiles: Number.isInteger(profile.maxFiles) && profile.maxFiles > 0 ? profile.maxFiles : Infinity,
    maxMatches: Number.isInteger(profile.maxMatches) && profile.maxMatches > 0 ? profile.maxMatches : Infinity,
  };
}

function coverageGlobs(config) {
  const fileGlobs = config.excludeFilePatterns.map((pattern) => {
    if (pattern === "\\.min\\.js$") return "!**/*.min.js";
    if (pattern === "\\.map$") return "!**/*.map";
    throw new Error(`Unsupported Stage5 exclusion pattern ${pattern}; use excludeDirs or supported file suffix patterns`);
  }).filter(Boolean);
  return [
    ...config.extensions,
    ...config.excludeDirs.map((name) => `!**/${name}/**`),
    ...fileGlobs,
  ];
}

function runRg(args, dependencies = {}) {
  const result = runFileBacked("rg", args, {}, dependencies);
  if (result.error) throw new Error(`rg failed: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1) throw new Error(`rg failed: ${String(result.stderr || "").trim() || `exit ${result.status}`}`);
  return String(result.stdout || "").split(/\r?\n/).filter(Boolean);
}

function makeAbsolute(scope, item) {
  return path.isAbsolute(item) ? path.resolve(item) : path.resolve(scope, item);
}

function findExactNameCoverage(config, dependencies = {}) {
  const normalized = normalizeCoverage(config);
  const globs = coverageGlobs(normalized);
  const fileArgs = ["--files", "--no-ignore", "--hidden", ...(normalized.followSymlinks ? ["--follow"] : []), ...globs.flatMap((glob) => ["--glob", glob]), normalized.scope];
  const matchArgs = ["--files-with-matches", "--no-ignore", "--hidden", "--ignore-case", ...(normalized.followSymlinks ? ["--follow"] : []), ...globs.flatMap((glob) => ["--glob", glob]), "--regexp", normalized.terms.join("|"), normalized.scope];
  const excluded = normalized.excludeFilePatterns.map(pattern => new RegExp(pattern));
  const isIncluded = file => !excluded.some(pattern => pattern.test(file));
  const files = runRg(fileArgs, dependencies).map((item) => makeAbsolute(normalized.scope, item)).filter(isIncluded).sort();
  const matchingFiles = [...new Set(runRg(matchArgs, dependencies).map((item) => makeAbsolute(normalized.scope, item)).filter(isIncluded))].sort();
  return {
    id: normalized.id,
    engine: "rg",
    scope: normalized.scope,
    terms: normalized.terms,
    searchProfile: { ...normalizeSearchProfile(config), extensions: normalized.extensions.map(extension => extension.slice(1)) },
    exclusions: { directories: normalized.excludeDirs, patterns: normalized.excludeFilePatterns },
    complete: true,
    absenceClaim: false,
    filesScanned: files.length,
    matchingFileCount: matchingFiles.length,
    matchingFiles,
    fileDigest: stableHash(files),
    matchingFileDigest: stableHash(matchingFiles),
    query: { fileArgs, matchArgs },
  };
}

function findLiteralNameCoverage(config, dependencies = {}) {
  const normalized=normalizeCoverage(config),globs=coverageGlobs(normalized);
  const fileArgs=["--files","--no-ignore","--hidden",...(normalized.followSymlinks?["--follow"]:[]),...globs.flatMap(glob=>["--glob",glob]),normalized.scope];
  const matchArgs=["--files-with-matches","--no-ignore","--hidden","--fixed-strings",...(normalized.followSymlinks?["--follow"]:[]),...globs.flatMap(glob=>["--glob",glob]),...normalized.terms.flatMap(term=>["--regexp",term]),normalized.scope];
  const countArgs=["--count-matches","--with-filename","--no-ignore","--hidden","--fixed-strings",...(normalized.followSymlinks?["--follow"]:[]),...globs.flatMap(glob=>["--glob",glob]),...normalized.terms.flatMap(term=>["--regexp",term]),normalized.scope];
  const files=runRg(fileArgs,dependencies).map(item=>makeAbsolute(normalized.scope,item)).sort(),matchingFiles=[...new Set(runRg(matchArgs,dependencies).map(item=>makeAbsolute(normalized.scope,item)))].sort();
  const totalMatches=runRg(countArgs,dependencies).reduce((sum,row)=>sum+Number(row.match(/:(\d+)$/)?.[1]||0),0),errors=[];
  if(files.length>normalized.maxFiles)errors.push(`maxFiles exceeded: ${files.length} > ${normalized.maxFiles}`);
  if(totalMatches>normalized.maxMatches)errors.push(`maxMatches exceeded: ${totalMatches} > ${normalized.maxMatches}`);
  return {id:normalized.id,consumerRepo:config.consumerRepo,engine:"rg-fixed",scope:normalized.scope,terms:normalized.terms,searchProfile:{...normalizeSearchProfile(config.searchProfile||config),extensions:normalized.extensions.map(x=>x.slice(1))},complete:errors.length===0,errors,totalMatches,absenceClaim:false,filesScanned:files.length,matchingFileCount:matchingFiles.length,matchingFiles,fileDigest:stableHash(files),matchingFileDigest:stableHash(matchingFiles),query:{fileArgs,matchArgs,countArgs}};
}

function currentFullMatch(match){
  try{return validateSourceAnchor(match,fs.readFileSync(path.resolve(match.file))).ok;}catch{return false;}
}
function sourceConfirmedMatch(match){return currentFullMatch(match)&&match.confirmation?.status==="source-confirmed";}

async function runAutomaticStage5(request,dependencies,transition){
  const discovery=request.pathDiscovery||{status:"partial",reasons:["path discovery is missing"],families:0};
  if(discovery.status==="partial")return {schemaVersion:"1.0.0",stage:5,status:"partial",transition,capabilities:[],criticalPaths:[],nameCoverages:[],sourceEvidence:{checks:[]},summary:{pathDiscovery:discovery},reusableForNextStage:{sourceEvidence:true,checkIds:[]}};
  if(discovery.status==="exhausted")return {schemaVersion:"1.0.0",stage:5,status:"candidate",transition,capabilities:[],criticalPaths:[],nameCoverages:[],sourceEvidence:{checks:[]},summary:{pathDiscovery:discovery},reusableForNextStage:{sourceEvidence:true,checkIds:[]}};
  const reasons=[]; let coverages=[],sourceEvidence={checks:[]};
  try{coverages=(request.nameCoverages||[]).map(config=>(dependencies.findLiteralNameCoverage||findLiteralNameCoverage)(config,dependencies));}catch(error){reasons.push(`Exact coverage failed: ${error.message}`);}
  try{sourceEvidence=(dependencies.runEvidenceChecks||runEvidenceChecks)({checks:(request.checks||[]).map(check=>({...check,retainAllMatches:true})),retainAllMatches:true});}catch(error){reasons.push(`Targeted checks failed: ${error.message}`);}
  const structuralResults=new Map(),structuralProofs=new Map(),canonicalEvidence=[],structuralChecks=request.structuralChecks||[];
  if(structuralChecks.length){
    try{
      const files=[...new Set(structuralChecks.map(row=>path.resolve(row.file)))].sort(),queries=[];
      for(const file of files){const terms=[...new Set(structuralChecks.filter(row=>path.resolve(row.file)===file).map(row=>row.term))].sort(),key=stableHash(file).slice(0,12);queries.push({id:`stage5-occurrences-${key}`,command:"occurrences",file,options:{terms},includeDetails:true,maxDetails:Number.MAX_SAFE_INTEGER,maxGroups:Number.MAX_SAFE_INTEGER});queries.push({id:`stage5-relations-${key}`,command:"relations",file,includeDetails:true,maxDetails:Number.MAX_SAFE_INTEGER,maxGroups:Number.MAX_SAFE_INTEGER});}
      const ast=await (dependencies.runAstBatch||require("../../../shared/ast/src/batch/batch.js").runAstBatch)({queries,cache:request.astCache,concurrency:request.astConcurrency||1});
      const byId=new Map(ast.results.map(row=>[row.id,row.details||[]]));
      for(const check of structuralChecks){const key=stableHash(path.resolve(check.file)).slice(0,12),occurrences=byId.get(`stage5-occurrences-${key}`)||[],relations=byId.get(`stage5-relations-${key}`)||[];structuralResults.set(check.id,require("../../../shared/value-flow/src/structural_match.js").matchStructuralUse(check,occurrences,relations));}
    }catch(error){reasons.push(`Structural AST checks failed: ${error.message}`);for(const check of structuralChecks)structuralResults.set(check.id,{status:"unresolved",reason:"ast-not-found"});}
  }
  const results=new Map(sourceEvidence.checks.map(check=>[check.id,check]));
  for(const check of structuralChecks){const matched=structuralResults.get(check.id);if(matched?.status!=="source-confirmed"){reasons.push(`${check.id}: ${matched?.reason||"ast-not-found"}`);continue;}const result=results.get(check.id);if(!result)continue;const participant=matched.participant,bytes=fs.readFileSync(path.resolve(check.file)),lines=bytes.toString("utf8").replace(/\r\n/g,"\n").split("\n"),line=participant.range.start.line,endLine=participant.range.end.line||line,sourceFragment=lines.slice(line-1,endLine).join("\n"),evidenceId=`structural-${stableHash([check.id,check.file,line,endLine,participant.role]).slice(0,16)}`,confirmation={status:"source-confirmed",evidenceRefs:[evidenceId],sourceHash:check.sourceHash,line,endLine,sourceFragment},proof={file:path.resolve(check.file),line,endLine,sourceHash:check.sourceHash,sourceFragment,confirmation};result.fullMatches=[...(result.fullMatches||[]),proof];structuralProofs.set(check.id,evidenceId);canonicalEvidence.push({id:evidenceId,status:"source-confirmed",repository:check.repository,file:path.resolve(check.file),line,endLine,sourceHash:check.sourceHash,sourceFragment,usageKind:"structural-ast",confirmation});}
  for(const check of sourceEvidence.checks)if(check.resultComplete===false||check.truncated===true||(check.errors||[]).length)reasons.push(`${check.id}: incomplete targeted check`);
  for(const coverage of coverages){const config=request.nameCoverages.find(row=>row.id===coverage.id),expected=(config.mappedFiles||[]).map(file=>path.resolve(file)).sort(),actual=coverage.matchingFiles.map(file=>path.resolve(file)).sort();if(!coverage.complete||JSON.stringify(expected)!==JSON.stringify(actual))reasons.push(`${coverage.id}: exact coverage differs from Stage 4 recipients`);}
  const criticalPaths=[],obligations=new Map((request.pathObligations||[]).map(row=>[row.id,row])),edges=new Map((request.valueFlowEdges||[]).map(row=>[row.id,row])),failureByLeaf=new Map();
  const ancestryFailure=candidate=>{for(const ref of candidate.obligationRefs||[]){const obligation=obligations.get(ref);if(!obligation)return "missing-edge";if(obligation.status!=="open")return obligation.reason||"upstream-unresolved";for(const edgeRef of obligation.edgeRefs||[]){const edge=edges.get(edgeRef);if(!edge)return "missing-edge";if(edge.status!=="source-confirmed")return "upstream-unresolved";}}return null;};
  for(const candidate of request.pathCandidates||[]){
    if(candidate.internal===true){const failure=candidate.unresolved?(candidate.reason||"upstream-unresolved"):ancestryFailure(candidate);if(failure){for(const ref of candidate.obligationRefs||[])failureByLeaf.set(ref,failure);reasons.push(`${candidate.obligationRefs?.[0]||candidate.id}: ${failure}`);continue;}criticalPaths.push({id:candidate.id,coverageKey:candidate.id,name:candidate.receiver,statement:`Source-confirmed value flow reaches ${candidate.receiver}`,entry:(candidate.edgeRefs||[])[0]||candidate.receiver,steps:(candidate.edgeRefs||[]).map(String),result:`Value reaches ${candidate.receiver}`,status:"confirmed",complete:true,obligationRefs:candidate.obligationRefs||[],evidenceRefs:candidate.evidenceRefs||[]});continue;}
    const candidateChecks=(request.checks||[]).filter(check=>check.familyId===candidate.familyId),positive=candidateChecks.filter(check=>{const result=results.get(check.id);if(!(result?.totalMatches>0))return false;const current=(result.fullMatches||[]).some(currentFullMatch);if(!current)reasons.push(`${check.id}: stale Stage 5 match`);return current;}),positiveBoundaries=new Set(positive.map(check=>check.boundaryId));
    for(const boundaryId of candidate.boundaryRefs||[])if(!positiveBoundaries.has(boundaryId))reasons.push(`${candidate.familyId}/${boundaryId}: no exact Stage 5 match`);
    if(positive.length&&positiveBoundaries.size===(candidate.boundaryRefs||[]).length){const ancestry=ancestryFailure(candidate),structural=(candidate.boundaryRefs||[]).every(boundaryId=>candidateChecks.some(check=>check.boundaryId===boundaryId&&structuralResults.get(check.id)?.status==="source-confirmed")),terminal=Boolean((candidate.obligationRefs||[]).length)&&!ancestry&&structural;const failure=ancestry||(!structural?candidateChecks.map(check=>structuralResults.get(check.id)?.reason).find(Boolean)||"ast-not-found":null);if(failure)for(const ref of candidate.obligationRefs||[])failureByLeaf.set(ref,failure);const proofRefs=candidateChecks.filter(check=>structuralResults.get(check.id)?.status==="source-confirmed").map(check=>structuralProofs.get(check.id)).filter(Boolean);criticalPaths.push({id:candidate.id,coverageKey:candidate.id,name:candidate.receiver,statement:`Exact boundary usage reaches ${candidate.receiver}`,entry:positive[0].term,steps:[...positive.map(check=>`${check.boundaryId}:${check.term}`),candidate.receiver],result:`Value reaches ${candidate.receiver}`,status:terminal?"confirmed":"candidate",complete:terminal,obligationRefs:candidate.obligationRefs||[],recipientRefs:[candidate.familyId],evidenceRefs:terminal?proofRefs:positive.map(check=>check.id)});}
  }
  const confirmedPathEvidence=new Set(criticalPaths.filter(row=>row.status==="confirmed").flatMap(row=>row.evidenceRefs||[]));
  const structuralUsages=structuralChecks.filter(check=>structuralProofs.has(check.id)&&!confirmedPathEvidence.has(structuralProofs.get(check.id))).map(check=>{const evidenceId=structuralProofs.get(check.id),matched=structuralResults.get(check.id),participant=matched.participant,relation=matched.relation;return {id:`usage-${evidenceId}`,name:check.term,statement:`Confirmed structural ${relation.relation}/${participant.role} of ${check.term} in ${path.basename(check.file)}`,result:`Structural match confirmed at ${path.basename(check.file)}:${participant.range.start.line}`,status:"confirmed",evidenceRefs:[evidenceId]};});
  const confirmedUsages=[...criticalPaths.filter(row=>row.status==="confirmed").map(row=>({id:`usage-${row.id}`,name:row.name,statement:row.statement,result:row.result,status:"confirmed",pathRefs:[row.id],obligationRefs:row.obligationRefs,evidenceRefs:row.evidenceRefs})),...structuralUsages];
  const parents=new Set((request.pathObligations||[]).map(row=>row.parentObligationRef).filter(Boolean)),terminalRefs=new Set(criticalPaths.filter(row=>row.status==="confirmed").flatMap(row=>row.obligationRefs||[]));
  const pathObligations=(request.pathObligations||[]).map(row=>!parents.has(row.id)&&!terminalRefs.has(row.id)&&row.status!=="unresolved"?{...row,status:"unresolved",reason:failureByLeaf.get(row.id)||"ast-not-found"}:row);
  for(const row of pathObligations)if(!parents.has(row.id)&&row.status==="unresolved")reasons.push(`${row.id}: ${row.reason||"upstream-unresolved"}`);
  if(pathObligations.length){const gate=require("../../../shared/value-flow/src/value_flow.js").validateObligationTree(pathObligations,criticalPaths.filter(row=>row.status==="confirmed"));reasons.push(...gate.errors);}
  const status=reasons.length?"partial":criticalPaths.some(row=>row.status==="candidate")?"candidate":"confirmed";
  const currentEvidenceFiles=sourceEvidence.checks.flatMap(check=>(check.fullMatches||[]).filter(currentFullMatch).map(match=>match.file));
  return {schemaVersion:"1.0.0",stage:5,status,transition,capabilities:require("../../../shared/dto/src/capability_contract.js").normalizeCapabilities(request.capabilities||[]),criticalPaths,confirmedUsages,pathObligations,valueFlowEdges:request.valueFlowEdges||[],canonicalEvidence,priorArtifacts:request.priorArtifacts||[],nameCoverages:coverages,sourceEvidence,sourceFreshness:{algorithm:"sha256",files:fingerprintFiles(currentEvidenceFiles)},summary:{pathDiscovery:{...discovery,status:reasons.length?"partial":"complete",reasons:[...new Set(reasons)].sort()}},reusableForNextStage:{sourceEvidence:true,checkIds:sourceEvidence.checks.map(check=>check.id)}};
}

function fingerprintFiles(files) {
  return [...new Set(files.map((file) => path.resolve(file)))].sort().map((file) => ({ file, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }));
}

async function runStage5(request, dependencies = {}, context = null) {
  if (Number(request && request.stage) !== 5) throw new Error("stage5_runner accepts only stage: 5");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  const transition = extractTransition(transitionForRequest(context, request) || fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  if(request.searchFromStage4===true)return runAutomaticStage5(request,dependencies,transition);
  if (!Array.isArray(request.checks) || !request.checks.length) throw new Error("Stage 5 requires targeted checks");
  const coverage = (dependencies.findExactNameCoverage || findExactNameCoverage)(request.nameCoverage, dependencies);
  const coverageCheck = coverage.matchingFiles.length ? [{
    id: coverage.id,
    files: coverage.matchingFiles,
    extensions: normalizeSearchProfile(request.nameCoverage).extensions,
    allowWideScope: true,
    patterns: [{ id: "expected-name", value: coverage.terms.join("|"), regex: true }],
    maxMatches: Number(request.coverageMaxMatches || 20),
    retainAllMatches: true,
  }] : [];
  const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({
    checks: [...request.checks, ...coverageCheck].map((check) => ({ ...check, retainAllMatches: true })),
    excludeDirs: request.excludeDirs,
    excludeFilePatterns: request.excludeFilePatterns,
    followSymlinks: request.followSymlinks === true,
    retainAllMatches: true,
  });
  const coverageEvidence = sourceEvidence.checks.find((check) => check.id === coverage.id) || null;
  const absenceEvidence = (request.checks || []).filter((check) => check.absenceClaim === true).flatMap((check) => {
    const outcome = sourceEvidence.checks.find((row) => row.id === check.id);
    if (!outcome || outcome.totalMatches !== 0 || outcome.resultComplete !== true || outcome.truncated === true || (outcome.errors || []).length) return [];
    return [{ id: `absence-${check.id}`, status: "checked-no-usage", evidenceKind: "absence", repository: check.repository, searchScope: check.searchScope, reason: check.reason, consequence: check.consequence, resultComplete: true, resultTruncated: false, expectedNames: check.expectedNames, performedChecks: check.performedChecks, ordersChecked: check.ordersChecked, linkingMethodsChecked: check.linkingMethodsChecked }].filter(row => [row.repository,row.searchScope,row.reason,row.consequence].every(value => typeof value === "string" && value.trim()) && [row.expectedNames,row.performedChecks,row.ordersChecked,row.linkingMethodsChecked].every(list => Array.isArray(list) && list.length));
  });
  const evidenceFiles = sourceEvidence.checks.flatMap((check) => (check.fullMatches || []).map((match) => match.file));
  return {
    schemaVersion: "1.0.0",
    stage: 5,
    capabilities: require("../../../shared/dto/src/capability_contract.js").normalizeCapabilities(request.capabilities || []),
    status: sourceEvidence.checks.some(check => check.resultComplete === false) ? "partial" : "candidate",
    transition,
    priorArtifacts: request.priorArtifacts || [],
    nameCoverage: { ...coverage, totalMatches: coverageEvidence ? coverageEvidence.totalMatches : 0, fullObservationCount: coverageEvidence ? coverageEvidence.fullMatches.length : 0 },
    sourceEvidence,
    ...(absenceEvidence.length ? { canonicalEvidence: absenceEvidence } : {}),
    sourceFreshness: { algorithm: "sha256", files: fingerprintFiles(evidenceFiles) },
    reusableForNextStage: { sourceEvidence: true, checkIds: sourceEvidence.checks.map((check) => check.id) },
  };
}

function buildSummary(result, outputFile) {
  if (Array.isArray(result.nameCoverages)) return {
    schemaVersion: result.schemaVersion,
    stage: result.stage,
    status: result.status,
    output: path.resolve(outputFile),
    nameCoverages: result.nameCoverages.map((coverage) => ({
      id: coverage.id,
      filesScanned: coverage.filesScanned,
      matchingFileCount: coverage.matchingFileCount,
      totalMatches: coverage.totalMatches,
      matchingFileDigest: coverage.matchingFileDigest,
    })),
    targetedChecks: result.sourceEvidence.checks.map((check) => ({ id: check.id, totalMatches: check.totalMatches, fullObservationCount: (check.fullMatches || []).length })),
    reusableForNextStage: result.reusableForNextStage,
  };
  return {
    schemaVersion: result.schemaVersion,
    stage: result.stage,
    status: result.status,
    output: path.resolve(outputFile),
    nameCoverage: {
      id: result.nameCoverage.id,
      filesScanned: result.nameCoverage.filesScanned,
      matchingFileCount: result.nameCoverage.matchingFileCount,
      totalMatches: result.nameCoverage.totalMatches,
      fullObservationCount: result.nameCoverage.fullObservationCount,
      matchingFileDigest: result.nameCoverage.matchingFileDigest,
    },
    targetedChecks: result.sourceEvidence.checks.filter((check) => check.id !== result.nameCoverage.id).map((check) => ({ id: check.id, totalMatches: check.totalMatches, fullObservationCount: check.fullMatches.length })),
    reusableForNextStage: result.reusableForNextStage,
  };
}

module.exports = { buildSummary, coverageGlobs, findExactNameCoverage, findLiteralNameCoverage, fingerprintFiles, normalizeCoverage, runStage5, sourceConfirmedMatch };
