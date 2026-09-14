"use strict";
const { COLLECTIONS, hasMeaningfulText } = require("./rows.js");
const { IDS: CAPABILITY_IDS } = require("../../../dto/src/capability_contract.js");
const PROFILE_FIELDS = ["kind", "requiredCapabilities", "requiredCollections", "notApplicable", "requiredCriticalPaths", "notApplicableCriticalPaths"];
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const NOT_APPLICABLE_REASON_CODES = new Set(["task-scope", "repository-scope", "architecture"]);

function validNotApplicableReason(value) {
    return isObject(value) && NOT_APPLICABLE_REASON_CODES.has(value.reasonCode) && hasMeaningfulText(value.explanation);
}

function hasScenarioContent(row) {
    return hasMeaningfulText(row.entry) && Array.isArray(row.steps) && row.steps.length > 0 && row.steps.every(hasMeaningfulText) && hasMeaningfulText(row.result);
}

function validateCoverageProfile(profile) {
    const errors = [];
    const add = (path, message) => errors.push({ code: "coverage-profile", path, message });
    if (!isObject(profile)) {
        add("coverage.profile", "Coverage profile must be an object");
        return { ok: false, errors };
    }
    for (const key of Object.keys(profile)) {
        if (!PROFILE_FIELDS.includes(key)) add(`coverage.profile.${key}`, "Unknown coverage profile field");
    }
    if (profile.kind !== undefined && !["full-inventory", "full-development", "bounded"].includes(profile.kind)) add("coverage.profile.kind", "Expected full-inventory, full-development, or bounded kind");
    if (["full-inventory", "full-development"].includes(profile.kind)) {
        for (const id of CAPABILITY_IDS) if (!Array.isArray(profile.requiredCapabilities) || !profile.requiredCapabilities.includes(id)) add("coverage.profile.requiredCapabilities", `Full research requires capability ${id}`);
        const collections = ["scenarios", "criticalPaths", ...(profile.kind === "full-development" ? ["gaps", "implementationEntryPoints"] : [])];
        for (const name of collections) if (!Array.isArray(profile.requiredCollections) || !profile.requiredCollections.includes(name)) add("coverage.profile.requiredCollections", `Research kind ${profile.kind} requires ${name}`);
    }
    for (const key of ["requiredCapabilities", "requiredCollections", "requiredCriticalPaths"]) {
        const values = profile[key] ?? [];
        if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
            add(`coverage.profile.${key}`, "Expected non-empty string array");
            continue;
        }
        if (new Set(values).size !== values.length) add(`coverage.profile.${key}`, "Coverage requirements must be unique");
        if (key === "requiredCapabilities") {
            for (const id of values) if (!CAPABILITY_IDS.has(id)) add(`coverage.profile.${key}`, `Unknown capability: ${id}`);
        }
        if (key === "requiredCollections") {
            for (const name of values) {
                if (!COLLECTIONS.includes(name)) add(`coverage.profile.${key}`, `Unknown collection: ${name}`);
            }
        }
    }
    for (const [key, required] of [["notApplicable", "requiredCollections"], ["notApplicableCriticalPaths", "requiredCriticalPaths"]]) {
        const values = profile[key] ?? {};
        if (!isObject(values)) {
            add(`coverage.profile.${key}`, "Expected reasons keyed by coverage requirement");
            continue;
        }
        for (const [name, reason] of Object.entries(values)) {
            const legacy = !Object.prototype.hasOwnProperty.call(profile, "requiredCapabilities");
            const structured = validNotApplicableReason(reason) && Object.keys(reason).every((field) => ["reasonCode", "explanation"].includes(field));
            if (!(legacy ? hasMeaningfulText(reason) || structured : structured)) add(`coverage.profile.${key}.${name}`, "Not-applicable requires reasonCode (task-scope, repository-scope, or architecture) and a non-empty explanation");
            if (!Array.isArray(profile[required]) || !profile[required].includes(name)) add(`coverage.profile.${key}.${name}`, "Not-applicable must identify a declared requirement");
        }
    }
    return { ok: errors.length === 0, errors };
}

