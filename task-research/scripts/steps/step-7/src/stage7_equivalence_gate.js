"use strict";

const { canonicalJson, withoutIntegrity } = require("../../../shared/report/src/model/serialization.js");
const { validateReportModel } = require("../../../shared/report/src/model/validation.js");

function projection(model) { return withoutIntegrity(model); }

function compareStage7Facts(baseline, candidate) { const baselineValidation = validateReportModel(baseline), candidateValidation = validateReportModel(candidate); const equal = baselineValidation.ok && candidateValidation.ok && canonicalJson(projection(baseline)) === canonicalJson(projection(candidate)); return { schemaVersion: "1.0.0", gate: "stage7-report-model-equivalence", status: equal ? "equivalent" : "not-equivalent", validation: { baseline: baselineValidation.ok, candidate: candidateValidation.ok }, digests: { baseline: baseline.integrity?.canonicalDigest || null, candidate: candidate.integrity?.canonicalDigest || null } }; }

module.exports = { compareStage7Facts, projection };
