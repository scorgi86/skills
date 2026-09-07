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

const DECISION_CATEGORIES = new Set(["product-gap", "implementation-gap", "open-product-decision", "known", "requires-change", "requires-implementation", "design-decision", "reference-pattern", "existing", "missing", "blocked", "implementation-required"]);
function normalizeStatus(status) {
  if (["confirmed", "checked-no-usage", "not-applicable", "reference-only", "noise", "partial", "unknown", "candidate"].includes(status)) return status;
  if (status === "source-confirmed") return "confirmed";
  if (["matched", "candidate-empty"].includes(status)) return "candidate";
  if (["closed", "unverified", "unchecked", "unresolved", "tool-unavailable", "pending", "not-checked"].includes(status) || DECISION_CATEGORIES.has(status) || status == null || status === "") return "unknown";
  throw new Error(`Unsupported planning status: ${status}; provide a proof status and keep product decisions in category`);
}
function unique(values) { return [...new Set((values || []).filter(value => value !== undefined && value !== null && value !== "").map(String))].sort(); }
function normalizePlanningFact(fact, stage, index) {
  const collection = COLLECTION_BY_KIND[fact?.kind];
  if (!collection) return null;
  const row = { ...fact, id: String(fact.id || `${fact.kind}-stage-${stage}-${index + 1}`), status: normalizeStatus(fact.status), sourceStage: Number(stage), ...(fact.status ? { originalStatus: fact.status } : {}), ...(DECISION_CATEGORIES.has(fact.status) ? { category: fact.category || fact.status } : {}) };
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
      const conflicts = [...(previous.conflicts || []), ...(row.conflicts || [])];
      for (const field of Object.keys(previous)) {
        if ([...REFERENCE_FIELDS, "sourceStage", "sourceStages", "conflicts", "roles", "provenance"].includes(field) || !(field in row)) continue;
        if (JSON.stringify(previous[field]) !== JSON.stringify(row[field])) conflicts.push({ field, values: [previous[field], row[field]], sourceStages: [previous.sourceStage, row.sourceStage].filter(x => x != null) });
      }
      if (conflicts.length) merged.conflicts = [...new Map(conflicts.map(x => [JSON.stringify(x), x])).values()];
      if (previous.role || row.role || previous.roles || row.roles) merged.roles = unique([...(previous.roles || []), previous.role, ...(row.roles || []), row.role]);
      if (previous.provenance || row.provenance) merged.provenance = [...new Map([...(Array.isArray(previous.provenance) ? previous.provenance : previous.provenance ? [previous.provenance] : []), ...(Array.isArray(row.provenance) ? row.provenance : row.provenance ? [row.provenance] : [])].map(x => [JSON.stringify(x), x])).values()];
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

module.exports = { DECISION_CATEGORIES, COLLECTION_BY_KIND, PLANNING_COLLECTIONS, PRIMARY_KIND_BY_COLLECTION, REFERENCE_FIELDS, buildPlanningProjection, mergeRows, normalizePlanningFact, normalizeStatus };
