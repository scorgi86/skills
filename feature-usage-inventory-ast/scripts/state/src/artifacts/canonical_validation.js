"use strict";
const { validateStage8Manifest } = require("./stage8_validation.js");
const { readJson } = require("../persistence.js");
const { fail } = require("../state_model.js");
function validateCanonicalArtifactForAdvance(state, stageNumber, artifactPath) {
    if (stageNumber === 8) {
        validateStage8Manifest(state, artifactPath);
        return;
    }
    let canonical = null;
    try {
        canonical = readJson(artifactPath);
    } catch  {}
    if (canonical?.schemaVersion === "4.0.0") {
        const validation = require("../../../shared/artifacts/src/canonical/validation.js").validateCanonicalStageResult(canonical);
        if (!validation.ok || canonical.stage !== stageNumber || canonical.status !== "closed") fail(`Stage ${stageNumber} requires a valid closed canonical v4 result`);
        if (canonical.summary?.closure?.ok !== true || !Array.isArray(canonical.summary.closure.errors) || canonical.summary.closure.errors.length) fail("Canonical closure proof is missing or blocked; reissue the stage");
        const { validatePriorLineage, validateCheckHistory } = require("../../../shared/artifacts/src/canonical/lineage.js");
        if (!canonical.summary?.repositoryScope) fail("Canonical artifact is missing scope/lineage; reissue the stage and dependent artifacts");
        validatePriorLineage({ stage: stageNumber, repositoryScope: canonical.summary.repositoryScope,
            priorArtifacts: canonical.summary.lineage, expectedArtifacts: state.activeArtifacts?.slice(0, stageNumber) });
        validateCheckHistory(canonical);
        require("../../../shared/artifacts/src/canonical/receipt_evidence.js").validateReceiptEvidence(canonical, artifactPath);
        if (stageNumber === 7) {
            const reportFact = canonical.facts.find((fact)=>fact?.kind === "report-model");
            if (!reportFact?.model) fail("Stage 7 canonical result requires a report-model fact");
            const modelValidation = require("../../../shared/report/src/model/validation.js").validateReportModel(reportFact.model);
            if (!modelValidation.ok) fail(`Stage 7 report model is invalid: ${modelValidation.errors[0]?.message || "validation failed"}`);
            if (canonical.summary?.reportModelDigest !== modelValidation.canonicalDigest) fail("Stage 7 summary digest must match the validated report model");
        }
        return;
    }
    fail(`Stage ${stageNumber} requires canonical JSON schema 4.0.0`);
}
module.exports = {
    validateCanonicalArtifactForAdvance
};
