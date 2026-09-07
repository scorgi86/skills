"use strict";

const path = require("node:path");

const { validateStageArtifact } = require("./stage_artifact_v4.js");

const fs = require("node:fs");
const { artifactLocation } = require("./artifact_location.js");

function parseArgs(argv) {
  const options = { limit: 20 };
  const valueOptions = new Set(["--artifact", "--id", "--symbol", "--usage-kind", "--file", "--repository", "--confirmation", "--fact-kind", "--fact-id", "--capability", "--scenario", "--recipient", "--gap", "--path", "--implementation-entry", "--evidence-for", "--limit", "--output"]);
  for (let index = 0; index < argv.length; index += 1) { const arg = argv[index]; if (!valueOptions.has(arg)) throw new Error(`Unknown option: ${arg}`); if (!argv[index + 1]) throw new Error(`Missing value for ${arg}`); options[arg.slice(2)] = argv[++index]; }
  if (!options.artifact) throw new Error("Provide --artifact <canonical-stage-directory>");
  options.limit = Math.min(200, Math.max(1, Number(options.limit) || 20));
  return options;
}

function includes(value, expected) { return !expected || String(value || "").toLowerCase().includes(String(expected).toLowerCase()); }

function refs(item) { return Object.entries(item || {}).filter(([key, value]) => key.endsWith("Refs") && Array.isArray(value)).flatMap(([, value]) => value.map(String)); }

function queryStageArtifacts(options) {
  const { root } = artifactLocation(options.artifact), validation = validateStageArtifact(root);
  if (!validation.ok) throw new Error(`Invalid canonical stage artifact: ${validation.errors.join("; ")}`);
  const artifact = JSON.parse(fs.readFileSync(path.join(root, "canonical", "evidence.json"), "utf8"));
  const stageResult = JSON.parse(fs.readFileSync(path.join(root, "canonical", "stage-result.json"), "utf8"));
  const expanded = (artifact.evidence || []).map((item) => ({ ...item, file: Number.isInteger(item.fileId) ? artifact.files[item.fileId] : item.file }));
  const factAlias = options.capability ? { kind: "capability", value: options.capability } : options.scenario ? { kind: "scenario", value: options.scenario } : options.recipient ? { kind: "recipient-family", value: options.recipient } : options.gap ? { kind: "gap", value: options.gap } : options.path ? { kind: "critical-path", value: options.path } : options["implementation-entry"] ? { kind: "implementation-entry", value: options["implementation-entry"] } : null;
  const evidenceFor = options["evidence-for"];
  const factRequested = Boolean(options["fact-kind"] || options["fact-id"] || factAlias || evidenceFor);
  const matchedFacts = factRequested ? (stageResult.facts || []).filter((item) => {
    const kindMatches = options.path ? ["critical-path", "reference-path"].includes(item.kind) : includes(item.kind, options["fact-kind"] || factAlias?.kind);
    return kindMatches && includes(item.id, options["fact-id"] || factAlias?.value || evidenceFor);
  }) : [];
  const factEvidenceIds = new Set(matchedFacts.flatMap(refs));
  const filtered = expanded.filter((item) => includes(item.id, options.id) && includes(item.symbol, options.symbol) && includes(item.usageKind, options["usage-kind"]) && includes(item.file, options.file) && includes(item.repository, options.repository) && includes(item.confirmation?.status, options.confirmation) && (!evidenceFor || factEvidenceIds.has(String(item.id))));
  const evidence = filtered.slice(0, options.limit);
  const facts = matchedFacts.slice(0, options.limit);
  return { schemaVersion: "canonical-evidence-selector/4.0.0", status: "ok", stage: artifact.stage, totalMatched: filtered.length, returned: evidence.length, truncated: evidence.length < filtered.length || facts.length < matchedFacts.length, totalFactsMatched: matchedFacts.length, factsReturned: facts.length, facts, evidence };
}

module.exports = { parseArgs, queryStageArtifacts };
