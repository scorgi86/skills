"use strict";
const fs = require("node:fs");
const path = require("node:path");

// A receipt's own evidenceRefs declaration is not evidence of a stored row.
function validateReceiptEvidence(canonical, artifactFile) {
    if (!canonical.facts.some(row => row.kind === "check-resolution" && row.disposition === "checked")) return;
    const file = path.resolve(artifactFile);
    const root = path.dirname(path.dirname(file));
    if (file !== path.join(root, "canonical", "stage-result.json")) {
        throw new Error("Checked receipt requires a canonical artifact with evidence and manifest; reissue the stage");
    }
    const { validateStageArtifact } = require("../stage_artifact_v4.js");
    const validation = validateStageArtifact(root);
    if (!validation.ok) throw new Error(`Checked receipt evidence artifact is invalid: ${validation.errors.join("; ")}; reissue the stage`);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "canonical", "manifest.json"), "utf8"));
    if (path.resolve(root, manifest.files.canonicalResult.path) !== file) {
        throw new Error("Checked receipt manifest refers to another canonical artifact; reissue the stage");
    }
    const stored = JSON.parse(fs.readFileSync(path.resolve(root, manifest.files.canonicalEvidence.path), "utf8"));
    const evidence = (stored.evidence || []).map(row => ({ ...row, file: row.file || stored.files?.[row.fileId] }));
    const { receiptErrors } = require("./checks.js");
    for (const receipt of canonical.facts.filter(row => row.kind === "check-resolution")) {
        const errors = receiptErrors(receipt, new Set(evidence.map(row => row.id)), canonical.summary?.repositoryScope, { requirements: canonical.summary?.checkRequirements || [], evidence, facts: canonical.facts });
        if (errors.length) throw new Error(`Checked receipt evidence is invalid: ${errors.join("; ")}; reissue the stage`);
    }
}
module.exports = { validateReceiptEvidence };
