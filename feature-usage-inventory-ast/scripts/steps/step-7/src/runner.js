"use strict";

const fs = require("node:fs");

const path = require("node:path");

const { PLANNING_COLLECTIONS, buildPlanningProjection, mergeRows } = require("../../../shared/dto/src/planning_contract.js");

const { normalizeCapabilities } = require("../../../shared/dto/src/capability_contract.js");

const { canonicalJson } = require("../../../shared/report/src/model/serialization.js");
const { normalizeReportModel } = require("../../../shared/report/src/model/normalization.js");
const { validateReportModel } = require("../../../shared/report/src/model/validation.js");

function readJson(file) { const value = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); if (value.schemaVersion !== "4.0.0") throw new Error(`Stage 7 accepts only canonical schema 4.0.0: ${file}`); const validation = require("../../../shared/artifacts/src/canonical/validation.js").validateCanonicalStageResult(value); if (!validation.ok) throw new Error(`Invalid canonical prior artifact: ${validation.errors.join("; ")}`); return value; }

function requireArray(value, name) { if (!Array.isArray(value)) throw new Error(`${name} must be an array`); return value; }

function buildStage7(request, dependencies = {}) {
  if (Number(request?.stage) !== 7) throw new Error("Stage 7 requires stage: 7");
  const priorArtifacts = requireArray(request.priorArtifacts, "priorArtifacts"); if (!priorArtifacts.length) throw new Error("Stage 7 requires priorArtifacts");
  const artifactBase = dependencies.artifactBase || process.cwd();
  const prior = priorArtifacts.map((file) => ({ file, result: readJson(path.resolve(artifactBase, file)) }));
  if (Array.isArray(request.evidenceIndex) && request.evidenceIndex.length) throw new Error("Stage 7 evidenceIndex must be supplied through bounded canonical evidence selectors");
  const selections = (request.evidenceSelectors || []).map((selector) => { if (!selector.artifact) throw new Error("Each evidence selector requires artifact"); const selection = require("../../../shared/artifacts/src/query_stage_artifacts.js").queryStageArtifacts({ ...selector, artifact: path.resolve(artifactBase, selector.artifact) }); if (selection.truncated && selector.allowTruncated !== true) throw new Error(`Truncated evidence selector must be narrowed or explicitly marked allowTruncated: ${selector.artifact}`); return selection; });
  const selectedEvidence = mergeRows(selections.flatMap((selection) => selection.evidence));
  const planning = buildPlanningProjection(prior.map((item) => item.result));
  const retainedCoverage = { artifacts: prior.map((item) => ({ stage: item.result.stage, capabilities: item.result.facts.filter((fact) => fact.kind === "capability").map((capability) => capability.id) })), planning: Object.fromEntries(PLANNING_COLLECTIONS.map((name) => [name, planning[name].length])), evidenceSelectionTruncated: selections.some((selection) => selection.truncated) };
  const inherited = prior.flatMap((item) => item.result.facts.filter((fact) => fact.kind === "capability").map(({ kind, ...capability }) => capability));
  const overrides = new Map(normalizeCapabilities(request.capabilities || []).map((item) => [item.id, item]));
  const capabilityMap = new Map(normalizeCapabilities(inherited).map((item) => [item.id, item]));
  for (const [id, item] of overrides) capabilityMap.set(id, item);
  const capabilities = [...capabilityMap.values()];
  const collections = Object.fromEntries(PLANNING_COLLECTIONS.map((name) => [name, mergeRows([...(planning[name] || []), ...(request[name] || [])])]));
  const facts = normalizeReportModel({ ...request, ...collections, evidenceIndex: selectedEvidence, priorArtifacts, provenance: { ...(request.provenance || {}), priorArtifacts, retainedCoverage }, coverage: { ...(request.coverage || {}), retainedCoverage }, capabilities });
  const validation = validateReportModel(facts);
  if (!validation.ok) throw new Error(`Stage 7 report model validation failed: ${validation.errors.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
  return facts;
}

function buildSummary(facts, output) { return { schemaVersion: facts.schemaVersion, modelType: facts.modelType, stage: facts.stage, status: facts.status, output: path.resolve(output), canonicalDigest: facts.integrity.canonicalDigest, counts: { confirmed: facts.confirmedUsages.length, checkedNoUsage: facts.checkedNoUsage.length, referenceOnly: facts.referenceOnly.length, retainedArtifacts: facts.coverage.retainedCoverage.artifacts.length, capabilities: facts.capabilities.length, noise: facts.noise.length, openChecks: facts.openChecks.length }, nextStage: facts.transition["next stage"] }; }

function formatFacts(facts) { return canonicalJson(facts).trimEnd(); }

module.exports = { buildStage7, buildSummary, formatFacts, readJson };
