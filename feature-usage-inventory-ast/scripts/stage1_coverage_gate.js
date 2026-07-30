"use strict";
const { validateOwnershipGraph } = require("./ownership_graph");

function astQueries(value) {
  return value && value.ast && (value.ast.results || value.ast.queries) || [];
}

function sourceChecks(value) {
  return value && value.sourceEvidence && (value.sourceEvidence.checks || value.sourceEvidence) || [];
}

function hasAnchor(value) {
  const anchor = value && (value.anchor || value.firstAnchor || value.example || value);
  return Boolean(anchor && (anchor.file || anchor.path || anchor.line || anchor.startLine));
}

function isConfirmed(group) {
  return /^(confirmed|подтвержденное использование)$/i.test(String(group && group.status || ""));
}

function anchorIdentity(value) {
  const anchor = value && (value.anchor || value.firstAnchor || value.example || value);
  const file = anchor && (anchor.file || anchor.path);
  const line = Number(anchor && (anchor.line || anchor.startLine));
  return file && Number.isFinite(line) && line > 0 ? { file: String(file).replace(/\\/g, "/").toLowerCase(), line } : null;
}

function sameAnchor(left, right) {
  const a = anchorIdentity(left);
  const b = anchorIdentity(right);
  return Boolean(a && b && a.file === b.file && a.line === b.line);
}

function hasFreshness(value) {
  const freshness = value && value.freshness;
  return Boolean(freshness && freshness.algorithm === "sha256" && /^[a-f0-9]{64}$/i.test(String(freshness.fragmentHash || "")) && Number(freshness.radius) >= 0);
}

function stageIs(value, expected) {
  return new RegExp(`(?:^|\\D)${expected}(?:\\D|$)`).test(String(value || ""));
}

