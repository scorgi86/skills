#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const REQUIRED_FIELDS = ["target", "scope", "stage", "status", "confirmed evidence", "candidate evidence", "dictionary/graph/path state", "skipped/forbidden", "open checks", "next stage"];

function extractTransition(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) if (/^\s*(?:-\s*)?target\s*:/i.test(lines[index])) start = index;
  if (start < 0) throw new Error("Structured transition block not found");
  const fields = {};
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && /^#{1,6}\s+/.test(lines[index])) break;
    const match = lines[index].match(/^\s*(?:-\s*)?([^:]+):\s*(.*)$/);
    if (match) fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  const missing = REQUIRED_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(fields, field));
  if (missing.length) throw new Error(`Transition block misses: ${missing.join(", ")}`);
  return { schemaVersion: "1.0.0", fields, missing: [], valid: true };
}

function main() {
  try {
    const file = process.argv[process.argv.indexOf("--file") + 1];
    if (!file) throw new Error("Provide --file <stage-artifact>");
    process.stdout.write(`${JSON.stringify(extractTransition(fs.readFileSync(path.resolve(file), "utf8")))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ valid: false, errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { REQUIRED_FIELDS, extractTransition };
