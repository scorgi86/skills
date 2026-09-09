"use strict";
const { PLANNING_COLLECTIONS, PRIMARY_KIND_BY_COLLECTION } = require("../../../dto/src/planning_contract.js");
function unique(values = []) {
    return [
        ...new Set(values.filter(Boolean).map(String))
    ].sort();
}
function normalizeUsage(usage) {
    if (!usage || usage.status === "unavailable") return {
        status: "unavailable"
    };
    const fields = [
        "inputTokens",
        "cachedInputTokens",
        "outputTokens",
        "reasoningTokens",
        "totalTokens"
    ];
    if (usage.status !== undefined && usage.status !== "supplied" || !fields.every((field)=>Number.isInteger(usage[field]) && usage[field] >= 0) || !String(usage.provider || "").trim() || !String(usage.requestId || "").trim()) throw new Error("Invalid supplied usage telemetry");
    return {
        status: "supplied",
        ...Object.fromEntries(fields.map((field)=>[
                field,
                usage[field]
            ])),
        provider: String(usage.provider),
        requestId: String(usage.requestId)
    };
}
function normalizeStatus(status) {
    if ([
        "blocked",
        "error"
    ].includes(status)) return "blocked";
    if ([
        "partial",
        "candidate",
        "candidate-empty"
    ].includes(status)) return "partial";
    return "closed";
}
function canonicalFacts(facts) {
    const receipts = facts.checkResolutions || facts.provenance?.checkResolutions || [];
    if (Array.isArray(facts.canonicalFacts)) return [...facts.canonicalFacts, ...receipts];
    if (facts.modelType === "inventory-report-model") return [
        {
            kind: "report-model",
            model: facts
        }, ...receipts
    ];
    const rows = [];
    for (const capability of facts.capabilities || [])rows.push({
        kind: "capability",
        ...capability,
        evidenceRefs: unique(capability.evidenceRefs || [])
    });
    for (const boundary of facts.boundaries || []){
        const { kind: boundaryKind, ...rest } = boundary;
        rows.push({
            kind: "boundary",
            boundaryKind,
            ...rest
        });
    }
    for (const collection of PLANNING_COLLECTIONS){
        let values = collection === "limitations" ? require("../limitations.js").normalizeLimitations(facts[collection]) : facts[collection];
        if (collection === "ownership" && !Array.isArray(values)) values = values?.groups;
        if (collection === "scenarios" && !Array.isArray(values)) values = facts.consumerCoverage;
        if (collection === "recipientFamilies" && !Array.isArray(values)) values = facts.families;
        for (const row of values || [])rows.push({
            kind: PRIMARY_KIND_BY_COLLECTION[collection],
            ...row
        });
    }
    for (const node of facts.ownershipGraph?.nodes || [])rows.push({
        kind: "ownership-node",
        ...node
    });
    for (const edge of facts.ownershipGraph?.edges || [])rows.push({
        kind: "ownership-edge",
        ...edge
    });
    for (const surface of facts.sourceSurfaces || [])rows.push({
        kind: Number(facts.stage) === 6 ? "reference-path" : "source-surface",
        id: surface.id || `source-surface:${surface.path || rows.length + 1}`,
        ...surface
    });
    if (facts.nameCoverage) rows.push({
        kind: "name-coverage",
        ...facts.nameCoverage
    });
    return [...rows, ...receipts];
}
function budgetMetrics(result, budgets = {}) {
    const warnings = [];
    const evidencePerCapability = result.facts.filter((item)=>item.kind === "capability").map((item)=>(item.evidenceRefs || []).length);
    const checks = [
        [
            "maxCanonicalFindings",
            result.facts.length
        ],
        [
            "maxEvidencePerCapability",
            evidencePerCapability.length ? Math.max(...evidencePerCapability) : 0
        ],
        [
            "maxTransitionBytes",
            result.metrics.canonicalBytes
        ]
    ];
    for (const [name, actual] of checks)if (Number.isFinite(budgets[name]) && actual > budgets[name]) warnings.push({
        budget: name,
        limit: budgets[name],
        actual
    });
    return {
        configured: budgets,
        warnings,
        exceeded: warnings.length > 0
    };
}
function prepareFacts(facts) {
    if (!facts || facts.modelType === "inventory-report-model") return facts;
    const stage2 = require("../../../evidence/index.js").stage2_canonicalize;
    const repository = facts.repository || "";
    const candidates = [...facts.canonicalEvidence || [], ...stage2.candidatesFromSourceEvidence(facts.sourceEvidence, repository)];
    if ([1,2].includes(Number(facts.stage))) candidates.push(...stage2.candidatesFromAst(facts.ast, repository), ...stage2.candidatesFromGitNexus(facts.gitnexus, repository), ...stage2.candidatesFromBoundaries(facts.boundaries, repository), ...stage2.candidatesFromOwnership(facts.ownership, repository), ...stage2.candidatesFromOwnership(facts.ownershipGraph, repository));
    if (!candidates.length) return facts;
    const normalized = stage2.canonicalizeStage2Candidates(candidates, { exclusions: facts.exclusions, repositoryScope: facts.repositoryScope });
    // Scope evidence (for example checked absence) has no source-file identity.
    for (const row of facts.canonicalEvidence || []) if (!row.file && !row.path) {
        const preserved = { ...row, aliases: unique([row.id, ...row.aliases || []]) };
        normalized.evidence.push(preserved);
        for (const alias of preserved.aliases) normalized.evidenceIdMap[alias] = unique([ ...normalized.evidenceIdMap[alias] || [], row.id ]);
    }
    const { remapEvidenceReferences } = require("../../../evidence/src/canonicalization/canonicalize.js");
    const linked = { ...facts };
    const attach = row => ({ ...row, evidenceRefs: unique([ ...row.evidenceRefs || [], ...normalized.evidenceIdMap[row.id] || [] ]) });
    if (Array.isArray(facts.boundaries)) linked.boundaries = facts.boundaries.map(attach);
    if (Array.isArray(facts.ownership)) linked.ownership = facts.ownership.map(attach);
    else if (facts.ownership?.groups) linked.ownership = { ...facts.ownership, groups: facts.ownership.groups.map(attach) };
    if (facts.ownershipGraph?.nodes) linked.ownershipGraph = { ...facts.ownershipGraph, nodes: facts.ownershipGraph.nodes.map(attach) };
    const remapped = remapEvidenceReferences(linked, normalized.evidenceIdMap);
    return { ...remapped, canonicalEvidence: normalized.evidence, evidenceIdMap: normalized.evidenceIdMap, evidenceDiagnostics: [...new Map([ ...facts.evidenceDiagnostics || [], ...normalized.diagnostics ].map(row => [JSON.stringify(row), row])).values()], metrics: { ...facts.metrics || {}, ...normalized.metrics } };
}

module.exports = {
    budgetMetrics,
    normalizeUsage,
    prepareFacts,
    normalizeStatus,
    canonicalFacts,
    unique
};
