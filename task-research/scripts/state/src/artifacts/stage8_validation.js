"use strict";
const { REQUIRED_BUNDLE_DOCUMENTS, listMarkdownDocuments } = require("../../../shared/report/src/bundle/documents.js");
const { validateInventoryBundle } = require("../../../shared/report/src/bundle/validation.js");
const path = require("node:path");
const fs = require("node:fs");
const { readJson, sha256File } = require("../persistence.js");
const { fail } = require("../state_model.js");
function validateStage8Manifest(state, artifactPath) {
    let manifest;
    try {
        manifest = readJson(artifactPath);
    } catch  {
        fail("Stage 8 canonical artifact must be a JSON manifest");
    }
    if (manifest?.schemaVersion !== "2.0.0" || Number(manifest.stage) !== 8 || manifest.status !== "closed") fail("Stage 8 requires a closed manifest schema 2.0.0");
    if (!state.canonicalDigest || manifest.input?.canonicalDigest !== state.canonicalDigest) fail("Stage 8 manifest input digest must match the trusted Stage 7 digest");
    for (const gate of [
        "stage7DigestBinding",
        "model",
        "strictBundle"
    ])if (manifest.validation?.[gate] !== "passed") fail(`Stage 8 manifest requires a passed ${gate} gate`);
    if (!Array.isArray(manifest.outputs)) fail("Stage 8 manifest outputs must be an array");
    const names = manifest.outputs.map((item)=>item?.path);
    if (new Set(names).size !== names.length) fail("Stage 8 manifest output paths must be unique");
    const sorted = names.slice().sort();
    if (JSON.stringify(sorted) !== JSON.stringify(REQUIRED_BUNDLE_DOCUMENTS)) fail("Stage 8 manifest must contain the exact required output set");
    const directory = path.dirname(path.resolve(artifactPath));
    const markdownFiles = listMarkdownDocuments(directory);
    if (JSON.stringify(markdownFiles) !== JSON.stringify(REQUIRED_BUNDLE_DOCUMENTS)) fail("Stage 8 directory must contain exactly the required Markdown documents");
    for (const output of manifest.outputs){
        if (typeof output.path !== "string" || path.isAbsolute(output.path) || output.path !== path.basename(output.path) || output.path.includes("..")) fail("Stage 8 manifest output paths must be safe relative sibling paths");
        if (typeof output.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(output.sha256)) fail(`Stage 8 manifest has an invalid SHA-256 for ${output.path}`);
        const resolved = path.resolve(directory, output.path);
        if (path.dirname(resolved) !== directory) fail("Stage 8 manifest output escapes the manifest directory");
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail(`Stage 8 output does not exist: ${output.path}`);
        if (sha256File(resolved) !== output.sha256) fail(`Stage 8 output hash is stale or invalid: ${output.path}`);
    }
    let stage7;
    try {
        stage7 = readJson(state.stage7Artifact);
    } catch  {
        fail("Stage 8 requires the trusted Stage 7 canonical artifact");
    }
    const canonicalValidation = require("../../../shared/artifacts/src/canonical/validation.js").validateCanonicalStageResult(stage7);
    if (!canonicalValidation.ok || stage7.stage !== 7 || stage7.status !== "closed") fail("Stage 8 requires an unchanged valid Stage 7 canonical artifact");
    if (!state.stage7ArtifactDigest || stage7.outputDigest !== state.stage7ArtifactDigest) fail("Stage 8 requires the exact Stage 7 canonical artifact that closed the stage");
    const reportFact = stage7?.facts?.find((fact)=>fact?.kind === "report-model");
    if (!reportFact?.model || reportFact.model.integrity?.canonicalDigest !== state.canonicalDigest) fail("Stage 8 cannot resolve the trusted Stage 7 report model");
    const modelValidation = require("../../../shared/report/src/model/validation.js").validateReportModel(reportFact.model);
    if (!modelValidation.ok || stage7.summary?.reportModelDigest !== modelValidation.canonicalDigest) fail("Stage 8 requires an unchanged valid Stage 7 report model");
    const documents = Object.fromEntries(REQUIRED_BUNDLE_DOCUMENTS.map((name)=>[
            name,
            fs.readFileSync(path.join(directory, name), "utf8")
        ]));
    const bundleValidation = validateInventoryBundle(documents, {
        strict: true,
        model: reportFact.model
    });
    if (!bundleValidation.ok) fail(`Stage 8 bundle validation failed: ${bundleValidation.errors.join("; ")}`);
}
module.exports = {
    validateStage8Manifest
};
