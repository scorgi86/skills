const path = require("path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { analyzeFiles } = require("../analysis/analysis.js");
const { runQuery } = require("../query/queries.js");
const { buildChains, sameName, typeMatcher } = require("../query/chains.js");
const { stableHash } = require("../../../output/src/fact_projection.js");
const { applySafeBudget } = require("../../../output/src/measure_context.js");
const { compactItem } = require("../output/projection.js");
const { filterSemanticGroups, groupItems } = require("../output/groups.js");
const { groupKey } = require("../output/identity.js");
const { createQueryIdentity, isCacheableQuery } = require("../query-cache/identity.js");
const { readQueryEntry, writeQueryEntry } = require("../query-cache/storage.js");

const DEFAULT_BATCH_BUDGET = 64 * 1024;
const shortName = value => String(value || "").split(".").pop();
const factoryRelationKey = relation => `${relation.ownerQualifiedName}|${relation.field}|${relation.callableProof?.owner}|${relation.callableProof?.method}`;
const bootstrapId = value => `bootstrap-seed-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;

function selectBootstrapSeed(results, config = {}) {
  const discoverySeeds = [...new Set((config.directSeeds || []).filter(seed => typeof seed === "string" && seed.trim()))];
  const seeds = config.bootstrapSeed ? [config.bootstrapSeed] : discoverySeeds;
  if (!seeds.length) return { status: "seed-missing-stage0" };
  const roots = config.repositoryScope?.repositories || [];
  const candidates = results.flatMap(result => (result.symbols || []).filter(symbol => ["class", "function"].includes(symbol.kind) && seeds.includes(symbol.name)).map(symbol => {
    const evidence = symbol.evidence?.[0], file = evidence?.file || result.file;
    const repository = roots.find(repo => {
      const relative = path.relative(repo.root, file);
      return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if(!evidence?.range?.start?.line||!repository||!result.analysisSourceHash)return null;
    let bytes;try{bytes=fs.readFileSync(file);}catch{return null;}
    const sourceHash=crypto.createHash("sha256").update(bytes).digest("hex");if(sourceHash!==result.analysisSourceHash)return null;
    const line=evidence.range.start.line,endLine=evidence.range.end?.line||line,lines=bytes.toString("utf8").replace(/\r\n/g,"\n").split("\n");
    return { repository: repository.id, file, qualifiedName: symbol.qualifiedName, anchor: { file, line }, startOffset: evidence.range.start.offset,proof:{repository:repository.id,file,line,endLine,sourceHash,sourceFragment:lines.slice(line-1,endLine).join("\n")} };
  }).filter(Boolean));
  const unique = [...new Map(candidates.map(item => [[item.repository, item.file, item.startOffset, item.qualifiedName].join("|"), item])).values()];
  if (!unique.length) return { status: "seed-not-found" };
  if (unique.length > 1) return { status: "seed-ambiguous", candidates: unique.map(({ repository, file, qualifiedName, anchor }) => ({ repository, file, qualifiedName, anchor })) };
  const item = unique[0];
  return { status: "selected", proof:item.proof, group: { id: bootstrapId([item.repository, item.file, item.startOffset, item.qualifiedName]), order: 0, role: "seed", relation: "defines", required: true, object: item.qualifiedName, repository: item.repository, anchor: item.anchor } };
}

function reconcileOwnerProofs(selected) {
  const summaries = selected.flatMap(result => result.methodSummaries || []);
  return selected.flatMap(result => (result.relations || []).map(relation => ({ relation, analysisSourceHash: result.analysisSourceHash }))).map(({ relation, analysisSourceHash }) => {
    const proof = relation.ownerProof;
    if (!proof) return relation;
    const byMethod = summaries.filter(summary => summary.method === proof.method);
    const exact = byMethod.filter(summary => summary.owner === proof.ownerType);
    const candidates = exact.length ? exact : byMethod.filter(summary => shortName(summary.owner) === shortName(proof.ownerType));
    const exactMatch = exact.length
      ? candidates.length === 1 && candidates.every(summary => summary.returnType === proof.returnType)
      : new Set(candidates.map(summary => summary.owner)).size === 1 && candidates.length > 0 && candidates.every(summary => shortName(summary.returnType) === shortName(proof.returnType));
    if (!exactMatch) return relation;
    const summary = candidates[0];
    return { ...relation,
      ownerCandidate: false,
      ownerConfidence: "exact",
      assignmentSourceHash: analysisSourceHash,
      ownerProofEvidence: { ...summary.evidence[0], sourceHash: summary.analysisSourceHash },
      evidence: relation.evidence.map(item => ({ ...item, confidence: "resolved", extractor: "batch:owner-return" }))
    };
  });
}

function reconcileFactoryReturns(selected) {
  const summaries = selected.flatMap(result => (result.methodSummaries || []).map(item => ({ ...item, file: result.file })));
  const relations = selected.flatMap(result => (result.relations || []).map(item => ({ ...item, analysisSourceHash: item.analysisSourceHash || result.analysisSourceHash })));
  const derived = [];
  for (const relation of relations) {
    const proof = relation.callableProof;
    if (!proof || relation.relation !== "call-result-to-field") continue;
    const matches = summaries.filter(summary => summary.owner === proof.owner && summary.method === proof.method);
    if (matches.length !== 1) continue;
    const summary = matches[0];
    const possible = summary.possibleReturnTypes || [];
    const selector = possible[0]?.selector;
    const selectable = possible.length > 0 && selector && possible.every(member => member.selector
      && member.selector.parameterIndex === selector.parameterIndex
      && member.selector.discriminatorKey === selector.discriminatorKey);
    const domain = selectable && (proof.argumentDomains || []).find(item => item.index === selector.parameterIndex && item.discriminatorKey === selector.discriminatorKey);
    const selected = domain ? possible.filter(member => domain.values.includes(member.selector.caseValue)) : [];
    const returns = selected.length ? selected : possible;
    const resolved = summary.returnType
      ? [...returns.filter(member => member.type !== summary.returnType), { type: summary.returnType, proof: { ...summary.evidence[0], sourceHash: summary.analysisSourceHash }, confidence: "exact" }]
      : returns.map(member => ({ ...member, confidence: selected.length === 1 ? "exact" : "exact-possible" }));
    for (const member of resolved) {
      derived.push({ ...relation,
        targetQualifiedName: member.type,
        candidateTypes: [],
        targetConfidence: member.confidence,
        targetProof: member.proof,
        assignmentSourceHash: relation.analysisSourceHash,
        evidence: relation.evidence.map(item => ({ ...item, confidence: "resolved", extractor: "batch:callable-return" }))
      });
    }
  }
  return [...relations, ...derived];
}

function queryFiles(query) {
  const files = query.files || (query.file ? [query.file] : []);
  if (!files.length) throw new Error(`Query ${query.id || "<unnamed>"} requires file or files`);
  return [...new Set(files.map((file) => path.resolve(file)))];
}

function evidenceCount(items) {
  return items.reduce((sum, item) => sum + (Array.isArray(item.evidence) ? item.evidence.length : 0), 0);
}

function normalizeGroupFilters(filters = {}) {
  return {
    groupOwner: filters.owner || filters.groupOwner,
    groupField: filters.field || filters.groupField,
    groupRelation: filters.relation || filters.groupRelation,
    groupTarget: filters.target || filters.groupTarget,
  };
}

function compileQueryPlan(request) {
  if (!request || !Array.isArray(request.queries) || !request.queries.length) throw new Error("Batch request requires non-empty queries");
  const queries = request.queries.map((query, index) => ({
    ...query,
    id: query.id || `query-${index + 1}`,
    resolvedFiles: queryFiles(query),
  }));
  const uniqueFiles = [...new Set(queries.flatMap((query) => query.resolvedFiles))].sort();
  const identity = {
    queries: queries.map((query) => ({
      id: query.id,
      command: query.command,
      files: query.resolvedFiles,
      options: query.options || {},
      groupFilters: query.groupFilters || {},
      includeDetails: Boolean(query.includeDetails),
    })),
    projections: ["coverage", "semantic-groups", "first-anchor-per-group", "selected-evidence"],
  };
  return {
    id: `qp-${stableHash(identity)}`,
    compiledBeforeParse: true,
    queries,
    uniqueFiles,
    queryIds: queries.map((query) => query.id),
    projections: identity.projections,
    lateQueries: 0,
  };
}

async function runAstBatch(request, dependencies = {}) {
  const analyze = dependencies.analyzeFiles || analyzeFiles;
  const plan = compileQueryPlan(request);
  const resolved = plan.queries;
  const uniqueFiles = plan.uniqueFiles;
  const analysis = await analyze(uniqueFiles, { cache: request.cache, concurrency: request.concurrency });
  const bootstrap = request.ownerBootstrap ? selectBootstrapSeed(analysis.results, request.ownerBootstrap) : null;
  const ownerSeedTypes = bootstrap?.status === "selected" ? [bootstrap.group.object] : request.ownerSeedTypes || [];
  const ownerSeedScopes = bootstrap?.status === "selected" ? [{ seed: bootstrap.group.object, repository: bootstrap.group.repository }] : request.ownerSeedScopes;
  const storageRelation = relation => ["field-write", "object-field", "setter-argument-to-field", "parameter-to-field", "call-result-to-field", "computed-write"].includes(relation.relation) || relation.relation.startsWith("collection-");
  const ownerScopes = request.ownerRepositories?.length ? request.ownerRepositories : [{ id: null, root: null }];
  const ownerChains = ownerSeedTypes.flatMap(seed => ownerScopes.filter(repository => !ownerSeedScopes || ownerSeedScopes.some(scope => scope.seed === seed && scope.repository === repository.id)).map(repository => {
    const selected = repository.root ? analysis.results.filter(result => {
      const relative = path.relative(repository.root, result.file);
      return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    }) : analysis.results;
    const factoryRelations = reconcileFactoryReturns(selected);
    const resolvedFactories = new Set(factoryRelations.filter(row => ["exact", "exact-possible"].includes(row.targetConfidence)).map(factoryRelationKey));
    const relations = [
      ...reconcileOwnerProofs(selected).filter(row => !(row.relation === "call-result-to-field" && resolvedFactories.has(factoryRelationKey(row)))),
      ...factoryRelations.filter(row => ["exact", "exact-possible"].includes(row.targetConfidence))
    ].filter(storageRelation);
    const sameType = typeMatcher(selected.flatMap(result => result.typeAliases || []));
    const deferredFactories = relations.filter(row => row.relation === "call-result-to-field" && row.targetConfidence === "exact-possible");
    const concrete = relations.filter(row => row.targetConfidence !== "exact-possible" && !row.dynamic && row.ownerQualifiedName !== "null").flatMap(row => {
      const types = [row.targetQualifiedName, ...(row.candidateTypes || [])].filter(type => type && type !== "unknown" && type !== "null");
      return types.map(type => ({ ...row, targetQualifiedName: type }));
    });
    const chains = buildChains(concrete, seed, { maxDepth: 10, maxPaths: 25, maxBranches: 20, typeAliases: selected.flatMap(result => result.typeAliases || []) });
    const reachable = chains.chains.flatMap(row => row.chain.map(step => step.owner).filter(Boolean));
    const unresolved = [
      ...deferredFactories.filter(row => sameType(row.targetQualifiedName, seed)).map(row => ({ reason: "factory-return-not-narrowed", owner: row.ownerQualifiedName, field: row.field, relation: row.relation, evidence: row.evidence })),
      ...relations.filter(row => (row.ownerCandidate || row.dynamic || row.targetQualifiedName === "unknown" && !(row.candidateTypes || []).length)
      && (reachable.some(type => sameType(row.ownerQualifiedName, type)) || sameType(row.targetQualifiedName, seed)))
      .map(row => ({ owner: row.ownerQualifiedName, field: row.field, relation: row.relation, ownerCandidate: Boolean(row.ownerCandidate), evidence: row.evidence }))
    ];
    if (chains.chains.some(row => row.chain.length > 1) && !selected.some(result => result.symbols.some(symbol => ["class", "function", "import"].includes(symbol.kind) && sameType(symbol.qualifiedName, seed)))) {
      unresolved.push({ reason: "seed-declaration-not-in-scope" });
    }
    return { seed, repository: repository.id, ...chains, unresolved };
  }));
  const observe = typeof dependencies.queryCacheObserver === "function" ? dependencies.queryCacheObserver : () => {};
  const queryCacheEnabled = Boolean(request.cache) && dependencies.queryCacheEnabled !== false;
  const queryCacheDirectory = queryCacheEnabled ? path.join(path.resolve(request.cache), "query-results") : null;
  const parseCounts = Object.fromEntries(uniqueFiles.map((file) => [file, 1]));
  const results = resolved.map((query) => {
    const allowed = new Set(query.resolvedFiles);
    const scopedAnalysis = { results: analysis.results.filter((result) => allowed.has(path.resolve(result.file))), stats: analysis.stats };
    const options = { maxResults: Number.MAX_SAFE_INTEGER, ...(query.options || {}) };
    const analysisKeys = scopedAnalysis.results.map(result => analysis.identities?.get(path.resolve(result.file)));
    const eligible = queryCacheEnabled && isCacheableQuery(query.command) && analysisKeys.length === scopedAnalysis.results.length
      && analysisKeys.every(Boolean) && scopedAnalysis.results.every(result => !result.errors.length);
    let allItems;
    if (eligible) {
      const identity = createQueryIdentity({ command: query.command, options, analysisKeys });
      const entry = readQueryEntry(queryCacheDirectory, identity);
      if (entry.status === "hit") {
        allItems = entry.items;
        observe({ queryId: query.id, status: "hit", key: identity.key, ranQuery: false, runQueryMs: 0 });
      } else {
        const queryStarted = process.hrtime.bigint();
        const queried = runQuery(query.command, scopedAnalysis, options);
        const runQueryMs = Number(process.hrtime.bigint() - queryStarted) / 1e6;
        allItems = queried._allItems || queried.items || [];
        const stored = entry.status === "miss" ? writeQueryEntry(queryCacheDirectory, identity, allItems) : entry;
        observe({ queryId: query.id, status: stored.status === "failed" ? "failed" : "miss", key: identity.key, ranQuery: true, runQueryMs });
      }
    } else {
      const queryStarted = process.hrtime.bigint();
      const queried = runQuery(query.command, scopedAnalysis, options);
      const runQueryMs = Number(process.hrtime.bigint() - queryStarted) / 1e6;
      allItems = queried._allItems || queried.items || [];
      observe({ queryId: query.id, status: "ineligible", ranQuery: true, runQueryMs });
    }
    const groups = groupItems(allItems, query.maxSnippetChars || request.maxSnippetChars || 160);
    const matchedGroups = filterSemanticGroups(groups, normalizeGroupFilters(query.groupFilters));
    const maxGroups = Math.max(1, Number(query.maxGroups || request.maxGroups) || 100);
    const returnedGroups = matchedGroups.slice(0, maxGroups);
    const matchedKeys = new Set(matchedGroups.map((group) => group.key));
    const matchedItems = allItems.filter((item) => matchedKeys.has(groupKey(item)));
    const maxDetails = Math.max(0, Number(query.maxDetails || request.maxDetails) || 50);
    const selectedDetailItems = query.includeDetails ? matchedItems.slice(0, maxDetails) : [];
    const details = query.includeDetails
      ? selectedDetailItems.map((item) => compactItem(item, Number.MAX_SAFE_INTEGER, query.maxSnippetChars || request.maxSnippetChars || 160))
      : [];
    const detailEvidenceTotal = evidenceCount(selectedDetailItems);
    const detailEvidence = evidenceCount(details);
    return {
      id: query.id,
      command: query.command,
      files: query.resolvedFiles,
      projectionHints: {
        preferredTerms: query.projectionTerms || options.terms || options.type || options.field || options.symbol || [],
      },
      status: matchedItems.length ? "candidate" : "not-found",
      coverage: {
        totalItems: allItems.length,
        groupsScanned: groups.length,
        groupsMatched: matchedGroups.length,
        groupsReturned: returnedGroups.length,
        groupsTruncated: returnedGroups.length < matchedGroups.length,
        evidenceTotal: evidenceCount(allItems),
        evidenceMatched: evidenceCount(matchedItems),
        detailCandidatesMatched: matchedItems.length,
        detailSelectionLimited: Math.max(0, matchedItems.length - selectedDetailItems.length),
        detailsRequested: selectedDetailItems.length,
        detailsReturned: details.length,
        detailsSuppressed: Math.max(0, selectedDetailItems.length - details.length),
        detailEvidenceTotal,
        detailEvidenceReturned: detailEvidence,
        detailEvidenceSuppressed: Math.max(0, detailEvidenceTotal - detailEvidence),
      },
      groupDigest: stableHash(matchedGroups.map((group) => group.key).sort()),
      semanticGroups: matchedGroups.map((group) => ({
        key: group.key,
        owner: group.owner,
        relation: group.relation,
        field: group.field,
        target: group.target,
        items: group.items,
        evidence: group.evidence,
        example: group.example,
      })),
      groups: returnedGroups,
      details,
    };
  });
  const output = {
    schemaVersion: "1.0.0",
    status: analysis.stats.failed ? "partial" : "candidate",
    plan: {
      id: plan.id,
      compiledBeforeParse: plan.compiledBeforeParse,
      queryIds: plan.queryIds,
      uniqueFiles: plan.uniqueFiles,
      projections: plan.projections,
      lateQueries: plan.lateQueries,
    },
    stats: { ...analysis.stats, uniqueFiles: uniqueFiles.length, queries: results.length, parseCounts },
    results,
    warnings: [],
    ...(ownerSeedTypes.length ? { ownerChains } : {}),
    ...(bootstrap ? { bootstrap } : {}),
  };
  applySafeBudget(output, request.maxOutputBytes, DEFAULT_BATCH_BUDGET);
  if (output.output.autoRaised) {
    output.warnings.push({
      code: "output-budget-auto-raised",
      message: `Required evidence needs ${output.output.budgetRequired} bytes; the applied budget was raised without reparsing or suppressing details.`,
    });
    applySafeBudget(output, request.maxOutputBytes, DEFAULT_BATCH_BUDGET);
  }
  return output;
}

module.exports = { DEFAULT_BATCH_BUDGET, compileQueryPlan, runAstBatch, selectBootstrapSeed };
