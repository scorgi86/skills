"use strict";
const { absenceProjection } = require("../model/projection.js");
const { REQUIRED_BUNDLE_DOCUMENTS } = require("./documents.js");
function validateInventoryBundle(documents, options = {}) {
    const strict = options.strict === true;
    const result = {
        ok: true,
        strict,
        errors: [],
        warnings: [],
        documents: REQUIRED_BUNDLE_DOCUMENTS.slice()
    };
    if (!documents || typeof documents !== "object" || Array.isArray(documents)) {
        result.errors.push("Bundle must be an object keyed by report document path");
        result.ok = false;
        return result;
    }
    const names = Object.keys(documents).sort();
    for (const name of REQUIRED_BUNDLE_DOCUMENTS){
        if (!Object.prototype.hasOwnProperty.call(documents, name)) result.errors.push(`Bundle is missing required document: ${name}`);
        else if (typeof documents[name] !== "string" || !documents[name].trim()) result.errors.push(`Bundle document is empty: ${name}`);
    }
    for (const name of names)if (!REQUIRED_BUNDLE_DOCUMENTS.includes(name)) result.errors.push(`Bundle contains unexpected document: ${name}`);
    const expectedTitles = {
        "decision-report.md": /^# Инвентаризация:/m,
        "implementation-map.md": /^# Карта реализации:/m,
        "evidence.md": /^# Доказательная база:/m
    };
    for (const name of REQUIRED_BUNDLE_DOCUMENTS){
        const raw = documents[name];
        if (typeof raw !== "string") continue;
        if (!expectedTitles[name].test(raw)) result.errors.push(`${name} has an invalid report title`);
        for (const label of [
            "Что показывает:",
            "Зачем нужна:",
            "Как читать:",
            "Как использовать:"
        ]){
            if (!raw.includes(label)) result.errors.push(`${name} is missing ${label}`);
        }
    }
    const model = options.model;
    if (model) {
        const containsId = (raw, id)=>new RegExp(`(^|[^\\p{L}\\p{N}_-])${String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`, "mu").test(raw);
        const checks = {
            "decision-report.md": [
                ...model.confirmedUsages || [],
                ...model.gaps || [],
                ...model.limitations || [],
                ...model.capabilities || []
            ],
            "implementation-map.md": [
                ...model.ownership || [],
                ...model.dictionary || [],
                ...model.scenarios || [],
                ...model.recipientFamilies || [],
                ...model.criticalPaths || [],
                ...model.referencePaths || [],
                ...model.implementationEntryPoints || []
            ],
            "evidence.md": [
                ...model.evidenceIndex || [],
                ...model.confirmedUsages || [],
                ...model.checkedNoUsage || [],
                ...model.referenceOnly || [],
                ...model.noise || []
            ]
        };
        for (const [name, rows] of Object.entries(checks)){
            const raw = documents[name] || "";
            for (const row of rows)if (!containsId(raw, row.id)) result.errors.push(`${name} is missing ${row.id}`);
        }
        const evidence = documents["evidence.md"] || "";
        const referenced = new Set();
        for (const collection of [
            model.confirmedUsages,
            model.checkedNoUsage,
            model.recipientFamilies,
            model.criticalPaths,
            model.gaps,
            model.implementationEntryPoints
        ]){
            for (const row of collection || [])for (const id of row.evidenceRefs || [])referenced.add(id);
        }
        for (const id of referenced)if (!containsId(evidence, id)) result.errors.push(`evidence.md does not resolve evidence reference ${id}`);
        for (const projected of absenceProjection(model)){
            const expectedRow = `| ${projected.map((value)=>String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ")} |`;
            if (!evidence.includes(expectedRow)) result.errors.push(`evidence.md does not preserve the complete absence row for ${projected[0]}`);
        }
    }
    if (strict && result.warnings.length) result.errors.push(...result.warnings.map((warning)=>`STRICT: ${warning}`));
    result.ok = result.errors.length === 0;
    return result;
}
module.exports = {
    validateInventoryBundle
};
