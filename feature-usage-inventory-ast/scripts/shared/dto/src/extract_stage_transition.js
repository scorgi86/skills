"use strict";

const REQUIRED_FIELDS = ["target", "scope", "stage", "status", "confirmed evidence", "candidate evidence", "dictionary/graph/path state", "skipped/forbidden", "open checks", "next stage"];

function extractTransition(input) {
  let value;
  try { value = typeof input === "string" ? JSON.parse(input) : input; }
  catch { throw new Error("Stage transition must be canonical JSON schema 4.0.0"); }
  if (value?.schemaVersion !== "4.0.0") throw new Error("Stage transition must use canonical JSON schema 4.0.0");
  if (!value.summary?.transition?.fields) throw new Error("Canonical stage result has no summary.transition fields");
  const missing = REQUIRED_FIELDS.filter((field) => value.summary.transition.fields[field] === undefined || value.summary.transition.fields[field] === null || value.summary.transition.fields[field] === "");
  if (missing.length) throw new Error(`Canonical stage transition is missing required fields: ${missing.join(", ")}`);
  return value.summary.transition;
}

module.exports = { REQUIRED_FIELDS, extractTransition };
