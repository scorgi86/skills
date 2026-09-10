"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { validateStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { confirmationOf } = require("../../../shared/evidence/src/canonicalization/source_confirmation.js");

function evidenceReferences(value, references = new Set(), seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return references;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) evidenceReferences(item, references, seen);
        return references;
    }
    for (const [key, item] of Object.entries(value)) {
        if (key.endsWith("Refs") && Array.isArray(item)) {
            for (const reference of item) if (reference) references.add(String(reference));
        } else evidenceReferences(item, references, seen);
    }
    return references;
}

function expandedEvidence(artifactFile) {
    const stageRoot = path.dirname(path.dirname(path.resolve(artifactFile)));
    const validation = validateStageArtifact(stageRoot);
    if (!validation.ok) throw new Error(`Invalid lineage evidence artifact: ${validation.errors.join("; ")}`);
    const bundle = JSON.parse(fs.readFileSync(path.join(stageRoot, "canonical", "evidence.json"), "utf8"));
    return (bundle.evidence || []).map((item) => ({
        ...item,
        ...(Number.isInteger(item.fileId) ? { file: bundle.files[item.fileId] } : {})
    }));
}

function referencedEvidence(value, lineage = [], repositoryScope) {
    const references = evidenceReferences(value);
    if (!references.size) return [];
    const evidence = new Map();
    for (const descriptor of lineage) {
        for (const item of expandedEvidence(descriptor.artifact)) {
            if (![item.id, ...(item.aliases || [])].some((reference) => references.has(String(reference)))) continue;
            const existing = evidence.get(item.id);
            const identity = (row) => JSON.stringify([row.repository, row.file, row.symbol || "", row.range || null, row.usageKind || ""]);
            if (existing && identity(existing) !== identity(item)) throw new Error(`Conflicting lineage evidence: ${item.id}`);
            evidence.set(item.id, item);
        }
    }
    const diagnostics = [];
    for (const item of evidence.values()) {
        if (item.status !== "source-confirmed" && item.confirmation?.status !== "source-confirmed") continue;
        const confirmation = confirmationOf(item, { repositoryScope, diagnostics });
        if (confirmation.status !== "source-confirmed") throw new Error(`Stale lineage evidence: ${item.id}`);
    }
    return [...evidence.values()];
}

module.exports = { evidenceReferences, expandedEvidence, referencedEvidence };
