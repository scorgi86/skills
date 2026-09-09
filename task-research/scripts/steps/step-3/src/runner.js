"use strict";

const fs = require("node:fs");

const path = require("node:path");

const { extractTransition } = require("../../../shared/dto/src/extract_stage_transition.js");

const { runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");

const { normalizeSearchProfile } = require("../../../shared/search/src/search_profile.js");
const { transitionForRequest } = require("../../../state/src/session/inventory_session.js");

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function runStage3(request, dependencies = {}, context = null) {
  if (Number(request && request.stage) !== 3) throw new Error("stage3_runner accepts only stage: 3");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  const previous = transitionForRequest(context, request) || JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const transition = extractTransition(previous);
  const boundaries = (previous.facts || []).filter((item) => item.kind === "boundary").map(({ kind, boundaryKind, ...item }) => ({ ...item, kind: boundaryKind }));
  const scopes = new Map((request.consumerScopes || []).map((item) => [item.id, item]));
  const checks = [];
  const consumerCoverage = [];
  for (const boundary of boundaries) {
    for (const consumerRepo of boundary.consumerRepos || []) {
      const consumer = scopes.get(consumerRepo);
      if (!consumer || !consumer.scope) {
        consumerCoverage.push({ boundaryId: boundary.id, consumerRepo, status: "unverified", reason: "No consumer scope was supplied" });
        continue;
      }
      const id = `${boundary.id}@${consumerRepo}`;
      const searchProfile = normalizeSearchProfile(consumer);
      checks.push({ id, scope: consumer.scope, extensions: searchProfile.extensions, patterns: (boundary.searchTerms || []).map((value) => ({ id: value, value: escapeRegex(value), regex: true })), maxFiles: Number(consumer.maxFiles || request.maxFiles || 200), maxMatches: Number(consumer.maxMatches || request.maxMatches || 20), groupBy: "file-pattern", excludeDirs: consumer.excludeDirs || request.excludeDirs, excludeFilePatterns: consumer.excludeFilePatterns || request.excludeFilePatterns, followSymlinks: consumer.followSymlinks === true || request.followSymlinks === true });
      consumerCoverage.push({ boundaryId: boundary.id, consumerRepo, status: "candidate", scope: consumer.scope, searchProfile, checkId: id });
    }
  }
  const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({ checks, maxFiles: Number(request.maxFiles || 200), maxMatches: Number(request.maxMatches || 20), excludeDirs: request.excludeDirs, excludeFilePatterns: request.excludeFilePatterns, followSymlinks: request.followSymlinks === true, retainAllMatches: true });
  for (const coverage of consumerCoverage) {
    const check = sourceEvidence.checks.find(item => item.id === coverage.checkId);
    if (check) Object.assign(coverage, { status: check.status, filesScanned: check.filesScanned, totalMatches: check.totalMatches, truncated: check.truncated, searchedScope: check.spec, resultComplete: check.resultComplete, errors: check.errors || [], skipped: check.skipped || [], absenceClaim: false });
  }
  const limitations = consumerCoverage.filter((item) => ["unverified", "partial"].includes(item.status)).map((item) => `${item.boundaryId}@${item.consumerRepo}: ${item.reason || "Consumer search is incomplete"}`);
  return { schemaVersion: "1.1.0", stage: 3, status: limitations.length ? "partial" : "candidate", transition, boundaries, consumerCoverage, sourceEvidence, capabilities: require("../../../shared/dto/src/capability_contract.js").normalizeCapabilities(request.capabilities || []), limitations };
}

module.exports = { escapeRegex, runStage3 };
