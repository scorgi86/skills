"use strict";
const crypto = require("node:crypto");
const { absenceProjection } = require("../../../shared/report/src/model/projection.js");
const { canonicalJson } = require("../../../shared/report/src/model/serialization.js");
const { validateReportModel } = require("../../../shared/report/src/model/validation.js");
const { REQUIRED_BUNDLE_DOCUMENTS, listMarkdownDocuments } = require("../../../shared/report/src/bundle/documents.js");
const { validateInventoryBundle } = require("../../../shared/report/src/bundle/validation.js");
const fs = require("node:fs");
const path = require("node:path");
const { renderDecision } = require("./rendering/decision.js");
const { renderImplementation } = require("./rendering/implementation.js");
const { renderEvidence } = require("./rendering/evidence.js");
function hashText(text) {
    return crypto.createHash("sha256").update(text).digest("hex");
}
function unwrapModel(value) {
    if (value?.schemaVersion !== "4.0.0") return value;
    const row = (value.facts || []).find((item)=>item.kind === "report-model");
    if (!row?.model) throw new Error("Canonical Stage 7 artifact does not contain a report-model fact");
    return row.model;
}
function run(model, outputDir, expectedDigest) {
    if (!expectedDigest) throw new Error("Stage 8 requires the digest recorded when Stage 7 closed");
    if (model.integrity?.canonicalDigest !== expectedDigest) throw new Error(`Stage 8 input digest differs from closed Stage 7 digest: expected ${expectedDigest}, received ${model.integrity?.canonicalDigest || "missing"}`);
    const validation = validateReportModel(model);
    if (!validation.ok) throw new Error(`Stage 8 input validation failed: ${validation.errors.map((x)=>`${x.path}: ${x.message}`).join("; ")}`);
    const documents = {
        "decision-report.md": renderDecision(model),
        "implementation-map.md": renderImplementation(model),
        "evidence.md": renderEvidence(model)
    };
    const bundleValidation = validateInventoryBundle(documents, {
        strict: true,
        model
    });
    if (!bundleValidation.ok) throw new Error(`Stage 8 strict bundle validation failed: ${bundleValidation.errors.join("; ")}`);
    fs.mkdirSync(outputDir, {
        recursive: true
    });
    const unexpectedMarkdown = listMarkdownDocuments(outputDir).filter((name)=>!REQUIRED_BUNDLE_DOCUMENTS.includes(name));
    if (unexpectedMarkdown.length) throw new Error(`Stage 8 output directory contains unexpected Markdown documents: ${unexpectedMarkdown.sort().join(", ")}`);
    for (const name of REQUIRED_BUNDLE_DOCUMENTS)fs.writeFileSync(path.join(outputDir, name), documents[name], "utf8");
    const manifest = {
        schemaVersion: "2.0.0",
        stage: 8,
        status: "closed",
        input: {
            modelType: model.modelType,
            canonicalDigest: model.integrity.canonicalDigest
        },
        validation: {
            stage7DigestBinding: "passed",
            model: "passed",
            strictBundle: "passed"
        },
        outputs: REQUIRED_BUNDLE_DOCUMENTS.map((name)=>({
                path: name,
                sha256: hashText(documents[name])
            }))
    };
    fs.writeFileSync(path.join(outputDir, "manifest.json"), canonicalJson(manifest), "utf8");
    return manifest;
}
module.exports = {
    run,
    unwrapModel
};
