"use strict";
const { projectAst } = require("../fact_projection.js");
const { compactSummaryAnchors } = require("./compaction.js");
const { encodeHumanFields } = require("../human_report_codec.js");
const { byteLength, measureValue } = require("../measure_context.js");
const { sourceProjection } = require("./source_projection.js");
const { DEFAULT_BUDGETS, finalizeSummaryBudget } = require("./budget.js");
function assembleStageSummary(facts, options, projection) {
    let summary = {
        schemaVersion: "2.2.0",
        stage: facts.stage,
        status: facts.status,
        artifact: options.artifact || null,
        runtime: facts.runtime,
        quality: facts.quality,
        factsOutput: facts.output,
        measurements: facts.measurements,
        ast: projectAst(facts.ast, projection),
        sourceEvidence: sourceProjection(facts.sourceEvidence, projection.source || {})
    };
    if (projection.compactAnchors) summary.compaction = compactSummaryAnchors(summary, {
        anchorRoot: projection.anchorRoot
    });
    if (projection.humanDictionary) summary = encodeHumanFields(summary);
    return summary;
}
function projectionWithCaps(projection, astCap, sourceCap) {
    return {
        ...projection,
        maxGroupsPerQuery: astCap,
        source: {
            ...projection.source || {},
            maxGroupsPerCheck: sourceCap
        }
    };
}
function maxSourceGroups(facts) {
    return Math.max(1, ...(facts.sourceEvidence && facts.sourceEvidence.checks || []).map((check)=>(check.groups || []).length));
}
function fitAdaptiveSummary(facts, options, budgets) {
    const projection = options.projection || {};
    const adaptive = projection.adaptive || {};
    const ratio = Math.min(0.98, Math.max(0.5, Number(adaptive.targetRatio) || 0.9));
    const targetBytes = Math.floor(budgets.summaryBytes * ratio);
    const requestedAst = Math.max(1, Number(projection.maxGroupsPerQuery) || 12);
    const requestedSource = Math.max(1, Number(projection.source && projection.source.maxGroupsPerCheck) || maxSourceGroups(facts));
    const minimumAst = Math.max(1, Number(adaptive.minAstGroups) || 1);
    const minimumSource = Math.max(1, Number(adaptive.minSourceGroups) || 1);
    const maxAttempts = Math.max(1, Number(adaptive.maxAttempts) || 32);
    let astCap = requestedAst;
    let sourceCap = requestedSource;
    let summary = assembleStageSummary(facts, options, projectionWithCaps(projection, astCap, sourceCap));
    const initialBytes = byteLength(summary);
    let attempts = 0;
    function decorate(value, appliedAst, appliedSource, appliedAttempts) {
        value.adaptive = {
            enabled: true,
            targetRatio: ratio,
            targetBytes,
            initialBytes,
            finalBytesBeforeOutput: 0,
            attempts: appliedAttempts,
            requestedCaps: {
                astGroupsPerQuery: requestedAst,
                sourceGroupsPerCheck: requestedSource
            },
            appliedCaps: {
                astGroupsPerQuery: appliedAst,
                sourceGroupsPerCheck: appliedSource
            },
            fit: false,
            policy: "reduce-low-ranked-representatives-preserve-required-groups"
        };
        for(let iteration = 0; iteration < 6; iteration += 1){
            const bytes = byteLength(value);
            const fit = bytes <= targetBytes;
            if (value.adaptive.finalBytesBeforeOutput === bytes && value.adaptive.fit === fit) break;
            value.adaptive.finalBytesBeforeOutput = bytes;
            value.adaptive.fit = fit;
        }
        return value;
    }
    summary = decorate(summary, astCap, sourceCap, attempts);
    while(byteLength(summary) > targetBytes && attempts < maxAttempts){
        const candidates = [];
        if (astCap > minimumAst) {
            const candidate = decorate(assembleStageSummary(facts, options, projectionWithCaps(projection, astCap - 1, sourceCap)), astCap - 1, sourceCap, attempts + 1);
            candidates.push({
                summary: candidate,
                astCap: astCap - 1,
                sourceCap,
                bytes: byteLength(candidate)
            });
        }
        if (sourceCap > minimumSource) {
            const candidate = decorate(assembleStageSummary(facts, options, projectionWithCaps(projection, astCap, sourceCap - 1)), astCap, sourceCap - 1, attempts + 1);
            candidates.push({
                summary: candidate,
                astCap,
                sourceCap: sourceCap - 1,
                bytes: byteLength(candidate)
            });
        }
        if (!candidates.length) break;
        candidates.sort((left, right)=>left.bytes - right.bytes || right.astCap + right.sourceCap - (left.astCap + left.sourceCap));
        const selected = candidates[0];
        summary = selected.summary;
        astCap = selected.astCap;
        sourceCap = selected.sourceCap;
        attempts += 1;
    }
    return decorate(summary, astCap, sourceCap, attempts);
}
function buildStageSummary(facts, options = {}) {
    const budgets = facts.runtime && facts.runtime.budgets ? facts.runtime.budgets : DEFAULT_BUDGETS;
    const projection = options.projection || {};
    const summary = projection.adaptive && projection.adaptive.enabled ? fitAdaptiveSummary(facts, options, budgets) : assembleStageSummary(facts, options, projection);
    return finalizeSummaryBudget(summary, budgets.summaryBytes);
}
module.exports = {
    assembleStageSummary,
    buildStageSummary,
    fitAdaptiveSummary
};
