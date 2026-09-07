"use strict";
const { COLLECTIONS } = require("./rows.js");
const PROFILE_FIELDS = ["requiredCollections", "notApplicable", "requiredCriticalPaths", "notApplicableCriticalPaths"];
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

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
    for (const key of ["requiredCollections", "requiredCriticalPaths"]) {
        const values = profile[key] ?? [];
        if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
            add(`coverage.profile.${key}`, "Expected non-empty string array");
            continue;
        }
        if (new Set(values).size !== values.length) add(`coverage.profile.${key}`, "Coverage requirements must be unique");
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
            if (typeof reason !== "string" || !reason.trim()) add(`coverage.profile.${key}.${name}`, "Not-applicable requires a non-empty justification");
            if (!Array.isArray(profile[required]) || !profile[required].includes(name)) add(`coverage.profile.${key}.${name}`, "Not-applicable must identify a declared requirement");
        }
    }
    return { ok: errors.length === 0, errors };
}

function normalizeCoverageProfile(profile) {
    const validation = validateCoverageProfile(profile);
    if (!validation.ok) throw new Error(validation.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
    return {
        requiredCollections: [...(profile.requiredCollections || [])].sort(),
        notApplicable: { ...(profile.notApplicable || {}) },
        requiredCriticalPaths: [...(profile.requiredCriticalPaths || [])].sort(),
        notApplicableCriticalPaths: { ...(profile.notApplicableCriticalPaths || {}) }
    };
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
    const terminal = (row) => isObject(row) && (["confirmed", "source-confirmed", "checked-no-usage"].includes(row.status) ||
        (row.status === "not-applicable" && typeof row.reason === "string" && row.reason.trim()));
    for (const name of profile.requiredCollections) {
        if (!profile.notApplicable[name] && (!Array.isArray(model[name]) || !model[name].length || model[name].some((row) => !terminal(row)))) {
            add("coverage-required", name, `Required collection ${name} needs complete research or a justified profile N/A`);
        }
    }
    for (const key of profile.requiredCriticalPaths) {
        if (!profile.notApplicableCriticalPaths[key] && !(Array.isArray(model.criticalPaths) ? model.criticalPaths : []).some((row) => (row?.coverageKey || row?.id) === key && terminal(row))) {
            add("critical-path-required", "criticalPaths", `Mandatory lifecycle path ${key} needs complete research or a justified profile N/A`);
        }
    }
    return errors;
}

module.exports = { validateCoverageProfile, normalizeCoverageProfile, coverageErrors };