function evaluateStage1Coverage(input, options = {}) {
  const value = input || {};
  const errors = [];
  const warnings = [];
  if (Number(value.stage) !== 1) errors.push("Coverage gate requires stage 1 data");

  const transition = value.transition || {};
  const fields = transition.fields || {};
  if (options.requireTransition !== false) {
    if (!transition.valid) errors.push("Stage 0 transition is invalid or missing");
    if (!stageIs(fields.stage, 0)) errors.push("Stage 1 must consume a stage 0 transition");
    if (!stageIs(fields["next stage"], 1)) errors.push("Stage 0 transition must point to stage 1");
  }

  const stats = value.ast && value.ast.stats || {};
  const parseCounts = Object.values(stats.parseCounts || {});
  if (parseCounts.some((count) => count !== 1)) errors.push("Every parsed file must have parse count 1");
  if (Number(stats.failed || 0) > 0) errors.push(`AST parse failures: ${stats.failed}`);
  const plan = value.ast && value.ast.plan || null;
  if (astQueries(value).length && !plan) errors.push("AST plan metadata is missing");
  if (plan && plan.compiledBeforeParse !== true) errors.push("AST plan was not compiled before parse");
  if (plan && Number(plan.lateQueries || 0) !== 0) errors.push(`AST late queries: ${plan.lateQueries}`);

  for (const query of astQueries(value)) {
    const id = query.id || query.command || "<query>";
    const coverage = query.coverage || {};
    if ((coverage.detailsRequested || 0) !== (coverage.detailsReturned || 0)) errors.push(`${id}: requested and returned details differ`);
    if ((coverage.detailsSuppressed || 0) !== 0) errors.push(`${id}: details were suppressed`);
    if ((coverage.detailEvidenceSuppressed || 0) !== 0) errors.push(`${id}: detail evidence was suppressed`);
    if ((coverage.groupsMatched || 0) > 0 && !query.groupDigest) errors.push(`${id}: group digest is missing`);
    for (const group of query.groups || []) if (!hasAnchor(group)) errors.push(`${id}/${group.key || "<group>"}: first anchor is missing`);
  }

  for (const check of sourceChecks(value)) {
    const id = check.id || "<check>";
    if ((check.groupsTotal || (check.groups || []).length) > 0 && !check.groupDigest) errors.push(`${id}: source group digest is missing`);
    for (const group of check.groups || []) if (!hasAnchor(group)) errors.push(`${id}/${group.key || "<group>"}: source first anchor is missing`);
    if (check.status === "candidate-empty") warnings.push(`${id}: empty source result remains candidate-only`);
  }

  const ownership = value.ownership && value.ownership.groups || [];
  if (value.ownershipGraph) {
    const graphValidation = validateOwnershipGraph(value.ownershipGraph);
    if (!graphValidation.ok) errors.push(...graphValidation.errors.map((error) => `ownershipGraph: ${error}`));
  }
  const expectedIds = [...new Set(value.ownership && value.ownership.expectedIds || [])];
  if (!expectedIds.length) errors.push("Stage 1 must declare expected ownership ids");
  const actualIds = new Set(ownership.map((group) => group.id));
  for (const id of expectedIds) if (!actualIds.has(id)) errors.push(`${id}: expected ownership group is missing`);

  const boundaryIds = new Set();
  for (const boundary of value.boundaries || []) {
    const id = String(boundary.id || "<boundary>");
    if (boundaryIds.has(id)) errors.push(`${id}: duplicate boundary candidate`);
    boundaryIds.add(id);
    if (!boundary.producerRepo || !boundary.kind || !boundary.symbol || !boundary.relation) errors.push(`${id}: boundary metadata is incomplete`);
    if (!hasAnchor(boundary.anchor)) errors.push(`${id}: boundary source anchor is missing`);
    if (!(boundary.evidenceRefs || []).length) errors.push(`${id}: boundary evidence references are missing`);
    if (!(boundary.searchTerms || []).length) errors.push(`${id}: boundary search terms are missing`);
    if (!(boundary.consumerRepos || []).length) errors.push(`${id}: boundary consumer scope is missing`);
    for (const ownershipId of boundary.ownershipRefs || []) if (!actualIds.has(ownershipId)) errors.push(`${id}: boundary ownership reference ${ownershipId} is missing`);
    if (boundary.status !== "candidate") errors.push(`${id}: boundary candidates must remain candidate at stage 1`);
  }

  const contract = value.coverageContract || {};
  const categories = Array.isArray(contract.categories) ? contract.categories : [];
  if (!categories.length) errors.push("Stage 1 requires a coverage contract with categories");
  for (const category of categories) {
    const id = category.id || "<category>";
    const status = category.status;
    const groupIds = [...new Set(category.groupIds || [])];
    if (!id || !["applicable", "not-applicable", "open"].includes(status)) errors.push(`${id}: coverage category has invalid status`);
    if (status === "applicable" && !groupIds.length) errors.push(`${id}: applicable coverage category lacks group ids`);
    if (["not-applicable", "open"].includes(status) && !String(category.reason || "").trim()) errors.push(`${id}: ${status} coverage category lacks reason`);
    if (category.requiredBeforeClose === true && status === "open") errors.push(`${id}: required-before-close coverage category remains open`);
    for (const groupId of groupIds) if (!actualIds.has(groupId)) errors.push(`${id}: declared group ${groupId} is missing`);
  }
  const baseline = contract.baseline || {};
  const baselineIds = [...new Set(baseline.ownershipIds || [])];
  const exemptions = new Map((baseline.exemptions || []).map((item) => [item.id, item]));
  for (const id of baselineIds) {
    if (actualIds.has(id)) continue;
    const exemption = exemptions.get(id);
    if (!(exemption && exemption.status === "not-applicable" && String(exemption.reason || "").trim())) errors.push(`${id}: baseline ownership group is missing without a not-applicable exemption`);
  }
  for (const group of ownership.filter((item) => item.required !== false)) {
    const id = group.id || group.object || "<ownership>";
    if (!group.object || !group.relation) errors.push(`${id}: required ownership group lacks object or relation`);
    if (!hasAnchor(group)) errors.push(`${id}: required ownership group lacks a source anchor`);
    if (isConfirmed(group) && !(group.confirmation && group.confirmation.method && hasAnchor(group.confirmation))) {
      errors.push(`${id}: confirmed ownership group lacks an explicit confirmation record`);
    }
    if (isConfirmed(group) && group.confirmation && group.confirmation.method && hasAnchor(group.confirmation) && !sameAnchor(group, group.confirmation)) {
      errors.push(`${id}: confirmed ownership anchor must match confirmation`);
    }
    if (isConfirmed(group) && !(group.confirmation && hasFreshness(group.confirmation))) errors.push(`${id}: confirmed ownership group lacks a source freshness hash`);
  }

  const observations = Array.isArray(value.observations) ? value.observations : [];
  const observationIds = new Set(observations.map((item) => item.id));
  for (const observation of observations) {
    const id = observation.id || "<observation>";
    if (!observation.id || !observation.status || !String(observation.scope || "").trim()) errors.push(`${id}: observation requires id, status, and scope`);
  }
  const ledger = value.claimLedger || {};
  const claims = Array.isArray(ledger.claims) ? ledger.claims : [];
  if (ledger.required === true && !claims.length) errors.push("Stage 1 requires a non-empty claim ledger");
  for (const claim of claims) {
    const id = claim.id || "<claim>";
    const groupIds = [...new Set(claim.groupIds || [])];
    const claimedObservationIds = [...new Set(claim.observationIds || [])];
    if (!claim.id || !String(claim.status || "").trim()) errors.push(`${id}: claim requires id and status`);
    if (!groupIds.length && !claimedObservationIds.length) errors.push(`${id}: claim requires groupIds or observationIds`);
    for (const groupId of groupIds) if (!actualIds.has(groupId)) errors.push(`${id}: claimed ownership group ${groupId} is missing`);
    for (const observationId of claimedObservationIds) if (!observationIds.has(observationId)) errors.push(`${id}: claimed observation ${observationId} is missing`);
  }

  const graph = value.gitnexus || {};
  const requests = graph.requests || [];
  if (requests.length > 1 && !graph.fallbackReason) errors.push("More than one GitNexus context request requires fallbackReason");
  if (graph.status === "tool-unavailable") warnings.push("GitNexus is unavailable; source/AST fallback is required");

  const output = value.output || {};
  if (output.autoRaised) errors.push("Facts budget was exceeded");
  if (output.bounded === false) errors.push("Facts output is not bounded");
  const summary = value.quality && value.quality.summary || {};
  if (summary.overflow) errors.push("Summary budget overflow");
  return {
    schemaVersion: "1.0.0",
    status: errors.length ? "blocked" : "passed",
    ok: errors.length === 0,
    checks: {
      parseFiles: parseCounts.length,
      astQueries: astQueries(value).length,
      sourceChecks: sourceChecks(value).length,
      requiredOwnershipGroups: ownership.filter((item) => item.required !== false).length,
      claims: claims.length,
      observations: observations.length,
      graphRequests: requests.length,
    },
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

module.exports = { anchorIdentity, evaluateStage1Coverage, hasAnchor, hasFreshness, isConfirmed, sameAnchor };
