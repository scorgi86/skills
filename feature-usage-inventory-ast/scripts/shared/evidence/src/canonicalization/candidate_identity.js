"use strict";
function normalizedPath(value) {
    return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}
function exclusionRules(options = {}) {
    return [
        ...options.exclusions || [],
        ...(options.repositoryScope?.repositories || []).flatMap((repository)=>repository.exclusions || [])
    ].map((item)=>normalizedPath(item).replace(/^\*+|\*+$/g, "")).filter(Boolean);
}
function excluded(value, options = {}) {
    const normalized = normalizedPath(value), segments = normalized.split("/");
    return exclusionRules(options).some((rule)=>rule.includes("/") ? normalized.includes(rule) : segments.includes(rule) || normalized.endsWith(rule));
}
function rangeOf(item) {
    const range = item.range || {};
    return {
        startLine: Number(range.startLine ?? range.start?.line ?? item.line ?? 0),
        startColumn: Number(range.startColumn ?? range.start?.column ?? item.column ?? 0),
        endLine: Number(range.endLine ?? range.end?.line ?? item.line ?? 0),
        endColumn: Number(range.endColumn ?? range.end?.column ?? item.column ?? 0)
    };
}
function keyOf(item) {
    const range = rangeOf(item);
    return [
        item.repository || "",
        normalizedPath(item.file || item.path),
        item.symbol || "",
        range.startLine,
        range.startColumn,
        range.endLine,
        range.endColumn,
        item.usageKind || "source-text"
    ].join("\u001f");
}
module.exports = {
    excluded,
    exclusionRules,
    keyOf,
    rangeOf
};
