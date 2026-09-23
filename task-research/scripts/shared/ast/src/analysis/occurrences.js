"use strict";

const { walk } = require("../parsing/walker.js");
const { evidenceFor } = require("./evidence.js");

function normalizedTerm(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function collectOccurrences(parsed, context) {
  const rows = [];
  const add = (node, value, kind) => {
    const normalized = normalizedTerm(value);
    if (!normalized) return;
    const evidence = evidenceFor(node, context, `occurrence:${kind}`, "exact");
    if (!evidence.range) return;
    rows.push({ value: normalized, kind, file: context.filename, range: evidence.range, sourceHash: context.sourceHash, confidence: "exact", evidence: [evidence] });
  };
  walk(parsed.ast, { enter(node) {
    if (node.type === "Identifier") add(node, node.value, "identifier");
    if (node.type === "StringLiteral") add(node, node.value, "string");
    if (node.type === "MemberExpression") {
      const property = node.property;
      if (property?.type === "Identifier") add(property, property.value, "property");
      else if (property?.type === "Computed" && property.expression?.type === "StringLiteral") add(property.expression, property.expression.value, "property");
    }
    if (["KeyValueProperty", "MethodProperty", "GetterProperty", "SetterProperty"].includes(node.type)) {
      const key = node.key;
      if (key?.type === "Identifier") add(key, key.value, "property");
      else if (key?.type === "StringLiteral") add(key, key.value, "property");
      else if (key?.type === "Computed" && key.expression?.type === "StringLiteral") add(key.expression, key.expression.value, "property");
    }
  } });
  return [...new Map(rows.map(row => [`${row.kind}\0${row.value}\0${row.file}\0${row.range.start.offset}\0${row.range.end.offset}`, row])).values()];
}

module.exports = { collectOccurrences, normalizedTerm };
