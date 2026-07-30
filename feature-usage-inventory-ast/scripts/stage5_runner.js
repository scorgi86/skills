#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { extractTransition } = require("./extract_stage_transition");
const { stableHash } = require("./fact_projection");
const { runEvidenceChecks } = require("./source_evidence");

const DEFAULT_EXCLUDE_DIRS = [".git", "node_modules", "dist", "build", "out", "coverage"];

function normalizeCoverage(config) {
  if (!config || !config.id || !config.scope || !Array.isArray(config.terms) || !config.terms.length) throw new Error("Stage 5 requires nameCoverage with id, scope, and terms");
  return {
    id: String(config.id),
    scope: path.resolve(config.scope),
    terms: config.terms.map(String),
    extensions: (config.extensions || [".js"]).map((extension) => extension.startsWith(".") ? `*${extension}` : `*.${extension}`),
    excludeDirs: [...new Set([...DEFAULT_EXCLUDE_DIRS, ...(config.excludeDirs || [])].map(String))].sort(),
    excludeFilePatterns: (config.excludeFilePatterns || []).map(String),
  };
}

function coverageGlobs(config) {
  const fileGlobs = config.excludeFilePatterns.map((pattern) => {
    if (pattern === "\\.min\\.js$") return "!**/*.min.js";
    if (pattern === "\\.map$") return "!**/*.map";
    return null;
  }).filter(Boolean);
  return [
    ...config.extensions,
    ...config.excludeDirs.map((name) => `!**/${name}/**`),
    ...fileGlobs,
  ];
}

function runRg(args, dependencies = {}) {
  const result = (dependencies.spawnSync || childProcess.spawnSync)("rg", args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw new Error(`rg failed: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1) throw new Error(`rg failed: ${String(result.stderr || "").trim() || `exit ${result.status}`}`);
  return String(result.stdout || "").split(/\r?\n/).filter(Boolean);
}

function makeAbsolute(scope, item) {
  return path.isAbsolute(item) ? path.resolve(item) : path.resolve(scope, item);
}

function findExactNameCoverage(config, dependencies = {}) {
  const normalized = normalizeCoverage(config);
  const globs = coverageGlobs(normalized);
  const fileArgs = ["--files", "--no-ignore", "--hidden", ...globs.flatMap((glob) => ["--glob", glob]), normalized.scope];
  const matchArgs = ["--files-with-matches", "--no-ignore", "--hidden", "--ignore-case", "--no-messages", ...globs.flatMap((glob) => ["--glob", glob]), "--regexp", normalized.terms.join("|"), normalized.scope];
  const files = runRg(fileArgs, dependencies).map((item) => makeAbsolute(normalized.scope, item)).sort();
  const matchingFiles = [...new Set(runRg(matchArgs, dependencies).map((item) => makeAbsolute(normalized.scope, item)))].sort();
  return {
    id: normalized.id,
    engine: "rg",
    scope: normalized.scope,
    terms: normalized.terms,
    filesScanned: files.length,
    matchingFileCount: matchingFiles.length,
    matchingFiles,
    fileDigest: stableHash(files),
    matchingFileDigest: stableHash(matchingFiles),
    query: { fileArgs, matchArgs },
  };
}

function fingerprintFiles(files) {
  return [...new Set(files.map((file) => path.resolve(file)))].sort().map((file) => ({ file, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }));
}

function runStage5(request, dependencies = {}) {
  if (Number(request && request.stage) !== 5) throw new Error("stage5_runner accepts only stage: 5");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  if (!Array.isArray(request.checks) || !request.checks.length) throw new Error("Stage 5 requires targeted checks");
  const transition = extractTransition(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const coverage = (dependencies.findExactNameCoverage || findExactNameCoverage)(request.nameCoverage, dependencies);
  const coverageCheck = coverage.matchingFiles.length ? [{
    id: coverage.id,
    files: coverage.matchingFiles,
    patterns: [{ id: "expected-name", value: coverage.terms.join("|"), regex: true }],
    maxMatches: Number(request.coverageMaxMatches || 20),
    retainAllMatches: true,
  }] : [];
  const sourceEvidence = (dependencies.runEvidenceChecks || runEvidenceChecks)({
    checks: [...request.checks, ...coverageCheck].map((check) => ({ ...check, retainAllMatches: true })),
    excludeDirs: request.excludeDirs,
    excludeFilePatterns: request.excludeFilePatterns,
    followSymlinks: request.followSymlinks === true,
    retainAllMatches: true,
  });
  const coverageEvidence = sourceEvidence.checks.find((check) => check.id === coverage.id) || null;
  const evidenceFiles = sourceEvidence.checks.flatMap((check) => (check.fullMatches || []).map((match) => match.file));
  return {
    schemaVersion: "1.0.0",
    stage: 5,
    capabilities: require("./capability_contract").normalizeCapabilities(request.capabilities || []),
    status: "candidate",
    transition,
    priorArtifacts: request.priorArtifacts || [],
    nameCoverage: { ...coverage, totalMatches: coverageEvidence ? coverageEvidence.totalMatches : 0, fullObservationCount: coverageEvidence ? coverageEvidence.fullMatches.length : 0 },
    sourceEvidence,
    sourceFreshness: { algorithm: "sha256", files: fingerprintFiles(evidenceFiles) },
    reusableForNextStage: { sourceEvidence: true, checkIds: sourceEvidence.checks.map((check) => check.id) },
  };
}

function buildSummary(result, outputFile) {
  return {
    schemaVersion: result.schemaVersion,
    stage: result.stage,
    status: result.status,
    output: path.resolve(outputFile),
    nameCoverage: {
      id: result.nameCoverage.id,
      filesScanned: result.nameCoverage.filesScanned,
      matchingFileCount: result.nameCoverage.matchingFileCount,
      totalMatches: result.nameCoverage.totalMatches,
      fullObservationCount: result.nameCoverage.fullObservationCount,
      matchingFileDigest: result.nameCoverage.matchingFileDigest,
    },
    targetedChecks: result.sourceEvidence.checks.filter((check) => check.id !== result.nameCoverage.id).map((check) => ({ id: check.id, totalMatches: check.totalMatches, fullObservationCount: check.fullMatches.length })),
    reusableForNextStage: result.reusableForNextStage,
  };
}

function main() {
  try {
    const requestIndex = process.argv.indexOf("--request");
    if (requestIndex < 0 || !process.argv[requestIndex + 1]) throw new Error("Provide --request <json-file>");
    const result = runStage5(JSON.parse(fs.readFileSync(path.resolve(process.argv[requestIndex + 1]), "utf8")));
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
module.exports = { buildSummary, coverageGlobs, findExactNameCoverage, fingerprintFiles, normalizeCoverage, runStage5 };
