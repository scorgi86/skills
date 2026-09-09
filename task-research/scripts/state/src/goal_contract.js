"use strict";

const crypto = require("node:crypto");

const MODES = new Set(["strict", "adaptive", "continuous"]);

const REQUIRED = ["target", "scope", "completionCondition"];

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
    mode: request.mode || "continuous",
    artifactDestination: request.artifactDestination || `.codex/inventory-artifacts/${String(request.target || "inventory").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-${crypto.createHash("sha256").update(JSON.stringify(stable(request.scope || {}))).digest("hex").slice(0, 12)}`,
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

module.exports = { buildContract, normalize, stable };
