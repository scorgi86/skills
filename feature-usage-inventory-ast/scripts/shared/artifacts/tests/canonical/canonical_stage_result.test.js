"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createCanonicalStageResult } = require("../../src/canonical/result.js");
const { validateCanonicalStageResult } = require("../../src/canonical/validation.js");

test("canonical result separates text estimate from unavailable token usage", () => {
  const result = createCanonicalStageResult({ facts: { stage: 2, status: "closed" }, input: { stage: 2 } });
  assert.deepEqual(result.usage, { status: "unavailable" });
  assert.equal(result.metrics.artifactTextEstimate.isActualTokenUsage, false);
  assert.equal(validateCanonicalStageResult(result).ok, true);
});
test("canonical result preserves supplied provider telemetry without estimation", () => {
  const usage = { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, reasoningTokens: 4, totalTokens: 17, provider: "provider", requestId: "req-1" };
  assert.deepEqual(createCanonicalStageResult({ facts: { stage: 1, status: "closed" }, usage }).usage, { status: "supplied", ...usage });
});
test("canonical result retains ownership facts and later-stage source evidence", () => {
  const facts = { stage: 4, status: "closed", ownership: { groups: [{ id: "owner-1", status: "candidate" }] }, sourceEvidence: { checks: [{ id: "check-1", matches: [{ file: "source.js", line: 7, snippet: "useFeature()" }] }] } };
  const result = createCanonicalStageResult({ facts, input: { stage: 4 } });
  assert.equal(result.facts.some((item) => item.kind === "ownership" && item.id === "owner-1"), true);
  assert.equal(result.evidenceRefs.length, 1);
  assert.match(result.evidenceRefs[0], /^ev-/);
});
test("canonical result preserves the complete checked-no-usage capability protocol", () => {
  const capability = { id: "input", status: "checked-no-usage", expectedNames: ["setX"], reason: "peer API", repository: "source", searchScope: "src", performedChecks: ["text"], ordersChecked: ["N/A"], linkingMethodsChecked: ["N/A"], resultComplete: true, resultTruncated: false, consequence: "path absent", evidenceRefs: ["ev-absence"] };
  const result = createCanonicalStageResult({ facts: { stage: 6, status: "closed", capabilities: [capability] }, input: { stage: 6 } });
  assert.deepEqual(result.facts.find((row) => row.kind === "capability"), { kind: "capability", ...capability });
});
test("canonical result preserves generic planning collections through the shared mapping", () => { const protocol = { status: "checked-no-usage", expectedNames: ["setX"], reason: "peer API", repository: "source", searchScope: "src", performedChecks: ["text"], ordersChecked: ["N/A"], linkingMethodsChecked: ["N/A"], resultComplete: true, resultTruncated: false, consequence: "path absent", evidenceRefs: ["ev-absence"] }, result = createCanonicalStageResult({ facts: { stage: 3, status: "closed", dictionary: [{ id: "dictionary-absence", ...protocol }], ownership: [{ id: "ownership-absence", ...protocol }] }, input: { stage: 3 } }); assert.ok(result.facts.some((row) => row.kind === "dictionary" && row.id === "dictionary-absence" && row.performedChecks[0] === "text")); assert.ok(result.facts.some((row) => row.kind === "ownership" && row.id === "ownership-absence" && row.reason === "peer API")); assert.equal(validateCanonicalStageResult(result).ok, true); });
test("canonical validator enforces required and additionalProperties schema rules", () => { const result = createCanonicalStageResult({ facts: { stage: 7, status: "closed" }, input: { stage: 7 } }); delete result.metrics; result.extraTopLevel = true; result.outputDigest = require("../../src/canonical/validation.js").digest({ ...result, outputDigest: undefined }); const validation = validateCanonicalStageResult(result); assert.equal(validation.ok, false); assert.ok(validation.errors.some((error) => error.includes("metrics"))); assert.ok(validation.errors.some((error) => error.includes("additional"))); });
test("canonical validator rejects incomplete generic absence", () => { const result = createCanonicalStageResult({ facts: { stage: 3, status: "closed", dictionary: [{ id: "bad-absence", status: "checked-no-usage", evidenceRefs: [] }] }, input: { stage: 3 } }); assert.equal(validateCanonicalStageResult(result).ok, false); });
test("canonical validator enforces the supplied usage schema", () => { const result = createCanonicalStageResult({ facts: { stage: 7, status: "closed" }, input: { stage: 7 } }); result.usage = { status: "supplied" }; result.outputDigest = require("../../src/canonical/validation.js").digest({ ...result, outputDigest: undefined }); assert.equal(validateCanonicalStageResult(result).ok, false); });
test("canonical creation rejects explicitly invalid supplied usage", () => { assert.throws(() => createCanonicalStageResult({ facts: { stage: 1, status: "closed" }, usage: { status: "supplied" } }), /Invalid supplied usage telemetry/); });
test("canonical runtime enforces published array item schemas", () => { const result = createCanonicalStageResult({ facts: { stage: 1, status: "closed" } }); result.facts.push(7); result.evidenceRefs.push(7, 7); result.openChecks.push("same", "same"); result.outputDigest = require("../../src/canonical/validation.js").digest({ ...result, outputDigest: undefined }); const errors = validateCanonicalStageResult(result).errors.join("; "); assert.match(errors, /facts items must be objects/); assert.match(errors, /evidenceRefs items must be strings/); assert.match(errors, /openChecks items must be unique/); });
test("canonical runtime rejects non-string telemetry identifiers", () => { const result = createCanonicalStageResult({ facts: { stage: 1, status: "closed" }, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2, provider: "provider", requestId: "request" } }); result.usage.provider = 7; result.usage.requestId = 8; result.outputDigest = require("../../src/canonical/validation.js").digest({ ...result, outputDigest: undefined }); assert.equal(validateCanonicalStageResult(result).ok, false); });
