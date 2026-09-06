"use strict";
const path = require("node:path");
const crypto = require("node:crypto");
const { excluded, keyOf, rangeOf } = require("./candidate_identity.js");
const { confirmationOf } = require("./source_confirmation.js");
const RANK = {
    "ast-definition": 100,
    "field-write": 95,
    "field-read": 90,
    "call-graph": 90,
    "ast-reference": 85,
    "source-text": 60,
    comment: 20,
    fixture: 10,
    locale: 5
};
function canonicalizeStage2Candidates(candidates = [], options = {}) {
    const groups = new Map(), metrics = {
        candidatesFound: candidates.length,
        candidatesRetained: 0,
        duplicatesRemoved: 0,
        noiseRemoved: 0
    };
    for (const item of candidates){
        if (!item || !(item.file || item.path)) continue;
        if (excluded(item.file || item.path, options)) {
            metrics.noiseRemoved += 1;
            continue;
        }
        const key = keyOf(item), current = groups.get(key), terms = [
            item.matchedTerm,
            ...item.matchedTerms || []
        ].filter(Boolean), provenance = item.provenance ? [
            typeof item.provenance === "string" ? item.provenance : [
                item.provenance.source,
                item.provenance.queryId || item.provenance.checkId,
                item.provenance.groupKey
            ].filter(Boolean).join(":")
        ] : [];
        if (current) {
            current.matchedTerms.push(...terms);
            current.provenance.push(...provenance);
            const incoming = confirmationOf(item, options);
            if (incoming.status === "source-confirmed") current.confirmation = incoming;
            const excerpt = String(item.excerpt || item.text || "").slice(0, 160);
            if (excerpt.length > current.excerpt.length) current.excerpt = excerpt;
            metrics.duplicatesRemoved += 1;
            continue;
        }
        groups.set(key, {
            repository: item.repository || "",
            file: path.normalize(item.file || item.path || ""),
            symbol: item.symbol || "",
            range: rangeOf(item),
            usageKind: item.usageKind || "source-text",
            rank: RANK[item.usageKind || "source-text"] ?? 50,
            matchedTerms: terms,
            provenance,
            excerpt: String(item.excerpt || item.text || "").slice(0, 160),
            confirmation: confirmationOf(item, options)
        });
    }
    const evidence = [
        ...groups.values()
    ].map((item)=>({
            ...item,
            matchedTerms: [
                ...new Set(item.matchedTerms)
            ].sort(),
            provenance: [
                ...new Set(item.provenance)
            ].sort(),
            id: `ev-${crypto.createHash("sha256").update(keyOf(item)).digest("hex").slice(0, 16)}`
        })).sort((a, b)=>b.rank - a.rank || a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
    metrics.candidatesRetained = evidence.length;
    return {
        evidence,
        metrics
    };
}
module.exports = {
    RANK,
    canonicalizeStage2Candidates
};
