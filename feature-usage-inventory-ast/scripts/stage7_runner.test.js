"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildStage7, buildSummary, formatFacts } = require("./stage7_runner");
const { compareStage7Facts } = require("./stage7_equivalence_gate");
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage7-")); const files = [1, 4, 5, 6].map((stage) => path.join(root, `s${stage}.json`)); files.forEach((file, index) => fs.writeFileSync(file, JSON.stringify({ stage: [1, 4, 5, 6][index], capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-1"] }] }))); return { root, files, request: { stage: 7, target: "feature", scope: { repos: ["sdkjs"] }, priorArtifacts: files, evidenceIndex: [{ id: "ev-2", file: "b.js", symbol: "B" }, { id: "ev-1", file: "a.js", symbol: "A" }], confirmedUsages: [{ id: "use-2", evidenceRefs: ["ev-2"] }, { id: "use-1", evidenceRefs: ["ev-1"] }], checkedNoUsage: [{ id: "absence-1", evidenceRefs: ["ev-1"], expectedNames: ["setFeature"], searchScope: "web-apps/apps" }], referenceOnly: [], noise: [], openChecks: [], transition: { "next stage": "8" } } }; }
test("stage 7 emits a closed canonical report model", () => { const { root, request } = fixture(), model = buildStage7(request); assert.equal(model.modelType, "inventory-report-model"); assert.equal(model.status, "closed"); assert.equal(buildSummary(model, path.join(root, "model.json")).counts.retainedArtifacts, 4); assert.equal(compareStage7Facts(model, JSON.parse(JSON.stringify(model))).status, "equivalent"); });
test("stage 7 is deterministic for shuffled input", () => { const { request } = fixture(); const first = buildStage7(request); const second = buildStage7({ ...request, confirmedUsages: [...request.confirmedUsages].reverse(), evidenceIndex: [...request.evidenceIndex].reverse() }); assert.equal(formatFacts(first), formatFacts(second)); assert.equal(first.integrity.canonicalDigest, second.integrity.canonicalDigest); });
test("stage 7 rejects evidence-free confirmed usage", () => { const { request } = fixture(); assert.throws(() => buildStage7({ ...request, confirmedUsages: [{ id: "bad" }] }), /evidenceRefs/); });
