"use strict";
const { COLLECTION_BY_KIND, PRIMARY_KIND_BY_COLLECTION, PLANNING_COLLECTIONS, buildPlanningProjection, mergePlanningRows, planningError } = require("../../../shared/dto/src/planning_contract.js");
const { canonicalFacts } = require("../../../shared/artifacts/src/canonical/facts.js");
const { normalizeLimitations } = require("../../../shared/artifacts/src/limitations.js");
const { sourceSurfaceIdentity } = require("../../../shared/dto/src/source_surface_identity.js");
const { hasScenarioContent } = require("../../../shared/report/src/model/coverage.js");
const { confirmationOf } = require("../../../shared/evidence/src/canonicalization/source_confirmation.js");
const { SourceSnapshotStore } = require("../../../shared/evidence/src/source_snapshot.js");

function carryPlanningFacts(request, produced, priorResults = []) {
  const result = { ...produced };
  const byId = new Map();
  for (const [collection, rows] of Object.entries(buildPlanningProjection(priorResults))) {
    for (const row of rows) {
      const entries = byId.get(row.id) || [];
      entries.push({ collection, row }); byId.set(row.id, entries);
    }
  }
  function merge(collection, rows) {
    const current = mergePlanningRows(rows, collection);
    return current.map(row => {
      const previous = byId.get(row.id) || [];
      if (previous.some(entry => entry.collection !== collection)) planningError(collection, row.id, "id", "Id is already used by another planning collection");
      const merged = mergePlanningRows([...previous.map(entry => entry.row), row], collection)[0];
      byId.set(row.id, [{ collection, row: merged }]);
      return merged;
    });
  }
  if (Array.isArray(result.canonicalFacts)) {
    const groups = new Map();
    for (const fact of result.canonicalFacts) {
      const collection = COLLECTION_BY_KIND[fact.kind];
      if (collection) groups.set(collection, [...groups.get(collection) || [], fact]);
    }
    const merged = new Map([...groups].flatMap(([collection, rows]) => merge(collection, rows).map(row => [`${collection}\0${row.id}`, row])));
    const seen = new Set();
    result.canonicalFacts = result.canonicalFacts.flatMap(fact => {
      const collection = COLLECTION_BY_KIND[fact.kind];
      if (!collection) return [fact];
      const key = `${collection}\0${fact.id}`;
      if (seen.has(key)) return [];
      seen.add(key); return [{ ...merged.get(key), kind: fact.kind }];
    });
    return result;
  }
  if (result.modelType === "inventory-report-model") return result;
  function values(facts, collection) {
    if (collection === "ownership" && !Array.isArray(facts.ownership)) return facts.ownership?.groups || [];
    if (collection === "recipientFamilies" && !Array.isArray(facts.recipientFamilies)) return facts.families || [];
    return Array.isArray(facts[collection]) ? facts[collection] : [];
  }
  function mergeEmitted(rows, defaultKind) {
    const groups = new Map(), unrecognized = [];
    for (const row of rows) {
      const collection = COLLECTION_BY_KIND[{ kind: defaultKind, ...row }.kind];
      if (!collection) unrecognized.push(row);
      else groups.set(collection, [...groups.get(collection) || [], row]);
    }
    return [...groups].flatMap(([collection, entries]) => merge(collection, entries)).concat(unrecognized);
  }
  for (const collection of PLANNING_COLLECTIONS) {
    const rows = [...values(request, collection), ...values(produced, collection)];
    if (!rows.length) continue;
    const merged = mergeEmitted(collection === "limitations" ? normalizeLimitations(rows) : rows, PRIMARY_KIND_BY_COLLECTION[collection]);
    if (collection === "ownership" && produced.ownership && !Array.isArray(produced.ownership)) result.ownership = { ...produced.ownership, groups: merged };
    else if (collection === "recipientFamilies" && !produced.recipientFamilies && produced.families && !request.recipientFamilies) result.families = merged;
    else result[collection] = merged;
  }
  if (produced.ownershipGraph) result.ownershipGraph = { ...produced.ownershipGraph,
    nodes: mergeEmitted(produced.ownershipGraph.nodes || [], "ownership-node"), edges: mergeEmitted(produced.ownershipGraph.edges || [], "ownership-edge") };
  if (produced.sourceSurfaces) {
    const surfaces = produced.sourceSurfaces.map(surface => sourceSurfaceIdentity(surface, request.repositoryScope || produced.repositoryScope));
    result.sourceSurfaces = Number(produced.stage) === 6 ? merge("referencePaths", surfaces) : surfaces;
  }
  // Check emitted kinds as well as the collection fields: row.kind may select a different collection.
  for (const fact of canonicalFacts({ ...result, repositoryScope: request.repositoryScope || produced.repositoryScope })) {
    const collection = COLLECTION_BY_KIND[fact.kind];
    if (collection) merge(collection, [fact]);
  }
  return result;
}

function assertPlanningOutput(facts, evidence, profile, sourceSnapshots, suppliedFacts) {
  const byId = new Map(evidence.map(row => [row.id, row]));
  const suppliedIds = suppliedFacts && new Set(suppliedFacts.map(fact => JSON.stringify([fact.kind, fact.id])));
  const sourceContext = { repositoryScope: facts.repositoryScope, sourceSnapshots: sourceSnapshots || new SourceSnapshotStore() };
  const sourceStates = new Map();
  const fullScenarios = ["full-inventory", "full-development"].includes(profile?.kind) && profile.requiredCollections?.includes("scenarios") && !profile.notApplicable?.scenarios;
  for (const fact of canonicalFacts(facts)) {
    if (suppliedIds && !suppliedIds.has(JSON.stringify([fact.kind, fact.id]))) continue;
    const collection = fact.kind === "capability" ? "capabilities" : COLLECTION_BY_KIND[fact.kind];
    if (!collection) continue;
    if (fullScenarios && collection === "scenarios" && ["confirmed", "source-confirmed", "checked-no-usage"].includes(fact.status) && !hasScenarioContent(fact)) {
      planningError(collection, fact.id, "entry/steps/result", "Full research scenario requires entry, non-empty meaningful steps and result");
    }
    if (!["confirmed", "source-confirmed"].includes(fact.status)) continue;
    if (!Array.isArray(fact.evidenceRefs) || !fact.evidenceRefs.length) planningError(collection, fact.id, "evidenceRefs", "Confirmed claim requires source-confirmed evidence");
    for (const ref of fact.evidenceRefs) {
      const proof = byId.get(ref);
      if ((proof?.status || proof?.confirmation?.status) !== "source-confirmed") planningError(collection, fact.id, "evidenceRefs", `Unresolved or non-source-confirmed evidence: ${ref}`);
      if (!sourceStates.has(ref)) sourceStates.set(ref, confirmationOf(proof, sourceContext));
      const state = sourceStates.get(ref);
      if (state.status !== "source-confirmed") planningError(collection, fact.id, "evidenceRefs", `Stale or invalid source anchor: ${ref}`);
    }
  }
}

module.exports = { carryPlanningFacts, assertPlanningOutput };
