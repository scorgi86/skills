"use strict";
const { prepareFacts, normalizeStatus, canonicalFacts, unique, normalizeUsage, budgetMetrics } = require("./facts.js");
const { SCHEMA_VERSION, digest } = require("./validation.js");
const { closureErrors } = require("./checks.js");
function createCanonicalStageResult({ facts, input = {}, usage, metrics = {} }) {
    if (!facts || !Number.isInteger(Number(facts.stage))) throw new Error("Canonical stage result requires numeric facts.stage");
    facts = prepareFacts(facts);
    const rawBytes = Buffer.byteLength(JSON.stringify(facts));
    const result = {
        schemaVersion: SCHEMA_VERSION,
        stage: Number(facts.stage),
        status: normalizeStatus(facts.status),
        summary: {
            ...facts.summary || {},
            ...((facts.checkRequirements || facts.provenance?.checkRequirements) ? { checkRequirements: facts.checkRequirements || facts.provenance.checkRequirements } : {}),
            lineage: facts.summary?.lineage || facts.provenance?.lineage || [],
            checkHistory: facts.summary?.checkHistory || facts.provenance?.checkHistory || [],
            repositoryScope: facts.repositoryScope || facts.scope || null,
            closure: { ok: closureErrors(facts).length === 0, errors: closureErrors(facts) },
            stage: Number(facts.stage),
            status: facts.status || "unknown",
            target: facts.target || facts.transition?.fields?.target || null,
            scope: facts.scope || facts.transition?.fields?.scope || null,
            transition: facts.transition || null,
            reportModelDigest: facts.integrity?.canonicalDigest || null,
            input: facts.input || null
        },
        facts: canonicalFacts(facts),
        evidenceRefs: unique([
            ...facts.evidenceRefs || [],
            ...(facts.canonicalEvidence || []).map((item)=>item.id),
            ...(facts.capabilities || []).flatMap((item)=>item.evidenceRefs || [])
            ,...(facts.checkResolutions || facts.provenance?.checkResolutions || []).flatMap(item=>item.evidenceRefs || [])
        ]),
        openChecks: unique(facts.openChecks || []),
        metrics: {
            rawBytes,
            canonicalBytes: 0,
            artifactTextEstimate: {
                bytes: rawBytes,
                method: "serialized-json-bytes",
                isActualTokenUsage: false
            },
            ...facts.metrics || {},
            ...metrics
        },
        usage: normalizeUsage(usage),
        inputDigest: digest(input),
        outputDigest: "0".repeat(64)
    };
    result.metrics.canonicalBytes = Buffer.byteLength(JSON.stringify(result));
    result.metrics.budgets = budgetMetrics(result, metrics.budgets || {});
    result.metrics.canonicalBytes = Buffer.byteLength(JSON.stringify(result));
    result.outputDigest = digest({
        ...result,
        outputDigest: undefined
    });
    return result;
}
module.exports = {
    createCanonicalStageResult
};
