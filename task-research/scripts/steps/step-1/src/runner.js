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
const { canonicalFacts, prepareFacts } = require("../../../shared/artifacts/src/canonical/facts.js");
const { blockingOwnerUnresolved, evaluateStage1Coverage } = require("./stage1_coverage_gate.js");
const { DEFAULT_STAGE1_BUDGETS, buildStage1Summary } = require("./summary.js");
const { runGitNexusContext } = require("./context/gitnexus.js");
const { normalizeOwnership } = require("./context/ownership.js");
const { transitionForRequest } = require("../../../state/src/session/inventory_session.js");
const { SourceSnapshotStore } = require("../../../shared/evidence/src/source_snapshot.js");
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

function finalizeStage1Facts(facts, options = {}) {
    const budgetView = { canonicalFacts: canonicalFacts(facts) };
    const budgets = facts.runtime?.budgets || {};
    applySafeBudget(budgetView, budgets.factsBytes, DEFAULT_STAGE1_BUDGETS.factsBytes, 8192);
    facts.output = budgetView.output;
    facts.quality = facts.quality || {};
    facts.quality.summary = buildStage1Summary(facts).output;
    if (options.evaluateCoverage !== false) {
        facts.quality.coverageGate = evaluateStage1Coverage(facts);
        if (!facts.quality.coverageGate.ok) facts.status = "partial";
    }
    facts.quality.summary = buildStage1Summary(facts).output;
    return facts;
}

function autoReviewedCoverageContract(contract, discovery, ownership) {
    const generatedIds = discovery?.groups.map(group => group.id) || [];
    const category = contract?.categories?.find(item => item.id === "owner-branches");
    const confirmed = new Set((ownership?.groups || []).filter(group => group.status === "confirmed").map(group => group.id));
    if (category?.status !== "open" || !generatedIds.length || !discovery.reviewDigest || blockingOwnerUnresolved(discovery.unresolved).length || generatedIds.some(id => !confirmed.has(id))) return contract;
    return { ...contract, categories: contract.categories.map(item => item.id === "owner-branches" ? { ...item, status: "applicable", groupIds: generatedIds, reviewDigest: discovery.reviewDigest } : item) };
}

function automaticBootstrap(request) {
    const ownership = request.ownership || {};
    return request.searchFromStage0 === true && ownership.autoCandidates !== false
        && !(ownership.expectedIds || []).length && !(ownership.groups || []).length;
}

function bootstrapCoverage(bootstrap, discovery) {
    if (bootstrap?.status !== "selected") return {
        categories: [
            { id: "feature-bootstrap", status: "open", requiredBeforeClose: true, reason: bootstrap?.status || "seed-missing-stage0" },
            { id: "serialization", status: "open", reason: "deferred to a later stage" },
        ]
    };
    const generated = discovery?.groups || [], unresolved = blockingOwnerUnresolved(discovery?.unresolved);
    const confirmed = generated.length && generated.every(group => group.status === "confirmed");
    const owner = confirmed && !unresolved.length && discovery.reviewDigest
        ? { id: "owner-branches", status: "applicable", requiredBeforeClose: true, groupIds: generated.map(group => group.id), reviewDigest: discovery.reviewDigest }
        : !generated.length && !unresolved.length
          ? { id: "owner-branches", status: "not-applicable", reason: "No owner branches were found for the selected seed" }
          : { id: "owner-branches", status: "open", requiredBeforeClose: true, reason: "Owner branches require source confirmation" };
    return { categories: [
        { id: "direct-model", status: "applicable", groupIds: [bootstrap.group.id] }, owner,
        { id: "serialization", status: "open", reason: "deferred to a later stage" },
    ], baseline: { ownershipIds: [bootstrap.group.id] } };
}

