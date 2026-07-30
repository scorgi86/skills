const path = require("path");
const { analyzeFiles, runQuery } = require("./queries");
const { stableHash } = require("../fact_projection");
const { applySafeBudget } = require("../measure_context");
const { compactItem, filterSemanticGroups, groupItems, groupKey } = require("./output");

const DEFAULT_BATCH_BUDGET = 64 * 1024;

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

function runAstBatch(request, dependencies = {}) {
  const analyze = dependencies.analyzeFiles || analyzeFiles;
  const plan = compileQueryPlan(request);
  const resolved = plan.queries;
  const uniqueFiles = plan.uniqueFiles;
  const analysis = analyze(uniqueFiles, { cache: request.cache });
  const parseCounts = Object.fromEntries(uniqueFiles.map((file) => [file, 1]));
  const results = resolved.map((query) => {
    const allowed = new Set(query.resolvedFiles);
    const scopedAnalysis = { results: analysis.results.filter((result) => allowed.has(path.resolve(result.file))), stats: analysis.stats };
    const options = { maxResults: Number.MAX_SAFE_INTEGER, ...(query.options || {}) };
    const queried = runQuery(query.command, scopedAnalysis, options);
    const allItems = queried._allItems || queried.items || [];
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

module.exports = { DEFAULT_BATCH_BUDGET, compileQueryPlan, runAstBatch };
