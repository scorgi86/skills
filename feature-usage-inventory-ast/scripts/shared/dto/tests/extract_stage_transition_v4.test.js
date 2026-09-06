"use strict";
const assert = require("node:assert/strict"), test = require("node:test");
const { extractTransition, REQUIRED_FIELDS } = require("../src/extract_stage_transition");
test("transition extractor reads canonical v4 JSON without Markdown", () => { const fields = Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, field === "stage" ? "2" : "value"])); const result = extractTransition(JSON.stringify({ schemaVersion: "4.0.0", summary: { transition: { schemaVersion: "1.0.0", fields, valid: true } } })); assert.deepEqual(result.fields, fields); });
