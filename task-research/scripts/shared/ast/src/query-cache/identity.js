"use strict";

const crypto = require("node:crypto");

const QUERY_CACHE_VERSION = "1";
const CACHEABLE_COMMANDS = new Set([
  "symbols", "index", "fields", "methods", "reads", "writes", "assignments",
  "calls", "callers", "callees", "owners", "recipients", "collections", "find", "summary",
]);
const COMMON_OPTIONS = ["owner", "field", "kind", "terms", "lineStart", "lineEnd", "minConfidence", "detailsFor"];
const COMMAND_OPTIONS = {
  calls: ["symbol"], callers: ["symbol"], callees: ["symbol"],
  owners: ["type"], recipients: ["type"], find: ["type"], summary: ["type"],
};

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function functionalOptions(command, options = {}) {
  const keys = [...COMMON_OPTIONS, ...(COMMAND_OPTIONS[command] || [])];
  return Object.fromEntries(keys.filter(key => options[key] !== undefined).sort().map(key => [key, stableValue(options[key])]));
}

function isCacheableQuery(command) { return CACHEABLE_COMMANDS.has(command); }

function createQueryIdentity({ command, options = {}, analysisKeys, version = QUERY_CACHE_VERSION }) {
  const identity = { version, command, options: functionalOptions(command, options), analysisKeys: [...analysisKeys] };
  const key = crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return { ...identity, key };
}

module.exports = { CACHEABLE_COMMANDS, QUERY_CACHE_VERSION, createQueryIdentity, functionalOptions, isCacheableQuery };
