"use strict";
const crypto = require("node:crypto");
const { normalizeCapabilities } = require("./capability_contract");
const MODEL_TYPE = "inventory-report-model";
const SCHEMA_VERSION = "1.0.0";
const STATUSES = new Set(["confirmed", "checked-no-usage", "partial", "not-applicable", "unknown", "reference-only", "noise"]);
const COLLECTIONS = ["ownership", "dictionary", "scenarios", "recipientFamilies", "criticalPaths", "referencePaths", "gaps", "implementationEntryPoints", "confirmedUsages", "checkedNoUsage", "referenceOnly", "noise", "limitations", "evidenceIndex"];
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); }
function canonicalJson(value) { return `${JSON.stringify(stable(value), null, 2)}\n`; }
function digest(value) { return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function cleanText(value) { return String(value ?? "").trim(); }
function normalizeRefs(value) { return [...new Set(asArray(value).map(cleanText).filter(Boolean))].sort(); }
function normalizeRows(rows, prefix, defaultStatus) { return asArray(rows).map((row, index) => { if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${prefix} row ${index + 1} must be an object`); const item = { ...row, id: cleanText(row.id) || `${prefix}-${String(index + 1).padStart(3, "0")}` }; if (defaultStatus && !item.status) item.status = defaultStatus; for (const key of ["evidenceRefs", "recipientRefs", "pathRefs", "gapRefs", "capabilityRefs", "expectedNames", "anchors"]) if (key in item) item[key] = normalizeRefs(item[key]); return item; }).sort((a, b) => a.id.localeCompare(b.id)); }
function withoutIntegrity(model) { const copy = { ...model }; delete copy.integrity; return copy; }
function normalizeReportModel(input) {
  const model = { modelType: MODEL_TYPE, schemaVersion: SCHEMA_VERSION, inventoryId: cleanText(input.inventoryId) || `inventory:${cleanText(input.target).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "")}`, stage: 7, status: cleanText(input.status) || "closed", target: cleanText(input.target), scope: stable(input.scope || {}), provenance: stable(input.provenance || {}), executiveSummary: stable(input.executiveSummary || {}), decisionStatus: cleanText(input.decisionStatus) || (asArray(input.openChecks).length ? "partial" : "confirmed"), coverage: stable(input.coverage || {}), capabilities: normalizeCapabilities(input.capabilities || []).sort((a, b) => a.id.localeCompare(b.id)), stageExecution: stable(input.stageExecution || {}), renderProfile: stable(input.renderProfile || { documents: ["decision-report", "implementation-map", "evidence"] }), openChecks: normalizeRefs(input.openChecks), transition: stable(input.transition || { "next stage": "8" }) };
  const defaults = { confirmedUsages: "confirmed", checkedNoUsage: "checked-no-usage", referenceOnly: "reference-only", noise: "noise" };
  for (const name of COLLECTIONS) model[name] = normalizeRows(input[name], name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), defaults[name]);
  model.integrity = { algorithm: "sha256", canonicalDigest: digest(withoutIntegrity(model)) }; return model;
}
function validateReportModel(model) {
  const errors = [], add = (code, path, message) => errors.push({ code, path, message });
  if (!model || typeof model !== "object") return { ok: false, errors: [{ code: "type", path: "$", message: "Report model must be an object" }] };
  if (model.modelType !== MODEL_TYPE) add("model-type", "modelType", `Expected ${MODEL_TYPE}`); if (model.schemaVersion !== SCHEMA_VERSION) add("schema-version", "schemaVersion", `Expected ${SCHEMA_VERSION}`); if (model.stage !== 7) add("stage", "stage", "Canonical report model must be produced by Stage 7"); if (model.status !== "closed") add("status", "status", "Stage 7 model must be closed before Stage 8"); if (!cleanText(model.target)) add("required", "target", "Target is required"); if (!model.transition || String(model.transition["next stage"]) !== "8") add("transition", "transition.next stage", "Next stage must be 8"); if (!Array.isArray(model.capabilities) || !model.capabilities.length) add("coverage", "capabilities", "At least one capability is required");
  if (asArray(model.openChecks).length) add("open-checks", "openChecks", "Stage 7 cannot close while checks remain open; record non-blocking constraints as limitations");
  const ids = new Map();
  for (const name of COLLECTIONS) { if (!Array.isArray(model[name])) { add("type", name, "Collection must be an array"); continue; } for (const [index, row] of model[name].entries()) { const p = `${name}[${index}]`; if (!cleanText(row?.id)) add("required", `${p}.id`, "Stable id is required"); else if (ids.has(row.id)) add("duplicate-id", `${p}.id`, `Duplicate id also used at ${ids.get(row.id)}`); else ids.set(row.id, p); if (row?.status && !STATUSES.has(row.status)) add("enum", `${p}.status`, `Unsupported status: ${row.status}`); if (["confirmedUsages", "checkedNoUsage"].includes(name) && !asArray(row?.evidenceRefs).length) add("evidence", `${p}.evidenceRefs`, "Evidence references are required"); if (name === "checkedNoUsage" && !asArray(row?.expectedNames).length) add("absence-contract", `${p}.expectedNames`, "Expected names are required"); if (name === "checkedNoUsage" && !cleanText(row?.searchScope || row?.scope)) add("absence-contract", `${p}.searchScope`, "Search scope is required"); } }
  const evidenceIds = new Set(asArray(model.evidenceIndex).map((row) => row.id));
  const referenceSets = { evidenceRefs: evidenceIds, recipientRefs: new Set(asArray(model.recipientFamilies).map((row) => row.id)), pathRefs: new Set([...asArray(model.criticalPaths), ...asArray(model.referencePaths)].map((row) => row.id)), gapRefs: new Set(asArray(model.gaps).map((row) => row.id)), capabilityRefs: new Set(asArray(model.capabilities).map((row) => row.id)) };
  for (const name of COLLECTIONS) for (const [index, row] of asArray(model[name]).entries()) for (const [field, known] of Object.entries(referenceSets)) for (const ref of asArray(row[field])) if (!known.has(ref)) add("broken-ref", `${name}[${index}].${field}`, `Unknown referenced id: ${ref}`);
  const expectedDigest = digest(withoutIntegrity(model)); if (model.integrity?.algorithm !== "sha256" || model.integrity?.canonicalDigest !== expectedDigest) add("integrity", "integrity", "Canonical digest does not match model content");
  return { ok: errors.length === 0, errors, counts: Object.fromEntries(COLLECTIONS.map((name) => [name, asArray(model[name]).length])), canonicalDigest: expectedDigest };
}
module.exports = { COLLECTIONS, MODEL_TYPE, SCHEMA_VERSION, canonicalJson, digest, normalizeReportModel, stable, validateReportModel, withoutIntegrity };
