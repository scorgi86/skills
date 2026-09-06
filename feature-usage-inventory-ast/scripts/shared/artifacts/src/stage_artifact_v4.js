"use strict";
const crypto = require("node:crypto"), fs = require("node:fs");
const path = require("node:path");
const { createCanonicalStageResult } = require("./canonical/result.js");
const { prepareFacts } = require("./canonical/facts.js");
const { validateCanonicalStageResult } = require("./canonical/validation.js");
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeCompactJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value)}\n`); }
function fileDigest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function compactEvidence(items) { const files = [...new Set(items.map((item) => item.file).filter(Boolean))].sort(); const fileIds = new Map(files.map((file, index) => [file, index])); return { files, evidence: items.map(({ file, repository, ...item }) => ({ ...item, ...(file ? { fileId: fileIds.get(file) } : {}), ...(repository ? { repository } : {}) })) }; }
function writeStageArtifact({ outputDir, facts, input, usage, retainRaw = false, metrics = {} }) {
  const root = path.resolve(outputDir), canonicalDir = path.join(root, "canonical");
  const runnerFacts = facts;
  facts = prepareFacts(facts);
  const canonical = createCanonicalStageResult({ facts, input, usage, metrics });
  const validation = validateCanonicalStageResult(canonical);
  if (!validation.ok) throw new Error(`Invalid canonical stage result: ${validation.errors.join("; ")}`);
  const evidence = Array.isArray(facts.canonicalEvidence) ? facts.canonicalEvidence : facts.modelType === "inventory-report-model" && Array.isArray(facts.evidenceIndex) ? facts.evidenceIndex : [];
  const resultFile = path.join(canonicalDir, "stage-result.json"), evidenceFile = path.join(canonicalDir, "evidence.json");
  writeJson(resultFile, canonical);
  const compacted = compactEvidence(evidence);
  const evidenceArtifact = { schemaVersion: "canonical-evidence/4.0.0", stage: canonical.stage, files: compacted.files, evidence: compacted.evidence };
  writeCompactJson(evidenceFile, evidenceArtifact);
  const files = { canonicalResult: { path: "canonical/stage-result.json", sha256: fileDigest(resultFile) }, canonicalEvidence: { path: "canonical/evidence.json", sha256: fileDigest(evidenceFile) } };
  let rawFile = null;
  if (retainRaw) { rawFile = path.join(root, "raw", "runner-result.json"); writeJson(rawFile, runnerFacts); files.raw = { path: "raw/runner-result.json", sha256: fileDigest(rawFile) }; }
  const manifest = { schemaVersion: "stage-artifact-manifest/4.0.0", stage: canonical.stage, status: canonical.status, inputDigest: canonical.inputDigest, outputDigest: canonical.outputDigest, retainRaw: Boolean(retainRaw), files };
  const manifestFile = path.join(canonicalDir, "manifest.json"); writeJson(manifestFile, manifest);
  const artifactValidation = validateStageArtifact(root);
  if (!artifactValidation.ok) throw new Error(`Stage artifact post-write validation failed: ${artifactValidation.errors.join("; ")}`);
  return { root, resultFile, evidenceFile, manifestFile, rawFile, canonical, manifest };
}
function readCanonicalStageResult(file) { const value = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); const validation = validateCanonicalStageResult(value); if (!validation.ok) throw new Error(`Invalid canonical stage result: ${validation.errors.join("; ")}`); return value; }
function validateStageArtifact(outputDir) { const root = path.resolve(outputDir), errors = []; let manifest; try { manifest = JSON.parse(fs.readFileSync(path.join(root, "canonical", "manifest.json"), "utf8")); } catch (error) { return { ok: false, errors: [`manifest unreadable: ${error.message}`] }; } for (const [name, entry] of Object.entries(manifest.files || {})) { const file = path.resolve(root, entry.path || ""); if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) errors.push(`${name}: file missing or outside artifact`); else if (fileDigest(file) !== entry.sha256) errors.push(`${name}: sha256 mismatch`); } try { const canonical = readCanonicalStageResult(path.join(root, manifest.files.canonicalResult.path)); if (canonical.inputDigest !== manifest.inputDigest || canonical.outputDigest !== manifest.outputDigest || canonical.stage !== manifest.stage) errors.push("manifest does not match canonical result"); const evidenceArtifact = JSON.parse(fs.readFileSync(path.join(root, manifest.files.canonicalEvidence.path), "utf8")); const ids = new Set((evidenceArtifact.evidence || []).map((item) => item.id)), claims = canonical.facts.filter((item) => ["confirmed", "source-confirmed", "checked-no-usage"].includes(item.status)), referenced = new Set([...canonical.evidenceRefs, ...claims.flatMap((item) => item.evidenceRefs || [])]); for (const id of referenced) if (!ids.has(id)) errors.push(`unresolved evidenceRef: ${id}`); } catch (error) { errors.push(error.message); } if (Boolean(manifest.files.raw) !== Boolean(manifest.retainRaw)) errors.push("retainRaw does not match manifest files"); return { ok: errors.length === 0, errors }; }
module.exports = { compactEvidence, fileDigest, readCanonicalStageResult, validateStageArtifact, writeStageArtifact };