async function runStage1(request, dependencies = {}, context = null) {
    if (Number(request && request.stage) !== 1) throw new Error("stage1_runner accepts only stage: 1");
    if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
    const budgets = normalizeBudgets(request, DEFAULT_STAGE1_BUDGETS);
    const previous = transitionForRequest(context, request) || JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
    const transition = extractTransition(previous);
    const priorScope = previous.summary?.repositoryScope;
    const repositoryScope = request.repositoryScope || priorScope;
    const sourceSnapshots = dependencies.sourceSnapshots || new SourceSnapshotStore();
    const bootstrapEnabled = automaticBootstrap(request);
    if((bootstrapEnabled||request.ownership?.autoCandidates===true)&&(request.capabilities||[]).some(row=>["definition","ownership"].includes(row.id)))throw new Error("Automatic Stage 1 conflicts with manual definition/ownership capabilities");
    const stage0Seeds = previous.summary?.seeds;
    const bootstrapSeedProvided = Object.hasOwn(request.ownership || {}, "bootstrapSeed");
    if (bootstrapSeedProvided && !bootstrapEnabled) throw new Error("ownership.bootstrapSeed is allowed only for empty auto-bootstrap ownership");
    if (bootstrapSeedProvided && (typeof request.ownership.bootstrapSeed !== "string" || !request.ownership.bootstrapSeed.trim())) throw new Error("ownership.bootstrapSeed must be a non-empty string");
    if (bootstrapSeedProvided && !(stage0Seeds || []).includes(request.ownership.bootstrapSeed)) throw new Error("ownership.bootstrapSeed must be declared in Stage 0 seeds");
    const autoOwners = request.ownership?.autoCandidates === true || bootstrapEnabled;
    const seedGroups = (request.ownership?.groups || []).filter(group => group.order === 0 && group.object);
    if (!bootstrapEnabled && autoOwners && (request.searchFromStage0 !== true || !request.ownership?.expectedIds?.length || !seedGroups.length || !request.coverageContract?.categories?.some(category => category.id === "owner-branches" && category.requiredBeforeClose === true))) {
        throw new Error("Automatic owner candidates require Stage 0 search, expectedIds, order-0 seed groups and a required owner-branches category");
    }
    const ownerSeedScopes = !bootstrapEnabled && autoOwners ? seedGroups.map(group => {
        const file = group.anchor?.file && path.resolve(request.sourceRoot || "", group.anchor.file);
        const repository = repositoryScope.repositories.find(item => {
            if (!file) return false;
            const relative = path.relative(item.root, file);
            return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        });
        if (!repository || group.repository && group.repository !== repository.id) throw new Error(`Owner seed ${group.id || group.object} requires an in-scope source anchor`);
        return { seed: group.object, repository: repository.id };
    }) : [];
    const ast = await (dependencies.runAstBatch || runAstBatch)({ ...request.ast || {}, ...(bootstrapEnabled ? { ownerBootstrap: { directSeeds: stage0Seeds, bootstrapSeed: request.ownership?.bootstrapSeed, repositoryScope }, ownerRepositories: repositoryScope.repositories } : autoOwners ? { ownerSeedTypes: [...new Set(seedGroups.map(group => group.object))], ownerRepositories: repositoryScope.repositories, ownerSeedScopes } : {}) });
    const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({
        ...request.evidence || {
            checks: []
        },
        retainAllMatches: true
    }, { sourceSnapshots });
    const gitnexus = (dependencies.runGitNexusContext || runGitNexusContext)(request.gitnexus || {}, dependencies);
    const bootstrap = bootstrapEnabled ? ast.bootstrap || { status: "seed-missing-stage0" } : null;
    const bootstrapProofId=bootstrap?.status==="selected"?`${bootstrap.group.id}:declaration`:null;
    const bootstrapEvidence=bootstrapProofId?{id:bootstrapProofId,status:"source-confirmed",...bootstrap.proof}:null;
    const confirmedBootstrapGroup=bootstrapEvidence?{...bootstrap.group,status:"confirmed",sourceFragment:bootstrap.proof.sourceFragment,evidenceRefs:[bootstrapProofId],confirmation:{method:"ast-exact-declaration",status:"source-confirmed",...bootstrap.proof,evidenceRefs:[bootstrapProofId]}}:bootstrap?.group;
    if(bootstrap?.status==="selected")bootstrap.group=confirmedBootstrapGroup;
    const activeSeedGroups = bootstrap?.status === "selected" ? [confirmedBootstrapGroup] : seedGroups;
    const discovery = autoOwners && (!bootstrapEnabled || bootstrap.status === "selected") ? require("./owner_discovery.js").discoverOwnerCandidates(ast, { ...request, repositoryScope, ownership: { ...(request.ownership || {}), groups: activeSeedGroups } }, previous, sourceSnapshots) : null;
    const ownership = normalizeOwnership(discovery || bootstrap?.status === "selected" ? { ...request, ownership: { ...(request.ownership || {}), expectedIds: bootstrap?.status === "selected" ? [bootstrap.group.id] : request.ownership?.expectedIds, groups: [...activeSeedGroups, ...(discovery?.groups || [])] } } : request, sourceEvidence, new Map());
    const coverageContract = bootstrapEnabled ? bootstrapCoverage(bootstrap, discovery) : autoReviewedCoverageContract(request.coverageContract || null, discovery, ownership);
    const incompleteAutoSearch = request.searchFromStage0 === true && (request.evidence?.checks || []).some((check)=>{
        const result = sourceEvidence.checks.find((item)=>item.id === check.id);
        const expectedFiles = check.files?.length || (check.file ? 1 : 0);
        return !result || result.status === "partial" || result.resultComplete === false || result.filesScanned !== expectedFiles;
    });
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
        status: ast.status === "partial" || incompleteAutoSearch ? "partial" : "candidate",
        transition,
        ast,
        sourceEvidence,
        quality,
        budgets,
        capabilities: normalizeCapabilities([...(request.capabilities||[]),...(bootstrapEvidence?[{id:"definition",status:"confirmed",evidenceRefs:[bootstrapProofId]}]:[])])
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
    facts.ownershipGraph = discovery?.graph || (request.ownershipGraph ? buildOwnershipGraph(request.ownershipGraph) : null);
    if (discovery) {
        facts.ownerDiscovery = { generatedIds: discovery.groups.map(group => group.id), unresolved: discovery.unresolved, reviewDigest: discovery.reviewDigest };
        facts.limitations = discovery.unresolved.map(row => ({ statement: `Owner branch unresolved: ${row.reason}${row.edgeId ? ` (${row.edgeId})` : ""}`, anchor: row.anchor || (row.evidence?.[0] ? { file: row.evidence[0].file, line: row.evidence[0].range?.start?.line } : undefined) }));
        facts.summary = { ownerDiscovery: { generatedIds: discovery.groups.map(group => group.id), unresolved: discovery.unresolved.length, reviewDigest: discovery.reviewDigest } };
        facts.canonicalEvidence = [...(bootstrapEvidence?[bootstrapEvidence]:[]),...(discovery.evidenceCandidates || [])];
    } else if(bootstrapEvidence){
        facts.canonicalEvidence=[bootstrapEvidence];
    }
    if (bootstrapEnabled) {
        facts.quality.bootstrap = bootstrap;
        facts.summary = { ...(facts.summary || {}), bootstrap };
        if (bootstrap.status !== "selected") facts.limitations = [...(facts.limitations || []), { statement: bootstrap.status, candidates: bootstrap.candidates || [] }];
    }
    facts.boundaries = normalizeBoundaryCandidates(request, ownership, sourceEvidence);
    facts.coverageContract = coverageContract;
    facts.claimLedger = request.claimLedger || null;
    facts.observations = Array.isArray(request.observations) ? request.observations : [];
    let finalized=finalizeStage1Facts(facts);
    const required=(finalized.ownership?.groups||[]).filter(group=>group.required!==false),ownershipRefs=[...new Set(required.flatMap(group=>group.evidenceRefs||[]))].sort();
    if(finalized.quality.coverageGate.ok&&required.length&&required.every(group=>group.status==="confirmed"&&(group.evidenceRefs||[]).length))finalized.capabilities=normalizeCapabilities([...(finalized.capabilities||[]),{id:"ownership",status:"confirmed",evidenceRefs:ownershipRefs}]);
    if(!dependencies.deferCanonicalization)finalized=finalizeStage1Facts(prepareFacts(finalized,{sourceSnapshots}));
    if (bootstrapEnabled && finalized.quality.coverageGate.ok) finalized.status = "closed";
    return finalized;
}
module.exports = {
    finalizeStage1Facts,
    resolveRequest,
    runStage1
};
