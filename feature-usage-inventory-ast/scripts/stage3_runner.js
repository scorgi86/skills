#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { extractTransition } = require("./extract_stage_transition");
const { runEvidenceChecks } = require("./source_evidence");

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function runStage3(request, dependencies = {}) {
  if (Number(request && request.stage) !== 3) throw new Error("stage3_runner accepts only stage: 3");
  if (!request.transitionArtifact || !request.boundaryArtifact) throw new Error("transitionArtifact and boundaryArtifact are required");
  const transition = extractTransition(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const boundaryData = JSON.parse(fs.readFileSync(path.resolve(request.boundaryArtifact), "utf8"));
  const scopes = new Map((request.consumerScopes || []).map((item) => [item.id, item]));
  const checks = [];
  const consumerCoverage = [];
  for (const boundary of boundaryData.candidates || []) {
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
  return { schemaVersion: "1.1.0", stage: 3, status: limitations.length ? "partial" : "candidate", transition, boundaries: boundaryData.candidates || [], consumerCoverage, sourceEvidence, capabilities: require("./capability_contract").normalizeCapabilities(request.capabilities || []), limitations };
}

function main() {
  try {
    const index = process.argv.indexOf("--request");
    if (index < 0 || !process.argv[index + 1]) throw new Error("Provide --request <json-file>");
    const request = JSON.parse(fs.readFileSync(path.resolve(process.argv[index + 1]), "utf8"));
    const result = runStage3(request);
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex >= 0) {
      if (!process.argv[outputIndex + 1]) throw new Error("Provide a file after --output");
      fs.writeFileSync(path.resolve(process.argv[outputIndex + 1]), `${JSON.stringify(result, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { escapeRegex, runStage3 };