function normalizeCoverageProfile(profile) {
    const validation = validateCoverageProfile(profile);
    if (!validation.ok) throw new Error(validation.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
    return {
        ...(profile.kind === undefined ? {} : { kind: profile.kind }),
        ...(Object.prototype.hasOwnProperty.call(profile, "requiredCapabilities") ? { requiredCapabilities: [...profile.requiredCapabilities] } : {}),
        requiredCollections: [...(profile.requiredCollections || [])].sort(),
        notApplicable: Object.fromEntries(Object.entries(profile.notApplicable || {}).map(([key, value]) => [key, isObject(value) ? { reasonCode: value.reasonCode, explanation: value.explanation.trim() } : value])),
        requiredCriticalPaths: [...(profile.requiredCriticalPaths || [])].sort(),
        notApplicableCriticalPaths: Object.fromEntries(Object.entries(profile.notApplicableCriticalPaths || {}).map(([key, value]) => [key, isObject(value) ? { reasonCode: value.reasonCode, explanation: value.explanation.trim() } : value]))
    };
}

function normalizeNewCoverageProfile(profile) {
    const normalized = normalizeCoverageProfile(profile);
    if (!normalized.requiredCapabilities?.length) throw new Error("Stage 0 coverageProfile requires at least one requiredCapabilities id");
    if (normalized.kind === undefined) throw new Error("New Stage 0 coverageProfile requires an explicit kind: full-inventory, full-development, or bounded");
    return normalized;
}

function coverageErrors(model) {
    const errors = [];
    const add = (code, path, message) => errors.push({ code, path, message });
    const coverage = model.coverage || {};
    if (coverage.status && !["complete", "confirmed", "not-applicable"].includes(coverage.status)) {
        add("research-incomplete", "coverage.status", `Research coverage is ${coverage.status}; complete required checks before closing Stage 7`);
    }
    if (coverage.retainedCoverage?.evidenceSelectionTruncated === true) {
        add("research-incomplete", "coverage.retainedCoverage.evidenceSelectionTruncated", "Truncated evidence selection cannot close the report");
    }
    // Saved legacy models remain readable; new execution binds this profile at Stage 0.
    if (coverage.profile === undefined) return errors;
    const validation = validateCoverageProfile(coverage.profile);
    if (!validation.ok) return [...errors, ...validation.errors];
    const profile = normalizeCoverageProfile(coverage.profile);
    const structuredProfile = Object.prototype.hasOwnProperty.call(profile, "requiredCapabilities");
    const full = ["full-inventory", "full-development"].includes(profile.kind);
    const terminal = (row) => isObject(row) && (["confirmed", "source-confirmed", "checked-no-usage"].includes(row.status) ||
        (row.status === "not-applicable" && (structuredProfile ? validNotApplicableReason(row) : hasMeaningfulText(row.reason) || validNotApplicableReason(row))));
    const meaningful = (row, fields) => fields.some((field) => Array.isArray(row?.[field])
        ? row[field].some(hasMeaningfulText)
        : hasMeaningfulText(row?.[field]));
    const contentFields = {
        scenarios: ["name", "title", "statement", "description", "steps", "reason", "explanation"],
        criticalPaths: ["statement", "description", "steps", "reason", "explanation"],
        gaps: ["statement", "description", "detail", "reason", "explanation"],
        implementationEntryPoints: ["path", "file", "symbol", "object", "method", "property", "command", "api", "recipient", "renderingPath", "persistencePath", "test", "searchScope", "reason", "explanation"]
    };
    if (structuredProfile) {
        const capabilities = new Map((Array.isArray(model.capabilities) ? model.capabilities : []).map((row) => [row?.id, row]));
        for (const id of profile.requiredCapabilities) {
            const row = capabilities.get(id);
            if (!row) add("capability-required", `capabilities[${id}]`, `Required capability ${id} is missing`);
            else {
                if (row.requiredForFinalReport !== true) add("capability-required", `capabilities[${id}].requiredForFinalReport`, `Required capability ${id} must remain required in the final model`);
                if (!terminal(row)) add("capability-open", `capabilities[${id}].status`, `Required capability ${id} must be confirmed, checked-no-usage, or justified not-applicable`);
            }
        }
    }
    for (const name of profile.requiredCollections) {
        const rows = Array.isArray(model[name]) ? model[name] : [];
        if (!profile.notApplicable[name] && (!rows.length || rows.some((row) => !terminal(row)))) {
            add("coverage-required", name, `Required collection ${name} needs complete research or a justified profile N/A`);
        }
        if (!profile.notApplicable[name] && contentFields[name]) {
            for (const row of rows) if (terminal(row) && !meaningful(row, contentFields[name])) {
                add("coverage-content", `${name}[${row?.id || "unknown"}]`, `Required ${name} row ${row?.id || "unknown"} needs meaningful content`);
            }
        }
        if (full && name === "scenarios" && !profile.notApplicable[name]) {
            for (const row of rows) if (terminal(row) && row.status !== "not-applicable" &&
                !hasScenarioContent(row)) {
                add("scenario-content", `scenarios[${row?.id || "unknown"}]`, "Full research scenario requires entry, non-empty steps, and result describing the outcome or checked break");
            }
        }
    }
    if (profile.requiredCollections.includes("gaps") && profile.requiredCollections.includes("implementationEntryPoints") && !profile.notApplicable.gaps && !profile.notApplicable.implementationEntryPoints) {
        const linked = new Set((Array.isArray(model.implementationEntryPoints) ? model.implementationEntryPoints : []).flatMap((row) => Array.isArray(row?.gapRefs) ? row.gapRefs : []));
        for (const row of Array.isArray(model.gaps) ? model.gaps : []) if (["implementation-gap", "test-gap"].includes(row?.category) && !linked.has(row.id)) {
            add("gap-unlinked", `gaps[${row.id || "unknown"}].gapRefs`, `Required ${row.category} ${row.id || "unknown"} must be linked from an implementation entry point`);
        }
    }
    for (const key of profile.requiredCriticalPaths) {
        if (!profile.notApplicableCriticalPaths[key]) {
            const row = (Array.isArray(model.criticalPaths) ? model.criticalPaths : []).find((item) => (item?.coverageKey || item?.id) === key && terminal(item));
            if (!row) add("critical-path-required", "criticalPaths", `Mandatory lifecycle path ${key} needs complete research or a justified profile N/A`);
            else if (!meaningful(row, contentFields.criticalPaths)) add("coverage-content", `criticalPaths[${row.id || key}]`, `Mandatory lifecycle path ${key} needs meaningful content`);
        }
    }
    return errors;
}

module.exports = { NOT_APPLICABLE_REASON_CODES, validNotApplicableReason, hasScenarioContent, validateCoverageProfile, normalizeCoverageProfile, normalizeNewCoverageProfile, coverageErrors };
