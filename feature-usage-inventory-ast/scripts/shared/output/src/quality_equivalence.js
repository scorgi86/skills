"use strict";

const { resolveCompactAnchor } = require("./summary/compaction.js");

const { decodeHumanFields } = require("./human_report_codec.js");

const AST_COUNTERS = ["totalItems", "groupsScanned", "groupsMatched", "detailsRequested", "detailsReturned", "detailsSuppressed", "detailEvidenceSuppressed"];

const SOURCE_COUNTERS = ["filesScanned", "totalMatches", "returned", "groupsTotal"];

function astQueries(value) {
  return value && value.ast && (value.ast.queries || value.ast.results) || [];
}

function sourceChecks(value) {
  return value && value.sourceEvidence && (value.sourceEvidence.checks || value.sourceEvidence) || [];
}

function queryMap(value) {
  return new Map(astQueries(value).map((query, index) => [String(query.id || `query-${index + 1}`), query]));
}

function checkMap(value) {
  return new Map(sourceChecks(value).map((check, index) => [String(check.id || `check-${index + 1}`), check]));
}

function normalizedAnchor(container, anchor) {
  if (!anchor) return null;
  const resolved = anchor.fileId !== undefined ? resolveCompactAnchor(container, anchor) : anchor;
  const line = resolved.line || resolved.range && resolved.range.start && resolved.range.start.line || null;
  const endLine = resolved.endLine || resolved.range && resolved.range.end && resolved.range.end.line || line;
  return { file: resolved.file || null, line, endLine };
}

function compareCounter(errors, scope, field, before, after) {
  if (before === undefined || before === null) return;
  if (after !== before) errors.push(`${scope}.${field}: expected ${before}, got ${after}`);
}

function compareStageRepresentations(beforeValue, afterValue, options = {}) {
  const before = decodeHumanFields(beforeValue);
  const after = decodeHumanFields(afterValue);
  const errors = [];
  const warnings = [];
  const beforeQueries = queryMap(before);
  const afterQueries = queryMap(after);

  for (const [id, baseline] of beforeQueries) {
    const candidate = afterQueries.get(id);
    if (!candidate) { errors.push(`Missing AST query: ${id}`); continue; }
    if (baseline.groupDigest && candidate.groupDigest !== baseline.groupDigest) errors.push(`AST digest changed for ${id}`);
    for (const field of AST_COUNTERS) compareCounter(errors, `ast.${id}`, field, baseline.coverage && baseline.coverage[field], candidate.coverage && candidate.coverage[field]);
    const required = options.requiredGroups && options.requiredGroups[id] || [];
    const candidateKeys = new Set((candidate.groups || []).map((group) => group.key));
    for (const selector of required) {
      const key = typeof selector === "string" ? selector : selector && selector.key;
      if (key && !candidateKeys.has(key)) errors.push(`Required AST group missing: ${id}/${key}`);
    }
    const baselineGroups = Array.isArray(baseline.groups) && baseline.groups.length ? baseline.groups : baseline.semanticGroups || [];
    const baselineByKey = new Map(baselineGroups.map((group) => [group.key, group]));
    for (const group of candidate.groups || []) {
      const original = baselineByKey.get(group.key);
      if (!original) continue;
      const left = normalizedAnchor(before, original.firstAnchor || original.example);
      const right = normalizedAnchor(after, group.firstAnchor || group.example);
      if (left && right && JSON.stringify(left) !== JSON.stringify(right)) errors.push(`AST anchor changed: ${id}/${group.key}`);
    }
  }

  const beforeChecks = checkMap(before);
  const afterChecks = checkMap(after);
  for (const [id, baseline] of beforeChecks) {
    const candidate = afterChecks.get(id);
    if (!candidate) { errors.push(`Missing source check: ${id}`); continue; }
    if (baseline.groupDigest && candidate.groupDigest !== baseline.groupDigest) errors.push(`Source digest changed for ${id}`);
    for (const field of SOURCE_COUNTERS) compareCounter(errors, `source.${id}`, field, baseline[field], candidate[field]);
    const required = options.requiredSourceGroups && options.requiredSourceGroups[id] || [];
    const candidateKeys = new Set((candidate.groups || []).map((group) => group.key));
    for (const key of required) if (!candidateKeys.has(key)) errors.push(`Required source group missing: ${id}/${key}`);
  }

  if (afterQueries.size > beforeQueries.size) warnings.push("Candidate contains additional AST queries");
  if (afterChecks.size > beforeChecks.size) warnings.push("Candidate contains additional source checks");
  return {
    schemaVersion: "1.0.0",
    status: errors.length ? "blocked" : "equivalent",
    ok: errors.length === 0,
    checks: { astQueries: beforeQueries.size, sourceChecks: beforeChecks.size },
    errors,
    warnings,
  };
}

module.exports = { AST_COUNTERS, SOURCE_COUNTERS, compareStageRepresentations, normalizedAnchor };
