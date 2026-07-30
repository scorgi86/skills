#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { extractTransition } = require("./extract_stage_transition");
const { runEvidenceChecks } = require("./source_evidence");

function normalizeFamilies(request) {
  if (!Array.isArray(request.recipientFamilies) || !request.recipientFamilies.length) throw new Error("Stage 4 requires recipientFamilies");
  const ids = new Set();
  return request.recipientFamilies.map((family) => {
    if (!family || !family.id || !family.receiver || !family.relation || !Array.isArray(family.checks) || !family.checks.length) throw new Error("Each recipient family requires id, receiver, relation, and checks");
    if (ids.has(family.id)) throw new Error(`Duplicate recipient family: ${family.id}`);
    ids.add(family.id);
    return { ...family, id: String(family.id) };
  });
}

function runStage4(request, dependencies = {}) {
  if (Number(request && request.stage) !== 4) throw new Error("stage4_runner accepts only stage: 4");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  const transition = extractTransition(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const families = normalizeFamilies(request);
  const checks = families.flatMap((family) => family.checks.map((check, index) => ({
    ...check,
    id: `${family.id}/${check.id || index + 1}`,
    retainAllMatches: true,
  })));
  const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({
    checks,
    maxFiles: Number(request.maxFiles || 200),
    maxMatches: Number(request.maxMatches || 20),
    excludeDirs: request.excludeDirs,
    excludeFilePatterns: request.excludeFilePatterns,
    followSymlinks: request.followSymlinks === true,
    retainAllMatches: true,
  });
  const evidenceById = new Map(sourceEvidence.checks.map((check) => [check.id, check]));
  const recipientFamilies = families.map((family) => {
    const familyChecks = family.checks.map((check, index) => evidenceById.get(`${family.id}/${check.id || index + 1}`));
    const matched = familyChecks.reduce((sum, check) => sum + (check && check.totalMatches || 0), 0);
    return {
      id: family.id,
      receiver: family.receiver,
      relation: family.relation,
      status: matched ? "candidate" : "candidate-empty",
      checkIds: familyChecks.map((check) => check.id),
      totalMatches: matched,
      fullObservationCount: familyChecks.reduce((sum, check) => sum + (check.fullMatches || []).length, 0),
      metadata: family.metadata || null,
    };
  });
  return {
    schemaVersion: "1.0.0",
    stage: 4,
    capabilities: require("./capability_contract").normalizeCapabilities(request.capabilities || []),
    status: "candidate",
    transition,
    recipientFamilies,
    priorEvidence: request.priorEvidence || [],
    sourceEvidence,
    reusableForNextStage: { sourceEvidence: true, familyCheckIds: recipientFamilies.flatMap((family) => family.checkIds) },
  };
}

function buildSummary(result, outputFile) {
  return {
    schemaVersion: result.schemaVersion,
    stage: result.stage,
    status: result.status,
    output: path.resolve(outputFile),
    recipientFamilies: result.recipientFamilies.map((family) => ({
      id: family.id,
      status: family.status,
      totalMatches: family.totalMatches,
      fullObservationCount: family.fullObservationCount,
    })),
    priorEvidenceCount: result.priorEvidence.length,
    reusableForNextStage: result.reusableForNextStage,
  };
}

function main() {
  try {
    const requestIndex = process.argv.indexOf("--request");
    if (requestIndex < 0 || !process.argv[requestIndex + 1]) throw new Error("Provide --request <json-file>");
    const result = runStage4(JSON.parse(fs.readFileSync(path.resolve(process.argv[requestIndex + 1]), "utf8")));
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex >= 0) {
      if (!process.argv[outputIndex + 1]) throw new Error("Provide a file after --output");
      const outputFile = path.resolve(process.argv[outputIndex + 1]);
      fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify(buildSummary(result, outputFile))}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { buildSummary, normalizeFamilies, runStage4 };
