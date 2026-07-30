#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MODES = new Set(["strict", "adaptive", "continuous"]);
const REQUIRED = ["target", "scope", "mode", "artifactDestination", "completionCondition"];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
function normalize(request) {
  if (!request || typeof request !== "object") throw new Error("Goal contract request must be an object");
  const material = {
    target: request.target,
    scope: request.scope,
    mode: request.mode,
    artifactDestination: request.artifactDestination,
    exclusions: request.exclusions || [],
    completionCondition: request.completionCondition,
  };
  const missing = REQUIRED.filter((key) => material[key] === undefined || material[key] === null || material[key] === "");
  if (missing.length) throw new Error(`Goal contract is missing required fields: ${missing.join(", ")}`);
  if (!MODES.has(material.mode)) throw new Error("Goal contract mode must be strict, adaptive, or continuous");
  return stable(material);
}
function buildContract(request) {
  const material = normalize(request);
  const canonical = JSON.stringify(material);
  return {
    schemaVersion: "1.0.0",
    driver: "goal",
    material,
    objectiveDigest: crypto.createHash("sha256").update(canonical).digest("hex"),
  };
}
function parseArgs(argv) {
  const index = argv.indexOf("--request");
  if (index < 0 || !argv[index + 1]) throw new Error("Provide --request <goal-contract.json>");
  return { request: argv[index + 1] };
}
function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  return buildContract(JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8")));
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main())}\n`); }
  catch (error) { process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`); process.exitCode = 2; }
}

module.exports = { buildContract, normalize, stable };
