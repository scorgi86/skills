"use strict";

const COLLECTION_BY_KIND = Object.freeze({
  ownership: "ownership",
  "ownership-node": "ownership",
  "ownership-edge": "ownership",
  dictionary: "dictionary",
  scenario: "scenarios",
  "recipient-family": "recipientFamilies",
  "critical-path": "criticalPaths",
  "reference-path": "referencePaths",
  gap: "gaps",
  "implementation-entry": "implementationEntryPoints",
  "confirmed-usage": "confirmedUsages",
  "checked-no-usage": "checkedNoUsage",
  "reference-only": "referenceOnly",
  noise: "noise",
  limitation: "limitations",
});

const PLANNING_COLLECTIONS = [...new Set(Object.values(COLLECTION_BY_KIND))];
const PRIMARY_KIND_BY_COLLECTION = Object.freeze(Object.entries(COLLECTION_BY_KIND).reduce((result, [kind, collection]) => ({ ...result, [collection]: result[collection] || kind }), {}));
const REFERENCE_FIELDS = ["evidenceRefs", "scenarioRefs", "recipientRefs", "pathRefs", "gapRefs", "capabilityRefs", "testSurfaceRefs"];

function normalizeStatus(status) {
  if (["confirmed", "checked-no-usage", "not-applicable", "reference-only", "noise", "partial", "unknown"].includes(status)) return status;
  if (["source-confirmed", "closed", "matched"].includes(status)) return "confirmed";
  if (["candidate", "candidate-empty", "unverified", "unchecked"].includes(status)) return status === "candidate" ? "partial" : "unknown";
  return status || "unknown";
}
function unique(values) { return [...new Set((values || []).filter(Boolean).map(String))].sort(); }
function normalizePlanningFact(fact, stage, index) {
  const collection = COLLECTION_BY_KIND[fact?.kind];
  if (!collection) return null;
  const row = { ...fact, id: String(fact.id || `${fact.kind}-stage-${stage}-${index + 1}`), status: normalizeStatus(fact.status), sourceStage: Number(stage) };
  delete row.kind;
  for (const field of REFERENCE_FIELDS) if (field in row) row[field] = unique(row[field]);
  return { collection, row };
}
function mergeRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    const previous = byId.get(row.id);
    if (!previous) byId.set(row.id, row);
    else {
      const merged = { ...previous, ...row };
      for (const field of REFERENCE_FIELDS) if (field in previous || field in row) merged[field] = unique([...(previous[field] || []), ...(row[field] || [])]);
      if (previous.sourceStage != null || row.sourceStage != null || previous.sourceStages || row.sourceStages) {
        merged.sourceStages = unique([...(previous.sourceStages || [previous.sourceStage]), ...(row.sourceStages || [row.sourceStage])]).map(Number).sort((a, b) => a - b);
        delete merged.sourceStage;
      }
      byId.set(row.id, merged);
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function buildPlanningProjection(stageResults = []) {
  const projection = Object.fromEntries(PLANNING_COLLECTIONS.map((name) => [name, []]));
  for (const result of stageResults) for (const [index, fact] of (result?.facts || []).entries()) {
    const normalized = normalizePlanningFact(fact, result.stage, index);
    if (normalized) projection[normalized.collection].push(normalized.row);
  }
  for (const name of PLANNING_COLLECTIONS) projection[name] = mergeRows(projection[name]);
  return projection;
}

module.exports = { COLLECTION_BY_KIND, PLANNING_COLLECTIONS, PRIMARY_KIND_BY_COLLECTION, REFERENCE_FIELDS, buildPlanningProjection, mergeRows, normalizePlanningFact, normalizeStatus };
