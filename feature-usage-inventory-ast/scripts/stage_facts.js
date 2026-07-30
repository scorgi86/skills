const { byteLength, measureValue } = require("./measure_context");
const { projectAst } = require("./fact_projection");
const { compactSummaryAnchors } = require("./summary_compaction");
const { encodeHumanFields } = require("./human_report_codec");
const { normalizeCapabilities } = require("./capability_contract");

const DEFAULT_BUDGETS = Object.freeze({
  factsBytes: 96 * 1024,
  summaryBytes: 24 * 1024,
  evidenceBytes: 48 * 1024,
  reportBytes: 64 * 1024,
});

function positiveBytes(value, fallback, minimum = 1024) {
  const number = Number(value);
  return Math.max(minimum, Number.isFinite(number) && number > 0 ? number : fallback);
}

function normalizeBudgets(request = {}, defaults = DEFAULT_BUDGETS) {
  const configured = request.budgets || {};
  return {
    factsBytes: positiveBytes(configured.factsBytes ?? request.maxOutputBytes, defaults.factsBytes, 8192),
    summaryBytes: positiveBytes(configured.summaryBytes, defaults.summaryBytes),
    evidenceBytes: positiveBytes(configured.evidenceBytes, defaults.evidenceBytes),
    reportBytes: positiveBytes(configured.reportBytes, defaults.reportBytes),
  };
}

function createStageFacts({ stage, status, transition, ast, sourceEvidence, quality, budgets, capabilities = [] }) {
  return {
    schemaVersion: "2.0.0",
    stage,
    status,
    runtime: {
      contract: "stage-facts",
      contractVersion: "1.0.0",
      planId: ast && ast.plan ? ast.plan.id : null,
      budgets,
    },
    transition,
    ast,
    sourceEvidence,
    quality,
    capabilities: normalizeCapabilities(capabilities),
    measurements: {
      transition: measureValue(transition),
      ast: measureValue(ast),
      sourceEvidence: measureValue(sourceEvidence),
    },
  };
}

function projectSourceCheck(check, options = {}) {
  const configured = options.maxGroupsByCheck && options.maxGroupsByCheck[check.id] !== undefined
    ? options.maxGroupsByCheck[check.id]
    : options.maxGroupsPerCheck;
  const limit = configured === undefined ? Number.MAX_SAFE_INTEGER : Math.max(1, Number(configured) || 1);
  const requiredKeys = options.requiredGroupKeys && options.requiredGroupKeys[check.id] || [];
  const allGroups = check.groups || [];
  const required = requiredKeys.map((key) => allGroups.find((group) => group.key === key)).filter(Boolean);
  const selectedKeys = new Set(required.map((group) => group.key));
  const effectiveLimit = Math.max(limit, required.length);
  const selected = [...required, ...allGroups.filter((group) => !selectedKeys.has(group.key))].slice(0, effectiveLimit);
  const groupsTotal = check.groupsTotal || allGroups.length;
  return {
    id: check.id,
    status: check.status,
    filesScanned: check.filesScanned,
    totalMatches: check.totalMatches,
    returned: check.returned,
    truncated: check.truncated,
    groupDigest: check.groupDigest || null,
    groupsTotal,
    groupsAvailable: allGroups.length,
    groupsReturned: selected.length,
    groupsOmitted: Math.max(0, groupsTotal - selected.length),
    groupsTruncated: selected.length < groupsTotal,
    groups: selected.map((group) => ({
      key: group.key,
      label: group.label,
      totalMatches: group.totalMatches,
      returned: group.returned,
      truncated: group.truncated,
      firstAnchor: group.firstAnchor,
    })),
  };
}

function sourceProjection(sourceEvidence, options = {}) {
  return (sourceEvidence && Array.isArray(sourceEvidence.checks) ? sourceEvidence.checks : []).map((check) => projectSourceCheck(check, options));
}

function finalizeSummaryBudget(summary, budgetBytes) {
  summary.output = {
    bytes: 0,
    budget: budgetBytes,
    bounded: true,
    overflow: false,
    policy: "explicit-overflow-preserve-required-summary",
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = byteLength(summary);
    if (summary.output.bytes === bytes) break;
    summary.output.bytes = bytes;
  }
  summary.output.bytes = byteLength(summary);
  summary.output.overflow = summary.output.bytes > budgetBytes;
  summary.output.bounded = !summary.output.overflow;
  if (summary.output.overflow && summary.status !== "partial") summary.status = "partial";
  return summary;
}

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
    sourceEvidence: sourceProjection(facts.sourceEvidence, projection.source || {}),
  };
  if (projection.compactAnchors) summary.compaction = compactSummaryAnchors(summary, { anchorRoot: projection.anchorRoot });
  if (projection.humanDictionary) summary = encodeHumanFields(summary);
  return summary;
}

function projectionWithCaps(projection, astCap, sourceCap) {
  return {
    ...projection,
    maxGroupsPerQuery: astCap,
    source: { ...(projection.source || {}), maxGroupsPerCheck: sourceCap },
  };
}

function maxSourceGroups(facts) {
  return Math.max(1, ...(facts.sourceEvidence && facts.sourceEvidence.checks || []).map((check) => (check.groups || []).length));
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
      requestedCaps: { astGroupsPerQuery: requestedAst, sourceGroupsPerCheck: requestedSource },
      appliedCaps: { astGroupsPerQuery: appliedAst, sourceGroupsPerCheck: appliedSource },
      fit: false,
      policy: "reduce-low-ranked-representatives-preserve-required-groups",
    };
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const bytes = byteLength(value);
      const fit = bytes <= targetBytes;
      if (value.adaptive.finalBytesBeforeOutput === bytes && value.adaptive.fit === fit) break;
      value.adaptive.finalBytesBeforeOutput = bytes;
      value.adaptive.fit = fit;
    }
    return value;
  }

  summary = decorate(summary, astCap, sourceCap, attempts);

  while (byteLength(summary) > targetBytes && attempts < maxAttempts) {
    const candidates = [];
    if (astCap > minimumAst) {
      const candidate = decorate(assembleStageSummary(facts, options, projectionWithCaps(projection, astCap - 1, sourceCap)), astCap - 1, sourceCap, attempts + 1);
      candidates.push({ summary: candidate, astCap: astCap - 1, sourceCap, bytes: byteLength(candidate) });
    }
    if (sourceCap > minimumSource) {
      const candidate = decorate(assembleStageSummary(facts, options, projectionWithCaps(projection, astCap, sourceCap - 1)), astCap, sourceCap - 1, attempts + 1);
      candidates.push({ summary: candidate, astCap, sourceCap: sourceCap - 1, bytes: byteLength(candidate) });
    }
    if (!candidates.length) break;
    candidates.sort((left, right) => left.bytes - right.bytes || right.astCap + right.sourceCap - (left.astCap + left.sourceCap));
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
  const summary = projection.adaptive && projection.adaptive.enabled
    ? fitAdaptiveSummary(facts, options, budgets)
    : assembleStageSummary(facts, options, projection);
  return finalizeSummaryBudget(summary, budgets.summaryBytes);
}

module.exports = {
  DEFAULT_BUDGETS,
  assembleStageSummary,
  buildStageSummary,
  createStageFacts,
  finalizeSummaryBudget,
  fitAdaptiveSummary,
  normalizeBudgets,
  projectSourceCheck,
  sourceProjection,
};
