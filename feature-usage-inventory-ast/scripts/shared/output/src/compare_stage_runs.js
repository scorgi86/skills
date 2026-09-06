"use strict";

const { compareStageRepresentations } = require("./quality_equivalence.js");

function queries(value) {
  return value && value.ast && (value.ast.queries || value.ast.results) || [];
}

function checks(value) {
  return value && value.sourceEvidence && (value.sourceEvidence.checks || value.sourceEvidence) || [];
}

function sum(items, selector) {
  return items.reduce((total, item) => total + (Number(selector(item)) || 0), 0);
}

function metrics(value, bytes = null) {
  const ast = queries(value);
  const source = checks(value);
  const parseCounts = value && value.ast && value.ast.stats && value.ast.stats.parseCounts || {};
  return {
    bytes,
    estimatedTokens: bytes === null ? null : Math.ceil(bytes / 4),
    status: value && value.status || null,
    planId: value && value.runtime && value.runtime.planId || value && value.ast && value.ast.plan && value.ast.plan.id || null,
    parsedFiles: Object.keys(parseCounts).length,
    parseOperations: sum(Object.values(parseCounts), (count) => count),
    astQueries: ast.length,
    astGroupsMatched: sum(ast, (query) => (query.coverage && query.coverage.groupsMatched) ?? query.groupsAvailable),
    astGroupsReturned: sum(ast, (query) => (query.coverage && query.coverage.groupsReturned) ?? query.groupsReturned),
    sourceChecks: source.length,
    sourceMatches: sum(source, (check) => check.totalMatches),
    bounded: value && value.output ? value.output.bounded : null,
  };
}

function numericDelta(before, after) {
  if (before === null || after === null || before === undefined || after === undefined) return null;
  return after - before;
}

function compareStageRuns(before, after, options = {}) {
  const beforeMetrics = metrics(before, options.beforeBytes ?? null);
  const afterMetrics = metrics(after, options.afterBytes ?? null);
  const equivalence = compareStageRepresentations(before, after, options);
  const delta = {};
  for (const key of ["bytes", "estimatedTokens", "parsedFiles", "parseOperations", "astQueries", "astGroupsMatched", "astGroupsReturned", "sourceChecks", "sourceMatches"]) {
    delta[key] = numericDelta(beforeMetrics[key], afterMetrics[key]);
  }
  return { schemaVersion: "1.0.0", status: equivalence.ok ? "comparable" : "quality-regression", before: beforeMetrics, after: afterMetrics, delta, equivalence };
}

module.exports = { compareStageRuns, metrics };
