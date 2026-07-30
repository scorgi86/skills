"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { normalizeReportModel, validateReportModel } = require("./report_model");
function model() { return normalizeReportModel({ target: "X", capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-1"] }], evidenceIndex: [{ id: "ev-1", file: "a.js" }], confirmedUsages: [{ id: "use-1", evidenceRefs: ["ev-1"] }], checkedNoUsage: [], transition: { "next stage": "8" } }); }
test("model validator accepts canonical model", () => assert.equal(validateReportModel(model()).ok, true));
test("model validator rejects broken evidence references", () => { const value = model(); value.confirmedUsages[0].evidenceRefs = ["missing"]; assert.equal(validateReportModel(value).errors.some((x) => x.code === "broken-ref"), true); });
test("model validator detects mutation through digest", () => { const value = model(); value.target = "changed"; assert.equal(validateReportModel(value).errors.some((x) => x.code === "integrity"), true); });
test("published report model schema is valid JSON", () => { const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "references", "report-model.schema.json"), "utf8")); assert.equal(schema.$id, "inventory-report-model/1.0.0"); });
