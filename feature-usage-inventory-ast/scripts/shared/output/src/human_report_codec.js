"use strict";

const SCHEMA_VERSION = "1.0.0";

const AST_FIELDS = Object.freeze(["owner", "relation", "field", "target"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function astGroups(value) {
  const queries = value && value.ast && (value.ast.queries || value.ast.results) || [];
  return queries.flatMap((query) => Array.isArray(query.groups) ? query.groups : []);
}

function sourceGroups(value) {
  const checks = value && value.sourceEvidence && (value.sourceEvidence.checks || value.sourceEvidence) || [];
  return checks.flatMap((check) => Array.isArray(check.groups) ? check.groups : []);
}

function buildDictionary(value) {
  const dimensions = Object.fromEntries([...AST_FIELDS, "label"].map((field) => [field, new Set()]));
  for (const group of astGroups(value)) {
    for (const field of AST_FIELDS) {
      if (group[field] !== undefined && group[field] !== null && String(group[field]) !== "") dimensions[field].add(String(group[field]));
    }
  }
  for (const group of sourceGroups(value)) {
    if (group.label !== undefined && group.label !== null && String(group.label) !== "") dimensions.label.add(String(group.label));
  }
  return Object.fromEntries(Object.entries(dimensions).map(([field, values]) => [field, [...values].sort()]));
}

function encodeHumanFields(value) {
  if (!value || typeof value !== "object") throw new Error("Human-field codec requires an object");
  if (value.humanDictionary) return clone(value);
  const encoded = clone(value);
  const dimensions = buildDictionary(encoded);
  const indexes = Object.fromEntries(Object.entries(dimensions).map(([field, values]) => [field, new Map(values.map((item, index) => [item, index]))]));

  for (const group of astGroups(encoded)) {
    group.h = AST_FIELDS.map((field) => {
      if (group[field] === undefined || group[field] === null || String(group[field]) === "") return null;
      const index = indexes[field].get(String(group[field]));
      delete group[field];
      return index;
    });
  }
  for (const group of sourceGroups(encoded)) {
    if (group.label === undefined || group.label === null || String(group.label) === "") continue;
    group.hl = indexes.label.get(String(group.label));
    delete group.label;
  }
  encoded.humanDictionary = { schemaVersion: SCHEMA_VERSION, dimensions };
  return encoded;
}

function dictionaryValue(dictionary, field, index) {
  if (index === null || index === undefined) return "";
  const values = dictionary && dictionary.dimensions && dictionary.dimensions[field];
  if (!Array.isArray(values) || !Number.isInteger(index) || index < 0 || index >= values.length) {
    throw new Error(`Unresolved human dictionary reference: ${field}[${index}]`);
  }
  return values[index];
}

function decodeHumanFields(value) {
  if (!value || typeof value !== "object") throw new Error("Human-field codec requires an object");
  const decoded = clone(value);
  const dictionary = decoded.humanDictionary;
  if (!dictionary) return decoded;
  if (dictionary.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported human dictionary schema: ${dictionary.schemaVersion}`);

  for (const group of astGroups(decoded)) {
    if (!Array.isArray(group.h) || group.h.length !== AST_FIELDS.length) throw new Error("Encoded AST group has no complete human-field reference");
    AST_FIELDS.forEach((field, index) => { group[field] = dictionaryValue(dictionary, field, group.h[index]); });
    delete group.h;
  }
  for (const group of sourceGroups(decoded)) {
    if (group.hl === undefined) continue;
    group.label = dictionaryValue(dictionary, "label", group.hl);
    delete group.hl;
  }
  delete decoded.humanDictionary;
  return decoded;
}

function humanGroupName(group) {
  const owner = String(group && group.owner || "<unknown owner>");
  const field = String(group && group.field || "<unknown field>");
  const target = String(group && group.target || "<unknown target>");
  return `${owner}.${field} -> ${target}`;
}

function findInternalReportIdentifiers(markdown) {
  const text = String(markdown || "");
  const findings = [];
  if (/\bEvidence ID\b/i.test(text)) findings.push("Evidence ID column");
  if (/\b(?:ast|source):[^\s|]+/i.test(text)) findings.push("generated evidence reference");
  if (/\bhumanDictionary\b|\"h\"\s*:|\"hl\"\s*:/i.test(text)) findings.push("encoded human dictionary reference");
  return [...new Set(findings)];
}

function assertHumanReadableMarkdown(markdown) {
  const findings = findInternalReportIdentifiers(markdown);
  if (findings.length) throw new Error(`Final report contains internal identifiers: ${findings.join(", ")}`);
  return true;
}

module.exports = { AST_FIELDS, SCHEMA_VERSION, assertHumanReadableMarkdown, decodeHumanFields, encodeHumanFields, findInternalReportIdentifiers, humanGroupName };
