"use strict";
const crypto = require("node:crypto");
const SCHEMA_VERSION = "4.0.0";
const CANONICAL_FIELDS = new Set([
    "schemaVersion",
    "stage",
    "status",
    "summary",
    "facts",
    "evidenceRefs",
    "openChecks",
    "metrics",
    "usage",
    "inputDigest",
    "outputDigest"
]);
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key)=>[
            key,
            stable(value[key])
        ]));
    return value;
}
function digest(value) {
    return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function validateCanonicalStageResult(value) {
    const errors = [];
    for (const field of CANONICAL_FIELDS)if (!Object.prototype.hasOwnProperty.call(value || {}, field)) errors.push(`required field is missing: ${field}`);
    for (const field of Object.keys(value || {}))if (!CANONICAL_FIELDS.has(field)) errors.push(`additional top-level field is not allowed: ${field}`);
    if (!value || value.schemaVersion !== SCHEMA_VERSION) errors.push("schemaVersion must be 4.0.0");
    if (!Number.isInteger(value?.stage) || value.stage < 0 || value.stage > 8) errors.push("stage must be 0..8");
    if (![
        "closed",
        "partial",
        "blocked"
    ].includes(value?.status)) errors.push("invalid status");
    if (!Array.isArray(value?.facts) || !Array.isArray(value?.evidenceRefs) || !Array.isArray(value?.openChecks)) errors.push("facts, evidenceRefs and openChecks must be arrays");
    else {
        if (value.facts.some((item)=>!item || typeof item !== "object" || Array.isArray(item))) errors.push("facts items must be objects");
        for (const field of [
            "evidenceRefs",
            "openChecks"
        ]){
            if (value[field].some((item)=>typeof item !== "string")) errors.push(`${field} items must be strings`);
            if (new Set(value[field]).size !== value[field].length) errors.push(`${field} items must be unique`);
        }
    }
    if (!value?.summary || typeof value.summary !== "object" || Array.isArray(value.summary) || !value?.metrics || typeof value.metrics !== "object" || Array.isArray(value.metrics)) errors.push("summary and metrics must be objects");
    for (const [index, fact] of (value?.facts || []).entries())if (fact?.status === "checked-no-usage") {
        for (const field of [
            "expectedNames",
            "performedChecks",
            "ordersChecked",
            "linkingMethodsChecked",
            "evidenceRefs"
        ])if (!Array.isArray(fact[field]) || !fact[field].length) errors.push(`facts[${index}].${field} is required for checked-no-usage`);
        for (const field of [
            "reason",
            "repository",
            "searchScope",
            "consequence"
        ])if (!String(fact[field] || "").trim()) errors.push(`facts[${index}].${field} is required for checked-no-usage`);
        if (fact.resultComplete !== true || fact.resultTruncated !== false) errors.push(`facts[${index}] checked-no-usage result must be complete and untruncated`);
    }
    if (!value?.usage || ![
        "supplied",
        "unavailable"
    ].includes(value.usage.status)) errors.push("usage status is invalid");
    else if (value.usage.status === "unavailable" && Object.keys(value.usage).join(",") !== "status") errors.push("unavailable usage may contain only status");
    else if (value.usage.status === "supplied") {
        const fields = [
            "status",
            "inputTokens",
            "cachedInputTokens",
            "outputTokens",
            "reasoningTokens",
            "totalTokens",
            "provider",
            "requestId"
        ], keys = Object.keys(value.usage);
        if (keys.length !== fields.length || fields.some((field)=>!keys.includes(field))) errors.push("supplied usage requires the exact telemetry fields");
        for (const field of fields.slice(1, 6))if (!Number.isInteger(value.usage[field]) || value.usage[field] < 0) errors.push(`usage.${field} must be a non-negative integer`);
        if (typeof value.usage.provider !== "string" || !value.usage.provider.length || typeof value.usage.requestId !== "string" || !value.usage.requestId.length) errors.push("supplied usage requires non-empty string provider and requestId");
    }
    if (!/^[a-f0-9]{64}$/.test(value?.inputDigest || "") || !/^[a-f0-9]{64}$/.test(value?.outputDigest || "")) errors.push("digests must be sha256");
    if (!errors.length && digest({
        ...value,
        outputDigest: undefined
    }) !== value.outputDigest) errors.push("outputDigest mismatch");
    return {
        ok: errors.length === 0,
        errors
    };
}
module.exports = {
    SCHEMA_VERSION,
    digest,
    validateCanonicalStageResult
};
