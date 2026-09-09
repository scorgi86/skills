const crypto = require("crypto");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableHash(value, length = 16) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex").slice(0, length);
}

function firstAnchor(group) {
  const evidence = group && (group.example || group.firstAnchor);
  if (!evidence || typeof evidence !== "object") return null;
  const anchor = {};
  for (const key of ["file", "line", "column", "range"]) {
    if (evidence[key] !== undefined && evidence[key] !== null) anchor[key] = evidence[key];
  }
  return Object.keys(anchor).length ? anchor : null;
}

function matchesSelector(group, selector) {
  if (typeof selector === "string") return group.key === selector;
  if (!selector || typeof selector !== "object") return false;
  return ["key", "owner", "relation", "field", "target"].every((key) => selector[key] === undefined || String(group[key]) === String(selector[key]));
}

function semanticBucket(group) {
  return `${group.owner || "<module>"}\u001f${group.relation || "unknown"}`;
}

function normalizeTerms(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeTerms);
  return String(value || "").split(",").map((term) => term.trim().toLowerCase()).filter(Boolean);
}

function relevanceScore(group, preferredTerms = []) {
  const values = {
    field: String(group.field || "").toLowerCase(),
    target: String(group.target || "").toLowerCase(),
    owner: String(group.owner || "").toLowerCase(),
    relation: String(group.relation || "").toLowerCase(),
  };
  return normalizeTerms(preferredTerms).reduce((score, term) => {
    if (values.field === term) return score + 12;
    if (values.field.includes(term)) return score + 9;
    if (values.target === term) return score + 8;
    if (values.target.includes(term)) return score + 6;
    if (values.owner.includes(term)) return score + 5;
    if (values.relation.includes(term)) return score + 2;
    return score;
  }, 0);
}

function selectDiverseGroups(groups, limit, requiredSelectors = [], preferredTerms = []) {
  const selected = [];
  const selectedKeys = new Set();
  const add = (group) => {
    if (!group || selectedKeys.has(group.key) || selected.length >= limit) return;
    selectedKeys.add(group.key);
    selected.push(group);
  };
  for (const selector of requiredSelectors) add(groups.find((group) => matchesSelector(group, selector)));
  const buckets = new Map();
  for (const group of groups) {
    if (selectedKeys.has(group.key)) continue;
    const key = semanticBucket(group);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(group);
  }
  const queues = [...buckets.entries()].map(([key, values]) => ({
    key,
    values: values.sort((left, right) => relevanceScore(right, preferredTerms) - relevanceScore(left, preferredTerms) || left.key.localeCompare(right.key)),
  }));
  while (selected.length < limit && queues.some((queue) => queue.values.length)) {
    const active = queues.filter((queue) => queue.values.length).sort((left, right) =>
      relevanceScore(right.values[0], preferredTerms) - relevanceScore(left.values[0], preferredTerms) || left.key.localeCompare(right.key));
    for (const queue of active) {
      add(queue.values.shift());
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function projectGroup(group) {
  return {
    key: group.key,
    owner: group.owner,
    relation: group.relation,
    field: group.field,
    target: group.target,
    items: group.items,
    evidence: group.evidence,
    firstAnchor: firstAnchor(group),
  };
}

function projectAst(ast, options = {}) {
  const results = Array.isArray(ast && ast.results) ? ast.results : [];
  const maxGroupsPerQuery = Math.max(1, Number(options.maxGroupsPerQuery) || 12);
  const required = options.requiredGroups || {};
  const preferred = options.preferredTerms || {};
  return {
    schemaVersion: "1.0.0",
    planId: ast && ast.plan ? ast.plan.id : null,
    status: ast && ast.status,
    stats: ast && ast.stats,
    queries: results.map((result) => {
      const groups = Array.isArray(result.semanticGroups) ? result.semanticGroups : Array.isArray(result.groups) ? result.groups : [];
      const preferredTerms = normalizeTerms(preferred[result.id] || result.projectionHints && result.projectionHints.preferredTerms || preferred.default || []);
      const requiredSelectors = required[result.id] || [];
      const effectiveLimit = Math.max(maxGroupsPerQuery, requiredSelectors.length);
      const selected = selectDiverseGroups(groups, effectiveLimit, requiredSelectors, preferredTerms);
      return {
        id: result.id,
        command: result.command,
        status: result.status,
        coverage: result.coverage,
        groupDigest: result.groupDigest || stableHash(groups.map((group) => group.key).sort()),
        groupsAvailable: groups.length,
        groupsReturned: selected.length,
        groupsOmitted: Math.max(0, groups.length - selected.length),
        groupsTruncated: selected.length < groups.length,
        ranking: preferredTerms.length ? { mode: "target-aware", preferredTerms } : { mode: "semantic-diversity" },
        groups: selected.map(projectGroup),
      };
    }),
  };
}

module.exports = { firstAnchor, matchesSelector, normalizeTerms, projectAst, relevanceScore, selectDiverseGroups, stableHash, stableValue };
