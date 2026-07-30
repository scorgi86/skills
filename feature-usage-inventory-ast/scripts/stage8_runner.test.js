"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { normalizeReportModel } = require("./report_model");
const { run } = require("./stage8_runner");
function model() { return normalizeReportModel({ target: "X", capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-1"] }], evidenceIndex: [{ id: "ev-1", file: "a.js", symbol: "A", result: "confirmed" }], confirmedUsages: [{ id: "use-1", title: "Use", evidenceRefs: ["ev-1"] }], checkedNoUsage: [], recipientFamilies: [{ id: "recipient-1", name: "Shapes", evidenceRefs: ["ev-1"] }], criticalPaths: [{ id: "path-1", name: "Save", evidenceRefs: ["ev-1"] }], transition: { "next stage": "8" } }); }
test("stage 8 renders deterministic documents without changing model", () => { const value = model(), before = JSON.stringify(value), a = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-a-")), b = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-b-")); const one = run(value, a, value.integrity.canonicalDigest), two = run(value, b, value.integrity.canonicalDigest); assert.deepEqual(one.outputs, two.outputs); assert.equal(JSON.stringify(value), before); assert.deepEqual(fs.readdirSync(a).sort(), ["decision-report.md", "evidence.md", "implementation-map.md", "manifest.json"]); });
test("stage 8 blocks a mutated model", () => { const value = model(), closedDigest = value.integrity.canonicalDigest; value.target = "mutated"; assert.throws(() => run(value, fs.mkdtempSync(path.join(os.tmpdir(), "stage8-bad-")), closedDigest), /input validation failed/); });
test("stage 8 blocks a rehashed replacement model", () => { const value = model(), closedDigest = value.integrity.canonicalDigest; const replacement = normalizeReportModel({ ...value, target: "replacement" }); assert.throws(() => run(replacement, fs.mkdtempSync(path.join(os.tmpdir(), "stage8-rehash-")), closedDigest), /differs from closed Stage 7 digest/); });
