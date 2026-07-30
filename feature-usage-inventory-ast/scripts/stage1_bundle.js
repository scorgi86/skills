#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { buildStage1Summary } = require("./stage1_runner");
const { renderStage1Report, transitionFields } = require("./render_stage1_report");

function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function compactJson(value) { return `${JSON.stringify(value)}\n`; }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function record(root, relative, purpose) {
  const file = path.join(root, relative);
  return { path: relative.replace(/\\/g, "/"), purpose, bytes: fs.statSync(file).size, sha256: sha256(file) };
}
function jsonl(values) { return values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : ""); }
function sourceArchive(facts) {
  const checks = facts.sourceEvidence && facts.sourceEvidence.checks || [];
  return {
    checks: checks.map((check) => ({ id: check.id, status: check.status, spec: check.spec || null, filesScanned: check.filesScanned, totalMatches: check.totalMatches, returned: check.returned, fullMatches: (check.fullMatches || []).length, groupDigest: check.groupDigest })),
    observations: checks.flatMap((check) => (check.fullMatches || []).map((match) => ({ schemaVersion: "1.0.0", kind: "source-observation", status: "candidate", check: check.id, source: { file: match.file, line: match.line }, pattern: match.patternId, groupKey: match.groupKey, snippet: match.snippet }))),
  };
}

function validateStage1Bundle(directory) {
  const root = path.resolve(directory);
  const required = ["facts.json", "summary.json", "coverage.json", "transition.json", "validation.json", "report.md", "manifest.json"];
  const errors = required.filter((name) => !fs.existsSync(path.join(root, name))).map((name) => `Missing artifact: ${name}`);
  if (errors.length) return { ok: false, errors };
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (Number(manifest.stage) !== 1) errors.push("Manifest stage must be 1");
  for (const item of manifest.artifacts || []) {
    const file = path.resolve(root, item.path);
    if (path.relative(root, file).startsWith("..") || !fs.existsSync(file)) errors.push(`Missing or escaping artifact: ${item.path}`);
    else if (fs.statSync(file).size !== item.bytes || sha256(file) !== item.sha256) errors.push(`Integrity mismatch: ${item.path}`);
  }
  return { ok: errors.length === 0, errors };
}

function buildStage1Bundle(facts, outputDirectory) {
  if (!facts || Number(facts.stage) !== 1) throw new Error("Stage 1 facts are required");
  if (!(facts.quality && facts.quality.coverageGate && facts.quality.coverageGate.ok)) throw new Error("Coverage gate must pass before publishing a bundle");
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output)) throw new Error(`Bundle destination already exists: ${output}`);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(output)}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(temporary);
  try {
    const transition = { schemaVersion: "1.0.0", fields: transitionFields(facts), valid: true };
    const source = sourceArchive(facts);
    const coverage = { schemaVersion: "1.0.0", stage: 1, status: facts.quality.coverageGate.status, gate: facts.quality.coverageGate, contract: facts.coverageContract || null, claimLedger: facts.claimLedger || null, observations: facts.observations || [], ast: { plan: facts.ast.plan, stats: facts.ast.stats }, source: facts.sourceEvidence.checks.map((item) => ({ id: item.id, groupDigest: item.groupDigest, totalMatches: item.totalMatches, groupsTotal: item.groupsTotal })) };
    const validation = { schemaVersion: "1.0.0", status: "passed", checks: { coverageGate: true, candidatePromotionDisabled: (facts.ownership.groups || []).filter((item) => /^(confirmed|подтвержденное использование)$/i.test(item.status || "")).every((item) => item.confirmation && item.confirmation.method) } };
    if (!validation.checks.candidatePromotionDisabled) throw new Error("Confirmed ownership group lacks confirmation record");
    write(path.join(temporary, "facts.json"), compactJson(facts));
    write(path.join(temporary, "checks.json"), json({ schemaVersion: "1.0.0", stage: 1, checks: source.checks }));
    write(path.join(temporary, "source-observations.jsonl.gz"), zlib.gzipSync(Buffer.from(jsonl(source.observations)), { level: 9, mtime: 0 }));
    write(path.join(temporary, "boundaries.json"), json({ schemaVersion: "1.0.0", stage: 1, candidates: facts.boundaries || [] }));
    write(path.join(temporary, "summary.json"), json(buildStage1Summary(facts, "facts.json")));
    write(path.join(temporary, "coverage.json"), json(coverage));
    write(path.join(temporary, "transition.json"), json(transition));
    write(path.join(temporary, "validation.json"), json(validation));
    const provisional = [record(temporary, "facts.json", "Complete stage facts"), record(temporary, "checks.json", "Executed source-check contracts"), record(temporary, "source-observations.jsonl.gz", "Complete source observations independent of report limits"), record(temporary, "boundaries.json", "Producer-consumer boundary candidates"), record(temporary, "summary.json", "Bounded model-visible summary"), record(temporary, "coverage.json", "Coverage counters and gate"), record(temporary, "transition.json", "Continuation transition"), record(temporary, "validation.json", "Bundle validation")];
    write(path.join(temporary, "report.md"), renderStage1Report(facts, { transition: transition.fields, artifacts: provisional }));
    const artifacts = [record(temporary, "report.md", "Human-readable stage report"), ...provisional];
    const manifest = { schemaVersion: "1.0.0", stage: 1, status: facts.status, planId: facts.ast && facts.ast.plan && facts.ast.plan.id || null, counts: { ownership: facts.ownership.groups.length, boundaries: (facts.boundaries || []).length, sourceChecks: facts.sourceEvidence.checks.length, sourceObservations: source.observations.length }, artifacts };
    write(path.join(temporary, "manifest.json"), json(manifest));
    const checked = validateStage1Bundle(temporary);
    if (!checked.ok) throw new Error(`Bundle validation failed: ${checked.errors.join("; ")}`);
    fs.renameSync(temporary, output);
    const summary = { status: facts.status, stage: 1, report: path.join(output, "report.md"), manifest: path.join(output, "manifest.json"), coverage: coverage.status, validation: "passed" };
    summary.stdoutBytes = Buffer.byteLength(`${JSON.stringify(summary)}\n`);
    return summary;
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

if (require.main === module) {
  try {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error("Usage: node stage1_bundle.js <facts.json> <new-directory>");
    process.stdout.write(`${JSON.stringify(buildStage1Bundle(JSON.parse(fs.readFileSync(path.resolve(input), "utf8")), output))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

module.exports = { buildStage1Bundle, sourceArchive, validateStage1Bundle };
