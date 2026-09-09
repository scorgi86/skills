"use strict";
const crypto = require("node:crypto");
const { receiptErrors, requirementErrors } = require("./checks.js");
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
    if (value?.status === "closed" && (value?.openChecks?.length || value?.summary?.closure?.ok === false || value?.summary?.closure?.errors?.length)) errors.push("closed canonical result contains blockers; reissue the artifact and dependent downstream digests after resolving checks/gates");
    for (const receipt of (Array.isArray(value?.facts) ? value.facts : []).filter(row => row?.kind === "check-resolution")) errors.push(...receiptErrors(receipt, new Set(value.evidenceRefs || []), value.summary?.repositoryScope || undefined, { requirements: value.summary?.checkRequirements || [], facts: value.facts }));
    if (value?.summary?.checkRequirements !== undefined) {
        errors.push(...requirementErrors(value.summary.checkRequirements));
        if (Array.isArray(value.summary.checkRequirements)) for (const row of value.summary.checkRequirements) {
            if (!value.openChecks?.includes(row?.check) && !value.facts?.some(fact => fact.kind === "check-resolution" && fact.check === row?.check)) errors.push(`checkRequirements has no open question or resolution: ${row?.check}`);
        }
    }
    if (value?.summary?.checkOrigins !== undefined) {
        if (!Array.isArray(value.summary.checkOrigins) || value.summary.checkOrigins.some(row => !row || typeof row.check !== "string" || !value.openChecks?.includes(row.check) || !/^[a-f0-9]{64}$/.test(row.originDigest || ""))) errors.push("summary.checkOrigins must bind current openChecks to sha256 origins");
    }
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
