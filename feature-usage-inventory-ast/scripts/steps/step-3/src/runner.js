"use strict";

const fs = require("node:fs");

const path = require("node:path");

const { extractTransition } = require("../../../shared/dto/src/extract_stage_transition.js");

const { runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function runStage3(request, dependencies = {}) {
  if (Number(request && request.stage) !== 3) throw new Error("stage3_runner accepts only stage: 3");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  const previous = JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
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
      checks.push({ id, scope: consumer.scope, patterns: (boundary.searchTerms || []).map((value) => ({ id: value, value: escapeRegex(value), regex: true })), maxFiles: Number(consumer.maxFiles || request.maxFiles || 200), maxMatches: Number(consumer.maxMatches || request.maxMatches || 20), groupBy: "file-pattern", excludeDirs: consumer.excludeDirs || request.excludeDirs, excludeFilePatterns: consumer.excludeFilePatterns || request.excludeFilePatterns, followSymlinks: consumer.followSymlinks === true || request.followSymlinks === true });
      consumerCoverage.push({ boundaryId: boundary.id, consumerRepo, status: "candidate", scope: consumer.scope, checkId: id });
    }
  }
  const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({ checks, maxFiles: Number(request.maxFiles || 200), maxMatches: Number(request.maxMatches || 20), excludeDirs: request.excludeDirs, excludeFilePatterns: request.excludeFilePatterns, followSymlinks: request.followSymlinks === true, retainAllMatches: true });
  const limitations = consumerCoverage.filter((item) => item.status === "unverified").map((item) => `${item.boundaryId}@${item.consumerRepo}: ${item.reason}`);
  return { schemaVersion: "1.1.0", stage: 3, status: limitations.length ? "partial" : "candidate", transition, boundaries, consumerCoverage, sourceEvidence, capabilities: require("../../../shared/dto/src/capability_contract.js").normalizeCapabilities(request.capabilities || []), limitations };
}

module.exports = { escapeRegex, runStage3 };
