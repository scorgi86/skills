"use strict";
const { normalizeCapabilities } = require("../../../dto/src/capability_contract.js");
const { MODEL_TYPE, SCHEMA_VERSION, cleanText, asArray, normalizeRefs, COLLECTIONS, normalizeRows } = require("./rows.js");
const { stable, digest, withoutIntegrity } = require("./serialization.js");
function normalizeReportModel(input) {
    const model = {
        modelType: MODEL_TYPE,
        schemaVersion: SCHEMA_VERSION,
        inventoryId: cleanText(input.inventoryId) || `inventory:${cleanText(input.target).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "")}`,
        stage: 7,
        status: cleanText(input.status) || "closed",
        target: cleanText(input.target),
        scope: stable(input.scope || {}),
        provenance: stable(input.provenance || {}),
        executiveSummary: stable(input.executiveSummary || {}),
        decisionStatus: cleanText(input.decisionStatus) || (asArray(input.openChecks).length ? "partial" : "confirmed"),
        coverage: stable(input.coverage || {}),
        capabilities: normalizeCapabilities(input.capabilities || []).sort((a, b)=>a.id.localeCompare(b.id)),
        stageExecution: stable(input.stageExecution || {}),
        renderProfile: stable(input.renderProfile || {
            documents: [
                "decision-report",
                "implementation-map",
                "evidence"
            ]
        }),
        openChecks: normalizeRefs(input.openChecks),
        transition: stable(input.transition || {
            "next stage": "8"
        })
    };
    const defaults = {
        confirmedUsages: "confirmed",
        checkedNoUsage: "checked-no-usage",
        referenceOnly: "reference-only",
        noise: "noise"
    };
    for (const name of COLLECTIONS)model[name] = normalizeRows(input[name], name.replace(/[A-Z]/g, (m)=>`-${m.toLowerCase()}`), defaults[name]);
    model.evidenceIndex = model.evidenceIndex.map((row)=>({
            ...row,
            status: row.status || row.confirmation?.status,
            sourceHash: row.sourceHash || row.confirmation?.sourceHash,
            ...(row.status || row.confirmation?.status) === "checked-no-usage" && !asArray(row.evidenceRefs).length ? {
                evidenceRefs: [
                    row.id
                ]
            } : {}
        }));
    model.integrity = {
        algorithm: "sha256",
        canonicalDigest: digest(withoutIntegrity(model))
    };
    return model;
}
module.exports = {
    normalizeReportModel
};
