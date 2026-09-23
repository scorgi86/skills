"use strict";
const fs = require("node:fs"), path = require("node:path");
const { extractTransition } = require("../../../shared/dto/src/extract_stage_transition.js");
const { runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");
const { normalizeSearchProfile } = require("../../../shared/search/src/search_profile.js");
const { transitionForRequest } = require("../../../state/src/session/inventory_session.js");
const { normalizeCapabilities } = require("../../../shared/dto/src/capability_contract.js");
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function runStage3(request, dependencies = {}, context = null) {
  if (Number(request?.stage) !== 3) throw new Error("stage3_runner accepts only stage: 3");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  const previous = transitionForRequest(context, request) || JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const transition = extractTransition(previous);
  const boundaries = (previous.facts || []).filter(item => item.kind === "boundary").map(({ kind, boundaryKind, ...item }) => ({ ...item, kind: boundaryKind }));
  const pathObligations=(previous.facts||[]).filter(item=>item.kind==="path-obligation").map(({kind,...item})=>item),valueFlowEdges=(previous.facts||[]).filter(item=>item.kind==="value-flow-edge").map(({kind,...item})=>item);
  const edges=new Map(valueFlowEdges.map(row=>[row.id,row]));
  const suppliedScopes = request.consumerScopes || [], duplicateIds = suppliedScopes.map(row=>row.id).filter((id,index,all)=>all.indexOf(id)!==index);
  const scopes = new Map(suppliedScopes.map(item => [item.id, item]));
  const checks = [], consumerCoverage = [], limitations = duplicateIds.map(id => `Duplicate consumer scope: ${id}`);
  for (const boundary of boundaries) for (const consumerRepo of boundary.consumerRepos || []) {
    const consumer = scopes.get(consumerRepo), id = `${boundary.id}@${consumerRepo}`;
    if (!consumer?.scope) { consumerCoverage.push({ boundaryId: boundary.id, consumerRepo, status: "unverified", reason: "No consumer scope was supplied", absenceClaim: false }); continue; }
    const normalizedProfile = normalizeSearchProfile(consumer), searchProfile={...normalizedProfile,maxFiles:Number(consumer.maxFiles||request.maxFiles||200),maxMatches:Number(consumer.maxMatches||request.maxMatches||20),followSymlinks:consumer.followSymlinks===true||request.followSymlinks===true,excludeDirs:[...(consumer.excludeDirs||request.excludeDirs||[])],excludeFilePatterns:[...(consumer.excludeFilePatterns||request.excludeFilePatterns||[])]};
    checks.push({ id, scope: consumer.scope, extensions: searchProfile.extensions, patterns: (boundary.searchTerms || []).map(value => ({ id:value, value:escapeRegex(value), regex:true, caseSensitive:true })), maxFiles:searchProfile.maxFiles, maxMatches:searchProfile.maxMatches, groupBy:"file-pattern", excludeDirs:searchProfile.excludeDirs, excludeFilePatterns:searchProfile.excludeFilePatterns, followSymlinks:searchProfile.followSymlinks });
    const terms=boundary.searchTerms||[],obligationRefs=pathObligations.filter(obligation=>(obligation.edgeRefs||[]).some(ref=>{const edge=edges.get(ref);return edge&&terms.some(term=>[edge.from,edge.to].some(value=>String(value||"").includes(term)));})).map(row=>row.id).sort();
    consumerCoverage.push({ boundaryId:boundary.id, consumerRepo, status:"candidate", scope:consumer.scope, searchProfile, checkId:id, obligationRefs, absenceClaim:false });
  }
  let sourceEvidence = { checks: [] };
  try { sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({ checks, maxFiles:Number(request.maxFiles||200), maxMatches:Number(request.maxMatches||20), excludeDirs:request.excludeDirs, excludeFilePatterns:request.excludeFilePatterns, followSymlinks:request.followSymlinks===true, retainAllMatches:true }); }
  catch (error) { limitations.push(`Consumer search failed: ${error.message}`); }
  for (const coverage of consumerCoverage) {
    const matching = sourceEvidence.checks.filter(item => item.id === coverage.checkId);
    if (matching.length !== 1) { limitations.push(`${coverage.boundaryId}@${coverage.consumerRepo}: expected exactly one source check`); coverage.status="unverified"; continue; }
    const check = matching[0];
    Object.assign(coverage,{status:check.status,filesScanned:check.filesScanned,totalMatches:check.totalMatches,truncated:check.truncated,searchedScope:check.spec,resultComplete:check.resultComplete,errors:check.errors||[],skipped:check.skipped||[],absenceClaim:false});
    if (check.resultComplete !== true || check.truncated === true || (check.errors||[]).length) limitations.push(`${coverage.boundaryId}@${coverage.consumerRepo}: Consumer search is incomplete`);
  }
  for (const coverage of consumerCoverage.filter(item=>item.status==="unverified")) limitations.push(`${coverage.boundaryId}@${coverage.consumerRepo}: ${coverage.reason||"Consumer search is incomplete"}`);
  const discoveryStatus = previous.summary?.boundaryDiscovery?.status;
  const boundaryStatus = boundaries.length ? "searched" : discoveryStatus === "exhausted" ? "exhausted" : request.searchFromStage2 === true ? "incomplete" : "manual-empty";
  if (!boundaries.length && request.searchFromStage2 === true && boundaryStatus !== "exhausted") limitations.push("Stage 2 boundary discovery is missing or incomplete");
  return { schemaVersion:"1.1.0", stage:3, status:limitations.length?"partial":"candidate", transition, boundaries, pathObligations, valueFlowEdges, consumerCoverage, summary:{consumerCoverage,boundaryStatus}, sourceEvidence, capabilities:normalizeCapabilities(request.capabilities||[]), limitations:[...new Set(limitations)] };
}
module.exports = { escapeRegex, runStage3 };
