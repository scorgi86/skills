"use strict";
const crypto = require("node:crypto");
const { measureValue } = require("../../../shared/output/src/measure_context.js");
const DEFAULT_STAGE1_BUDGETS = Object.freeze({
    factsBytes: 64 * 1024,
    summaryBytes: 8 * 1024,
    evidenceBytes: 32 * 1024,
    reportBytes: 48 * 1024
});
function summaryDigest(value) {
    return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
function rawSummary(facts, artifact = null) {
    const summary = {
        schemaVersion: "1.0.0",
        stage: 1,
        status: facts.status,
        artifact,
        graph: {
            status: facts.gitnexus && facts.gitnexus.status || "unknown",
            requests: (facts.gitnexus && facts.gitnexus.requests || []).length,
            seed: facts.gitnexus && facts.gitnexus.context && facts.gitnexus.context.seed || null,
            symbol: facts.gitnexus && facts.gitnexus.context && facts.gitnexus.context.symbol || null,
            candidateCount: facts.gitnexus && facts.gitnexus.context && facts.gitnexus.context.candidateCount || 0,
            limitation: facts.gitnexus && facts.gitnexus.reason || null
        },
        ast: {
            planId: facts.ast && facts.ast.plan && facts.ast.plan.id || null,
            parsedFiles: facts.ast && facts.ast.stats && facts.ast.stats.uniqueFiles || 0,
            queries: (facts.ast && facts.ast.results || []).map((item)=>({
                    id: item.id,
                    groups: item.coverage && item.coverage.groupsMatched || 0,
                    digest: item.groupDigest
                }))
        },
        source: (facts.sourceEvidence && facts.sourceEvidence.checks || []).map((item)=>({
                id: item.id,
                status: item.status,
                groups: item.groupsTotal,
                digest: item.groupDigest
            })),
        ownership: (facts.ownership && facts.ownership.groups || []).map((item)=>({
                id: item.id,
                order: item.order,
                role: item.role,
                object: item.object,
                relation: item.relation,
                status: item.status,
                anchor: item.anchor
            })),
        ownershipGraph: facts.ownershipGraph ? {
            nodes: facts.ownershipGraph.nodes.length,
            edges: facts.ownershipGraph.edges.length,
            frontier: facts.ownershipGraph.frontier
        } : null,
        boundaries: (facts.boundaries || []).map((item)=>({
                id: item.id,
                kind: item.kind,
                symbol: item.symbol,
                relation: item.relation,
                anchor: item.anchor,
                consumerRepos: item.consumerRepos,
                status: item.status
            })),
        coverage: facts.quality && facts.quality.coverageGate || null,
        measurements: {
            facts: facts.measurements && facts.measurements.facts || measureValue(facts)
        }
    };
    summary.digest = summaryDigest(summary);
    return summary;
}
function buildStage1Summary(facts, artifact = null) {
    const summary = rawSummary(facts, artifact);
    const budget = facts.runtime && facts.runtime.budgets && facts.runtime.budgets.summaryBytes || DEFAULT_STAGE1_BUDGETS.summaryBytes;
    const measured = measureValue(summary);
    if (measured.bytes > budget) {
        return {
            schemaVersion: "1.0.0",
            stage: 1,
            status: "partial",
            artifact,
            reason: "summary-budget-overflow",
            digest: summary.digest,
            output: {
                bytes: measured.bytes,
                budget,
                bounded: false,
                overflow: true,
                estimatedTokens: measured.estimatedTokens
            }
        };
    }
    summary.output = {
        bytes: measured.bytes,
        budget,
        bounded: true,
        overflow: false,
        estimatedTokens: measured.estimatedTokens
    };
    return summary;
}
module.exports = {
    DEFAULT_STAGE1_BUDGETS,
    buildStage1Summary
};
