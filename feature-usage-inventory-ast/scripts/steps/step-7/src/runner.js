"use strict";

const path = require("node:path");

const { PLANNING_COLLECTIONS, buildPlanningProjection, mergeRows } = require("../../../shared/dto/src/planning_contract.js");

const { normalizeCapabilities } = require("../../../shared/dto/src/capability_contract.js");

const { canonicalJson } = require("../../../shared/report/src/model/serialization.js");
const { normalizeReportModel } = require("../../../shared/report/src/model/normalization.js");
const { validateReportModel } = require("../../../shared/report/src/model/validation.js");
const { validatePriorLineage } = require("../../../shared/artifacts/src/canonical/lineage.js");
const { resolveChecks } = require("../../../shared/artifacts/src/canonical/checks.js");

const { readCanonicalStageResult: readJson } = require("../../../shared/artifacts/src/stage_artifact_v4.js");

function requireArray(value, name) { if (!Array.isArray(value)) throw new Error(`${name} must be an array`); return value; }

function buildStage7(request, dependencies = {}) {
  if (Number(request?.stage) !== 7) throw new Error("Stage 7 requires stage: 7");
  if (request.coverage?.profile !== undefined) throw new Error("Stage 7 request.coverage.profile is output-only; use coverageProfile declared at Stage 0");
  if (request.repositoryScope && request.scope && require("../../../shared/artifacts/src/canonical/checks.js").scopeDigest(request.repositoryScope) !== require("../../../shared/artifacts/src/canonical/checks.js").scopeDigest(request.scope)) throw new Error("Stage 7 conflicting repositoryScope and scope");
  const scope = request.repositoryScope || request.scope;
  const priorArtifacts = requireArray(request.priorArtifacts, "priorArtifacts"); if (!priorArtifacts.length) throw new Error("Stage 7 requires priorArtifacts");
  const artifactBase = dependencies.artifactBase || process.cwd();
  const { prior, lineage } = validatePriorLineage({ stage: 7, repositoryScope: request.repositoryScope || request.scope, priorArtifacts, artifactBase, expectedArtifact: dependencies.expectedArtifact || request.expectedArtifact, expectedArtifacts: dependencies.expectedArtifacts });
  if (Array.isArray(request.evidenceIndex) && request.evidenceIndex.length) throw new Error("Stage 7 evidenceIndex must be supplied through bounded canonical evidence selectors");
  const selections = (request.evidenceSelectors || []).map((selector) => { if (!selector.artifact) throw new Error("Each evidence selector requires artifact"); const selection = require("../../../shared/artifacts/src/query_stage_artifacts.js").queryStageArtifacts({ ...selector, artifact: path.resolve(artifactBase, selector.artifact) }); if (selection.truncated && selector.allowTruncated !== true) throw new Error(`Truncated evidence selector must be narrowed or explicitly marked allowTruncated: ${selector.artifact}`); return selection; });
  const selectedEvidence = mergeRows(selections.flatMap((selection) => selection.evidence));
  const evidenceIdMap = {};
  for (const row of selectedEvidence) for (const alias of new Set([row.id, ...(row.aliases || [])])) evidenceIdMap[alias] = [...new Set([...(evidenceIdMap[alias] || []), row.id])].sort();
  const remap = (value) => require("../../../shared/evidence/src/canonicalization/canonicalize.js").remapEvidenceReferences(value, evidenceIdMap);
  request = remap(request);
  const planning = buildPlanningProjection(prior.map((item) => remap(item.result)));
  const retainedCoverage = { artifacts: prior.map((item) => ({ stage: item.result.stage, capabilities: item.result.facts.filter((fact) => fact.kind === "capability").map((capability) => capability.id) })), planning: Object.fromEntries(PLANNING_COLLECTIONS.map((name) => [name, planning[name].length])), evidenceSelectionTruncated: selections.some((selection) => selection.truncated) };
  const inherited = prior.flatMap((item) => item.result.facts.filter((fact) => fact.kind === "capability").map(({ kind, ...capability }) => capability));
  const overrides = new Map(normalizeCapabilities(request.capabilities || []).map((item) => [item.id, item]));
  const capabilityMap = new Map(normalizeCapabilities(remap(inherited)).map((item) => [item.id, item]));
  for (const [id, item] of overrides) capabilityMap.set(id, item);
  const capabilities = [...capabilityMap.values()];
  const collections = Object.fromEntries(PLANNING_COLLECTIONS.map((name) => [name, mergeRows([...(planning[name] || []), ...(request[name] || [])])]));
  const reconciled = resolveChecks(prior.at(-1).result, request, request.checkResolutions || [], selectedEvidence, request.repositoryScope || request.scope);
  if (reconciled.openChecks.length) throw new Error(`Stage 7 has unresolved openChecks: ${reconciled.openChecks.join("; ")}`);
  const inheritedProfile = prior.find((item) => item.result.stage === 0)?.result.summary?.coverageProfile;
  if (inheritedProfile === undefined && request.coverageProfile !== undefined) throw new Error("Stage 7 coverageProfile must be declared at Stage 0; reissue the legacy run to introduce coverage requirements");
  const { normalizeCoverageProfile } = require("../../../shared/report/src/model/coverage.js");
  if (inheritedProfile && request.coverageProfile && canonicalJson(normalizeCoverageProfile(inheritedProfile)) !== canonicalJson(normalizeCoverageProfile(request.coverageProfile))) throw new Error("Stage 7 coverageProfile conflicts with Stage 0 lineage");
  const facts = normalizeReportModel({ ...reconciled, checkRequirements: reconciled.summary.checkRequirements, scope, coverageProfile: inheritedProfile || request.coverageProfile, ...collections, evidenceIndex: selectedEvidence, priorArtifacts, provenance: { ...(request.provenance || {}), lineage, priorArtifacts, retainedCoverage }, coverage: { ...(request.coverage || {}), retainedCoverage }, capabilities });
  const validation = validateReportModel(facts);
  if (!validation.ok) throw new Error(`Stage 7 report model validation failed: ${validation.errors.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
  return facts;
}

function buildSummary(facts, output) { return { schemaVersion: facts.schemaVersion, modelType: facts.modelType, stage: facts.stage, status: facts.status, output: path.resolve(output), canonicalDigest: facts.integrity.canonicalDigest, counts: { confirmed: facts.confirmedUsages.length, checkedNoUsage: facts.checkedNoUsage.length, referenceOnly: facts.referenceOnly.length, retainedArtifacts: facts.coverage.retainedCoverage.artifacts.length, capabilities: facts.capabilities.length, noise: facts.noise.length, openChecks: facts.openChecks.length }, nextStage: facts.transition["next stage"] }; }

function formatFacts(facts) { return canonicalJson(facts).trimEnd(); }

module.exports = { buildStage7, buildSummary, formatFacts, readJson };
