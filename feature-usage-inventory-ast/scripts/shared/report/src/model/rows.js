"use strict";
const MODEL_TYPE = "inventory-report-model";
const SCHEMA_VERSION = "2.0.0";
const STATUSES = new Set([
    "confirmed",
    "source-confirmed",
    "candidate",
    "checked-no-usage",
    "partial",
    "not-applicable",
    "unknown",
    "reference-only",
    "noise"
]);
const COLLECTIONS = [
    "ownership",
    "dictionary",
    "scenarios",
    "recipientFamilies",
    "criticalPaths",
    "referencePaths",
    "gaps",
    "implementationEntryPoints",
    "confirmedUsages",
    "checkedNoUsage",
    "referenceOnly",
    "noise",
    "limitations",
    "evidenceIndex"
];
const REQUIRED_FIELDS = [
    "modelType",
    "schemaVersion",
    "inventoryId",
    "stage",
    "status",
    "target",
    "scope",
    "provenance",
    "executiveSummary",
    "decisionStatus",
    "coverage",
    "capabilities",
    "stageExecution",
    "renderProfile",
    "openChecks",
    "transition",
    ...COLLECTIONS,
    "integrity"
];
const TOP_LEVEL_FIELDS = new Set(REQUIRED_FIELDS);
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function cleanText(value) {
    return String(value ?? "").trim();
}
function normalizeRefs(value) {
    return [
        ...new Set(asArray(value).map(cleanText).filter(Boolean))
    ].sort();
}
function normalizeRows(rows, prefix, defaultStatus) {
    return asArray(rows).map((row, index)=>{
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${prefix} row ${index + 1} must be an object`);
        const item = {
            ...row,
            id: cleanText(row.id) || `${prefix}-${String(index + 1).padStart(3, "0")}`
        };
        if (defaultStatus && !item.status) item.status = defaultStatus;
        if (item.status && !STATUSES.has(item.status)) {
            const { normalizeStatus, DECISION_CATEGORIES } = require("../../../dto/src/planning_contract.js");
            item.originalStatus = item.originalStatus || item.status;
            if (DECISION_CATEGORIES.has(item.status)) item.category = item.category || item.status;
            item.status = normalizeStatus(item.status);
        }
        for (const key of [
            "evidenceRefs",
            "scenarioRefs",
            "recipientRefs",
            "pathRefs",
            "gapRefs",
            "capabilityRefs",
            "testSurfaceRefs",
            "expectedNames",
            "anchors",
            "performedChecks",
            "ordersChecked",
            "linkingMethodsChecked"
        ])if (key in item) item[key] = normalizeRefs(item[key]);
        return item;
    }).sort((a, b)=>a.id.localeCompare(b.id));
}
module.exports = {
    COLLECTIONS,
    MODEL_TYPE,
    SCHEMA_VERSION,
    cleanText,
    asArray,
    normalizeRefs,
    normalizeRows,
    REQUIRED_FIELDS,
    TOP_LEVEL_FIELDS,
    STATUSES
};
