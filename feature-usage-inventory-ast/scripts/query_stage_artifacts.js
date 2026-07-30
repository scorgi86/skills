#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

function readJsonl(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function parseArgs(argv) {
  const options = { limit: 20, includeEvidence: false };
  const valueOptions = new Set(["--bundle", "--finding", "--owner", "--field", "--target", "--relation", "--file", "--status", "--limit", "--output"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--include-evidence") options.includeEvidence = true;
    else if (valueOptions.has(arg)) {
      if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++index];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.bundle) throw new Error("Provide --bundle <directory>");
  options.limit = Math.min(200, Math.max(1, Number(options.limit) || 20));
  return options;
}

function includes(value, expected) {
  return !expected || String(value || "").toLowerCase().includes(String(expected).toLowerCase());
}

function queryStageArtifacts(options) {
  const root = path.resolve(options.bundle);
  const findings = readJsonl(fs.readFileSync(path.join(root, "findings.jsonl"), "utf8"));
  const filtered = findings.filter((item) =>
    includes(item.id, options.finding) &&
    includes(item.owner, options.owner) &&
    includes(item.field, options.field) &&
    includes(item.target, options.target) &&
    includes(item.relation, options.relation) &&
    includes(item.source && item.source.file, options.file) &&
    includes(item.status, options.status));
  const selected = filtered.slice(0, options.limit);
  const result = {
    schemaVersion: "1.0.0",
    status: "ok",
    totalMatched: filtered.length,
    returned: selected.length,
    truncated: selected.length < filtered.length,
    findings: selected.map(({ id, ...item }) => item),
  };
  const freshness = { checked: 0, current: 0, stale: 0, unavailable: 0 };
  for (const item of selected) {
    const source = item.source || {};
    if (!source.fileHash) continue;
    freshness.checked += 1;
    if (!source.file || !fs.existsSync(source.file)) { freshness.unavailable += 1; continue; }
    const actual = crypto.createHash("sha256").update(fs.readFileSync(source.file)).digest("hex");
    if (actual === source.fileHash) freshness.current += 1;
    else freshness.stale += 1;
  }
  result.freshness = freshness;
  if (options.includeEvidence) {
    const references = new Set(selected.flatMap((item) => item.evidenceRefs || []));
    const evidence = readJsonl(zlib.gunzipSync(fs.readFileSync(path.join(root, "evidence.jsonl.gz"))).toString("utf8"));
    result.evidence = evidence.filter((item) => references.has(item.id)).map(({ id, ...item }) => item);
  }
  return result;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = queryStageArtifacts(options);
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) fs.writeFileSync(path.resolve(options.output), output);
    else process.stdout.write(output);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { parseArgs, queryStageArtifacts };
