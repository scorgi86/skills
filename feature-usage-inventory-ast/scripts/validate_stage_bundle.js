#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { findInternalReportIdentifiers } = require("./human_report_codec");
const { validate: validateStageReport } = require("./validate_inventory_stage");

const REQUIRED = ["report.md", "manifest.json", "transition.json", "facts.json", "findings.jsonl", "evidence.jsonl.gz", "coverage.json", "validation.json"];

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function validateStageBundle(directory) {
  const root = path.resolve(directory);
  const errors = [];
  const warnings = [];
  for (const relative of REQUIRED) if (!fs.existsSync(path.join(root, relative))) errors.push(`Missing artifact: ${relative}`);
  if (errors.length) return { schemaVersion: "1.0.0", ok: false, status: "failed", errors, warnings };

  let manifest;
  let findings;
  try { manifest = readJson(path.join(root, "manifest.json")); } catch (error) { errors.push(`Invalid manifest.json: ${error.message}`); }
  try { findings = readJsonl(path.join(root, "findings.jsonl")); } catch (error) { errors.push(`Invalid findings.jsonl: ${error.message}`); findings = []; }
  if (manifest) {
    if (Number(manifest.stage) !== 2) errors.push("Manifest stage must be 2");
    for (const artifact of manifest.artifacts || []) {
      const file = path.resolve(root, artifact.path);
      if (path.relative(root, file).startsWith("..")) { errors.push(`Artifact escapes bundle: ${artifact.path}`); continue; }
      if (!fs.existsSync(file)) { errors.push(`Manifest artifact is missing: ${artifact.path}`); continue; }
      if (fs.statSync(file).size !== artifact.bytes) errors.push(`Size mismatch: ${artifact.path}`);
      if (sha256File(file) !== artifact.sha256) errors.push(`SHA-256 mismatch: ${artifact.path}`);
    }
  }

  const evidenceIds = new Set();
  try {
    const zlib = require("node:zlib");
    const text = zlib.gunzipSync(fs.readFileSync(path.join(root, "evidence.jsonl.gz"))).toString("utf8");
    for (const line of text.split(/\r?\n/).filter(Boolean)) evidenceIds.add(JSON.parse(line).id);
  } catch (error) { errors.push(`Invalid evidence.jsonl.gz: ${error.message}`); }
  for (const finding of findings || []) {
    if (finding.status === "confirmed" && !(finding.evidenceRefs || []).length) errors.push(`Confirmed finding has no evidence: ${finding.title}`);
    for (const reference of finding.evidenceRefs || []) if (!evidenceIds.has(reference)) errors.push(`Finding references missing evidence: ${finding.title}`);
  }

  const report = fs.readFileSync(path.join(root, "report.md"), "utf8");
  if (!/```mermaid[\s\S]*flowchart/.test(report)) errors.push("Report misses generated Mermaid pipeline");
  if (!/## Артефакты/.test(report)) errors.push("Report misses artifact links section");
  const internal = findInternalReportIdentifiers(report);
  if (internal.length) errors.push(`Report contains internal identifiers: ${internal.join(", ")}`);
  for (const match of report.matchAll(/\[[^\]]+\]\((\.\/[^)]+)\)/g)) {
    const linked = path.resolve(root, match[1]);
    if (path.relative(root, linked).startsWith("..") || !fs.existsSync(linked)) errors.push(`Broken report link: ${match[1]}`);
  }
  const stageReport = validateStageReport(report, 2);
  errors.push(...stageReport.errors.map((item) => `Stage report: ${item}`));
  warnings.push(...stageReport.warnings.map((item) => `Stage report: ${item}`));
  const transition = readJson(path.join(root, "transition.json"));
  const requiredFields = ["target", "scope", "stage", "status", "confirmed evidence", "candidate evidence", "dictionary/graph/path state", "skipped/forbidden", "open checks", "next stage"];
  for (const field of requiredFields) if (!transition.fields || !Object.hasOwn(transition.fields, field)) errors.push(`Transition misses field: ${field}`);

  return { schemaVersion: "1.0.0", ok: errors.length === 0, status: errors.length ? "failed" : "passed", errors, warnings, checks: { requiredArtifacts: REQUIRED.length, findings: findings && findings.length || 0, evidence: evidenceIds.size } };
}

function main() {
  try {
    const directory = process.argv[2];
    if (!directory) throw new Error("Provide bundle directory");
    const result = validateStageBundle(directory);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: [error.message] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { REQUIRED, validateStageBundle };
