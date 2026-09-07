"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createStageFacts } = require("../../../shared/output/src/stage_facts.js");
const { normalizeBudgets } = require("../../../shared/output/src/summary/budget.js");
const { extractTransition } = require("../../../shared/dto/src/extract_stage_transition.js");
const { runAstBatch } = require("../../../shared/ast/src/batch/batch.js");
const { runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");
const { normalizeCapabilities } = require("../../../shared/dto/src/capability_contract.js");
const { buildOwnershipGraph } = require("../../../shared/ownership/src/ownership_graph.js");
const { normalizeBoundaryCandidates } = require("../../../shared/ownership/src/boundary_candidates.js");
const { applySafeBudget } = require("../../../shared/output/src/measure_context.js");
const { evaluateStage1Coverage } = require("./stage1_coverage_gate.js");
const { DEFAULT_STAGE1_BUDGETS, buildStage1Summary } = require("./summary.js");
const { runGitNexusContext } = require("./context/gitnexus.js");
const { normalizeOwnership } = require("./context/ownership.js");
function resolveRequest(request) {
    if (!request || !request.extends) return request;
    const base = JSON.parse(fs.readFileSync(path.resolve(request.extends), "utf8"));
    const result = {
        ...base,
        ...request
    };
    if (base.evidence || request.evidence) result.evidence = {
        ...base.evidence || {},
        ...request.evidence || {},
        checks: [
            ...base.evidence && base.evidence.checks || [],
            ...request.evidence && request.evidence.checks || []
        ]
    };
    result.boundaries = request.boundaries || base.boundaries || [];
    delete result.extends;
    return result;
}
function runStage1(request, dependencies = {}) {
    if (Number(request && request.stage) !== 1) throw new Error("stage1_runner accepts only stage: 1");
    if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
    const budgets = normalizeBudgets(request, DEFAULT_STAGE1_BUDGETS);
    const transition = extractTransition(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
    const priorScope = JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8")).summary?.repositoryScope;
    const repositoryScope = request.repositoryScope || priorScope;
    const ast = (dependencies.runAstBatch || runAstBatch)(request.ast || {});
    const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({
        ...request.evidence || {
            checks: []
        },
        retainAllMatches: true
    });
    const gitnexus = (dependencies.runGitNexusContext || runGitNexusContext)(request.gitnexus || {}, dependencies);
    const ownership = normalizeOwnership(request, sourceEvidence, new Map());
    const quality = {
        astFilesParsedOnce: Object.values(ast.stats && ast.stats.parseCounts || {}).every((count)=>count === 1),
        astPlanCompiledBeforeParse: Boolean(ast.plan && ast.plan.compiledBeforeParse),
        astLateQueries: ast.plan ? ast.plan.lateQueries : null,
        graphRequests: (gitnexus.requests || []).length,
        sourceChecks: sourceEvidence.checks.length,
        emptyChecksAreCandidates: sourceEvidence.checks.filter((check)=>check.status === "candidate-empty").length
    };
    const facts = createStageFacts({
        stage: 1,
        status: ast.status === "partial" ? "partial" : "candidate",
        transition,
        ast,
        sourceEvidence,
        quality,
        budgets,
        capabilities: normalizeCapabilities(request.capabilities || [])
    });
    facts.repositoryScope = repositoryScope;
    facts.repository = request.repository;
    facts.exclusions = request.exclusions;
    facts.runtime.contract = "stage-1-facts";
    facts.runtime.graph = request.gitnexus ? {
        configured: true
    } : {
        configured: false
    };
    facts.gitnexus = gitnexus;
    facts.ownership = ownership;
    facts.ownershipGraph = request.ownershipGraph ? buildOwnershipGraph(request.ownershipGraph) : null;
    facts.boundaries = normalizeBoundaryCandidates(request, ownership, sourceEvidence);
    facts.coverageContract = request.coverageContract || null;
    facts.claimLedger = request.claimLedger || null;
    facts.observations = Array.isArray(request.observations) ? request.observations : [];
    applySafeBudget(facts, budgets.factsBytes, DEFAULT_STAGE1_BUDGETS.factsBytes, 8192);
    facts.quality.summary = buildStage1Summary(facts).output;
    facts.quality.coverageGate = evaluateStage1Coverage(facts);
    if (!facts.quality.coverageGate.ok) facts.status = "partial";
    applySafeBudget(facts, budgets.factsBytes, DEFAULT_STAGE1_BUDGETS.factsBytes, 8192);
    facts.quality.summary = buildStage1Summary(facts).output;
    facts.quality.coverageGate = evaluateStage1Coverage(facts);
    if (!facts.quality.coverageGate.ok) facts.status = "partial";
    return require("../../../shared/artifacts/src/canonical/facts.js").prepareFacts(facts);
}
module.exports = {
    resolveRequest,
    runStage1
};
