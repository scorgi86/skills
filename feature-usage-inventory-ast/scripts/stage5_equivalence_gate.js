#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function evidence(facts) { return facts.sourceEvidence ? facts.sourceEvidence.checks : facts.checks; }
function normalizeMatches(check) { return (check.fullMatches || []).map((match) => `${match.file}\u001f${match.line}\u001f${match.snippet}`).sort(); }
function fileHash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function fingerprint(facts) {
  const files = [...new Set(evidence(facts).flatMap((check) => (check.fullMatches || []).map((match) => match.file)))].sort();
  return files.map((file) => ({ file, sha256: fileHash(file) }));
}
function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function compareStage5Facts(baseline, candidate) {
  const baselineChecks = new Map(evidence(baseline).map((check) => [check.id, check]));
  const candidateChecks = new Map(evidence(candidate).map((check) => [check.id, check]));
  const ids = [...new Set([...baselineChecks.keys(), ...candidateChecks.keys()])].sort();
  const checks = ids.map((id) => {
    const left = baselineChecks.get(id);
    const right = candidateChecks.get(id);
    return { id, present: Boolean(left && right), totalMatchesEqual: Boolean(left && right && left.totalMatches === right.totalMatches), anchorsEqual: Boolean(left && right && equal(normalizeMatches(left), normalizeMatches(right))) };
  });
  const baselineCoverage = baseline.nameCoverage || { filesScanned: baselineChecks.get("direct-renderer-name-coverage")?.filesScanned, matchingFileCount: new Set((baselineChecks.get("direct-renderer-name-coverage")?.fullMatches || []).map((match) => match.file)).size };
  const candidateCoverage = candidate.nameCoverage || { filesScanned: candidateChecks.get("direct-renderer-name-coverage")?.filesScanned, matchingFileCount: new Set((candidateChecks.get("direct-renderer-name-coverage")?.fullMatches || []).map((match) => match.file)).size };
  const freshness = fingerprint(candidate);
  const baselineFreshness = fingerprint(baseline);
  const coverageEqual = baselineCoverage.filesScanned === candidateCoverage.filesScanned && baselineCoverage.matchingFileCount === candidateCoverage.matchingFileCount;
  const ok = checks.every((check) => check.present && check.totalMatchesEqual && check.anchorsEqual) && coverageEqual && equal(baselineFreshness, freshness);
  return { schemaVersion: "1.0.0", gate: "stage5-equivalence", status: ok ? "equivalent" : "not-equivalent", checks, coverage: { baseline: baselineCoverage, candidate: candidateCoverage, equal: coverageEqual }, sourceFreshness: { algorithm: "sha256", files: freshness, equal: equal(baselineFreshness, freshness) } };
}
function main() {
  try {
    const args = process.argv.slice(2); const get = (flag) => args[args.indexOf(flag) + 1];
    const baselineFile = get("--baseline"); const candidateFile = get("--candidate");
    if (!baselineFile || !candidateFile) throw new Error("Provide --baseline <facts.json> --candidate <facts.json>");
    const result = compareStage5Facts(JSON.parse(fs.readFileSync(path.resolve(baselineFile), "utf8")), JSON.parse(fs.readFileSync(path.resolve(candidateFile), "utf8")));
    const output = get("--output"); if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ gate: result.gate, status: result.status, checks: result.checks.length, coverageEqual: result.coverage.equal, freshnessEqual: result.sourceFreshness.equal, output: output ? path.resolve(output) : null })}\n`);
    if (result.status !== "equivalent") process.exitCode = 1;
  } catch (error) { process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`); process.exitCode = 2; }
}
if (require.main === module) main();
module.exports = { compareStage5Facts, fingerprint, normalizeMatches };
