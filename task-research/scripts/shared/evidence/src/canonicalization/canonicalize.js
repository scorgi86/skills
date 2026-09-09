"use strict";
const path = require("node:path");
const crypto = require("node:crypto");
const { attributeRepository, excluded, keyOf, rangeOf } = require("./candidate_identity.js");
const { confirmationOf } = require("./source_confirmation.js");
const RANK = { "ast-definition": 100, "field-write": 95, "field-read": 90, "call-graph": 90, "ast-reference": 85, "source-text": 60, comment: 20, fixture: 10, locale: 5 };
const unique = values => [...new Set(values.filter(Boolean))].sort();
function provenanceOf(item) {
    return (Array.isArray(item.provenance) ? item.provenance : [item.provenance]).filter(Boolean)
        .map(p => typeof p === "string" ? p : [p.source, p.queryId || p.checkId, p.groupKey].filter(Boolean).join(":"));
}
function aliasesOf(item) {
    const provenance = item.provenance;
    return unique([item.id, ...item.aliases || [], ...(!Array.isArray(provenance) && provenance && typeof provenance === "object" ? [provenance.checkId, provenance.queryId] : [])]);
}
function canonicalizeStage2Candidates(candidates = [], options = {}) {
    const groups = new Map(), identities = new Map(), diagnostics = [];
    const metrics = { candidatesFound: candidates.length, candidatesRetained: 0, duplicatesRemoved: 0, noiseRemoved: 0 };
    for (const original of candidates) {
        if (!original || !(original.file || original.path)) continue;
        const attributed = attributeRepository(original, options), item = attributed.item;
        if (attributed.diagnostic) diagnostics.push(attributed.diagnostic);
        if (excluded(item.file || item.path, options, item.repository)) {
            metrics.noiseRemoved++;
            continue;
        }
        const key = keyOf(item, options), aliases = aliasesOf(item);
        if (item.id && identities.has(item.id) && identities.get(item.id) !== key) {
            diagnostics.push({ code: "evidence-id-collision", id: item.id, message: "One evidence ID names different source identities" });
        }
        if (item.id) identities.set(item.id, key);
        const confirmation = confirmationOf(item, { ...options, diagnostics, ...(attributed.diagnostic ? { repositoryScope: undefined } : {}) });
        const current = groups.get(key), terms = [item.matchedTerm, ...item.matchedTerms || []].filter(Boolean), provenance = provenanceOf(item);
        if (current) {
            current.aliases.push(...aliases);
            current.matchedTerms.push(...terms);
            current.provenance.push(...provenance);
            if (confirmation.status === "source-confirmed") {
                current.confirmation = confirmation;
                if (current.status || item.status) current.status = "source-confirmed";
                // Exact anchors must describe the same read as the winning confirmation.
                current.sourceHash = confirmation.sourceHash;
                current.sourceFragment = confirmation.sourceFragment;
            }
            const excerpt = String(item.excerpt || item.text || "").slice(0, 160);
            if (excerpt.length > current.excerpt.length) current.excerpt = excerpt;
            metrics.duplicatesRemoved++;
            continue;
        }
        groups.set(key, {
            ...(item.status ? { status: item.status === "source-confirmed" ? confirmation.status : item.status } : {}),
            ...Object.fromEntries(["evidenceKind", "description", "label", "reason", "limitations", "claim", "claimRef", "claimRefs", "role"].filter(field => item[field] !== undefined).map(field => [field, item[field]])),
            repository: item.repository || "",
            file: path.normalize(item.file || item.path),
            symbol: item.symbol || "",
            range: rangeOf(item),
            usageKind: item.usageKind || "source-text",
            rank: RANK[item.usageKind || "source-text"] ?? 50,
            matchedTerms: terms, provenance, aliases,
            excerpt: String(item.excerpt || item.text || "").slice(0, 160),
            ...(confirmation.status === "source-confirmed" ? { sourceHash: confirmation.sourceHash } : item.sourceHash ? { sourceHash: item.sourceHash } : {}),
            ...(confirmation.status === "source-confirmed" ? { sourceFragment: confirmation.sourceFragment } : typeof item.sourceFragment === "string" ? { sourceFragment: item.sourceFragment } : {}),
            confirmation
        });
    }
    const evidence = [...groups.entries()].map(([key, item]) => {
        const id = `ev-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
        return { ...item, matchedTerms: unique(item.matchedTerms), provenance: unique(item.provenance), aliases: unique([...item.aliases, id]), id };
    }).sort((a, b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
    const aliases = new Map();
    for (const row of evidence) for (const alias of row.aliases) {
        if (!aliases.has(alias)) aliases.set(alias, []);
        aliases.get(alias).push(row.id);
    }
    const evidenceIdMap = Object.fromEntries([...aliases.keys()].sort().map(alias => [alias, unique(aliases.get(alias))]));
    metrics.candidatesRetained = evidence.length;
    return { evidence, evidenceIdMap, diagnostics, metrics };
}
// Only evidence reference fields participate; fact IDs and relation endpoints keep their identities.
function remapEvidenceReferences(value, map) {
    if (Array.isArray(value)) return value.map(v => remapEvidenceReferences(v, map));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        key === "evidenceRefs" && Array.isArray(item) ? unique(item.flatMap(id => Object.hasOwn(map, id) ? map[id] : [id])) : remapEvidenceReferences(item, map)
    ]));
}
module.exports = { RANK, canonicalizeStage2Candidates, remapEvidenceReferences };
