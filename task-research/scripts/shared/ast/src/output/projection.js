"use strict";
const { groupKey } = require("./identity.js");
function truncateText(value, maxChars) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}
function compactEvidence(evidence, maxSnippetChars) {
    if (!evidence || typeof evidence !== "object") return evidence;
    const compact = {
        ...evidence
    };
    if (Object.prototype.hasOwnProperty.call(compact, "snippet")) compact.snippet = truncateText(compact.snippet, maxSnippetChars);
    return compact;
}
function compactItem(item, maxEvidencePerItem, maxSnippetChars) {
    const compact = {
        ...item
    };
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    compact.evidence = evidence.slice(0, maxEvidencePerItem).map((entry)=>compactEvidence(entry, maxSnippetChars));
    if (evidence.length > compact.evidence.length) {
        compact.evidenceTotal = evidence.length;
        compact.evidenceSuppressed = evidence.length - compact.evidence.length;
    }
    compact.groupKey = groupKey(item);
    return compact;
}
function countEvidence(items) {
    return items.reduce((total, item)=>total + (Array.isArray(item.evidence) ? item.evidence.length : 0), 0);
}
function visibleCollection(data) {
    if (!data || typeof data !== "object") return null;
    for (const key of [
        "items",
        "owners",
        "recipients"
    ]){
        if (Array.isArray(data[key])) return {
            key,
            items: data[key]
        };
    }
    return null;
}
function sourceItems(data) {
    if (!data || typeof data !== "object") return [];
    if (Array.isArray(data._allItems)) return data._allItems;
    const visible = visibleCollection(data);
    if (visible) return visible.items;
    if (Array.isArray(data.relations) || Array.isArray(data.symbols)) return [
        ...data.symbols || [],
        ...data.relations || []
    ];
    return [];
}
function replaceAnalyzeArrays(data, items) {
    const keep = new Set([
        "file",
        "parser",
        "status",
        "warnings",
        "errors",
        "elapsedMs"
    ]);
    for (const key of Object.keys(data)){
        if (Array.isArray(data[key]) && !keep.has(key)) delete data[key];
    }
    data.items = items;
}
function setVisibleItems(data, items) {
    const visible = visibleCollection(data);
    if (visible) data[visible.key] = items;
    else replaceAnalyzeArrays(data, items);
    data.returned = items.length;
}
module.exports = {
    compactItem,
    sourceItems,
    visibleCollection,
    countEvidence,
    setVisibleItems,
    compactEvidence
};
