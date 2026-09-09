"use strict";

const path = require("node:path");

const { runFileBacked } = require("../../../shared/diagnostics/src/subprocess_output.js");
const { normalizeSearchProfile } = require("../../../shared/search/src/search_profile.js");

const { stableHash } = require("../../../shared/output/src/fact_projection.js");

const crypto = require("node:crypto");

const fs = require("node:fs");

const { extractTransition } = require("../../../shared/dto/src/extract_stage_transition.js");
const { transitionForRequest } = require("../../../state/src/session/inventory_session.js");

const { runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");

function normalizeCoverage(config) {
  if (!config || !config.id || !config.scope || !Array.isArray(config.terms) || !config.terms.length) throw new Error("Stage 5 requires nameCoverage with id, scope, and terms");
  return {
    id: String(config.id),
    scope: path.resolve(config.scope),
    terms: config.terms.map(String),
    extensions: normalizeSearchProfile(config.searchProfile || config.languages || config.extensions ? config : { extensions: [".js"] }).extensions.map(extension => `*${extension}`),
    excludeDirs: [...new Set((config.excludeDirs || []).map(String))].sort(),
    excludeFilePatterns: (config.excludeFilePatterns || []).map(String),
    followSymlinks: config.followSymlinks === true,
  };
}

function coverageGlobs(config) {
  const fileGlobs = config.excludeFilePatterns.map((pattern) => {
    if (pattern === "\\.min\\.js$") return "!**/*.min.js";
    if (pattern === "\\.map$") return "!**/*.map";
    throw new Error(`Unsupported Stage5 exclusion pattern ${pattern}; use excludeDirs or supported file suffix patterns`);
  }).filter(Boolean);
  return [
    ...config.extensions,
    ...config.excludeDirs.map((name) => `!**/${name}/**`),
    ...fileGlobs,
  ];
}

function runRg(args, dependencies = {}) {
  const result = runFileBacked("rg", args, {}, dependencies);
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
  const fileArgs = ["--files", "--no-ignore", "--hidden", ...(normalized.followSymlinks ? ["--follow"] : []), ...globs.flatMap((glob) => ["--glob", glob]), normalized.scope];
  const matchArgs = ["--files-with-matches", "--no-ignore", "--hidden", "--ignore-case", ...(normalized.followSymlinks ? ["--follow"] : []), ...globs.flatMap((glob) => ["--glob", glob]), "--regexp", normalized.terms.join("|"), normalized.scope];
  const excluded = normalized.excludeFilePatterns.map(pattern => new RegExp(pattern));
  const isIncluded = file => !excluded.some(pattern => pattern.test(file));
  const files = runRg(fileArgs, dependencies).map((item) => makeAbsolute(normalized.scope, item)).filter(isIncluded).sort();
  const matchingFiles = [...new Set(runRg(matchArgs, dependencies).map((item) => makeAbsolute(normalized.scope, item)).filter(isIncluded))].sort();
  return {
    id: normalized.id,
    engine: "rg",
    scope: normalized.scope,
    terms: normalized.terms,
    searchProfile: { ...normalizeSearchProfile(config), extensions: normalized.extensions.map(extension => extension.slice(1)) },
    exclusions: { directories: normalized.excludeDirs, patterns: normalized.excludeFilePatterns },
    complete: true,
    absenceClaim: false,
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

function runStage5(request, dependencies = {}, context = null) {
  if (Number(request && request.stage) !== 5) throw new Error("stage5_runner accepts only stage: 5");
  if (!request.transitionArtifact) throw new Error("transitionArtifact is required");
  if (!Array.isArray(request.checks) || !request.checks.length) throw new Error("Stage 5 requires targeted checks");
  const transition = extractTransition(transitionForRequest(context, request) || fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const coverage = (dependencies.findExactNameCoverage || findExactNameCoverage)(request.nameCoverage, dependencies);
  const coverageCheck = coverage.matchingFiles.length ? [{
    id: coverage.id,
    files: coverage.matchingFiles,
    extensions: normalizeSearchProfile(request.nameCoverage).extensions,
    allowWideScope: true,
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
    capabilities: require("../../../shared/dto/src/capability_contract.js").normalizeCapabilities(request.capabilities || []),
    status: sourceEvidence.checks.some(check => check.resultComplete === false) ? "partial" : "candidate",
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

module.exports = { buildSummary, coverageGlobs, findExactNameCoverage, fingerprintFiles, normalizeCoverage, runStage5 };
