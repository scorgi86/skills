#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { normalizeCapabilities } = require("./capability_contract");
const { canonicalJson, normalizeReportModel, validateReportModel } = require("./report_model");

function readJson(file) { return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }
function requireArray(value, name) { if (!Array.isArray(value)) throw new Error(`${name} must be an array`); return value; }
function normalizeItems(items, key) { return requireArray(items, key).map((item) => { if (!item || typeof item !== "object") throw new Error(`${key} item must be an object`); return item; }); }
function buildStage7(request, dependencies = {}) {
  if (Number(request?.stage) !== 7) throw new Error("Stage 7 requires stage: 7");
  const priorArtifacts = requireArray(request.priorArtifacts, "priorArtifacts"); if (!priorArtifacts.length) throw new Error("Stage 7 requires priorArtifacts");
  const artifactBase = dependencies.artifactBase || process.cwd();
  const prior = priorArtifacts.map((file) => ({ file, facts: readJson(path.resolve(artifactBase, file)) }));
  const retainedCoverage = { artifacts: prior.map((item) => ({ stage: item.facts.stage, capabilities: normalizeCapabilities(item.facts.capabilities || []).map((capability) => capability.id) })) };
  const inherited = prior.flatMap((item) => normalizeCapabilities(item.facts.capabilities || []));
  const overrides = new Map(normalizeCapabilities(request.capabilities || []).map((item) => [item.id, item]));
  const capabilities = normalizeCapabilities([...inherited.filter((item) => !overrides.has(item.id)), ...overrides.values()]);
  const facts = normalizeReportModel({ ...request, priorArtifacts, provenance: { ...(request.provenance || {}), priorArtifacts, retainedCoverage }, coverage: { ...(request.coverage || {}), retainedCoverage }, capabilities });
  const validation = validateReportModel(facts);
  if (!validation.ok) throw new Error(`Stage 7 report model validation failed: ${validation.errors.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
  return facts;
}
function buildSummary(facts, output) { return { schemaVersion: facts.schemaVersion, modelType: facts.modelType, stage: facts.stage, status: facts.status, output: path.resolve(output), canonicalDigest: facts.integrity.canonicalDigest, counts: { confirmed: facts.confirmedUsages.length, checkedNoUsage: facts.checkedNoUsage.length, referenceOnly: facts.referenceOnly.length, retainedArtifacts: facts.coverage.retainedCoverage.artifacts.length, capabilities: facts.capabilities.length, noise: facts.noise.length, openChecks: facts.openChecks.length }, nextStage: facts.transition["next stage"] }; }
function formatFacts(facts) { return canonicalJson(facts).trimEnd(); }
function main() { try { const args = process.argv.slice(2); const get = (flag) => args[args.indexOf(flag) + 1]; const requestFile = get("--request"); const output = get("--output"); if (!requestFile || !output) throw new Error("Provide --request <json-file> --output <facts.json>"); const absoluteRequest = path.resolve(requestFile); const facts = buildStage7(readJson(absoluteRequest), { artifactBase: path.dirname(absoluteRequest) }); fs.writeFileSync(path.resolve(output), `${formatFacts(facts)}\n`); process.stdout.write(`${JSON.stringify(buildSummary(facts, output))}\n`); } catch (error) { process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`); process.exitCode = 2; } }
if (require.main === module) main();
module.exports = { buildStage7, buildSummary, formatFacts };
