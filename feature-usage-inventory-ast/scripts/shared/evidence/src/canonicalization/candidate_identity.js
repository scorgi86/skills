"use strict";
const path = require("node:path");
function pathKey(value, repository = {}) {
    const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
    return repository.caseSensitive === false || repository.caseSensitive !== true && process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function attributeRepository(item, options = {}) {
    const repositories = options.repositoryScope?.repositories || [], file = item.file || item.path || "";
    if (!repositories.length) return { item };
    let resolvedFile = file;
    if (!path.isAbsolute(file)) {
        const declared = item.repository ? repositories.filter(repo => repo.id === item.repository) : repositories.length === 1 ? repositories : [];
        if (declared.length !== 1 || !declared[0].root) return {
            item: { ...item, repository: "" },
            diagnostic: { code: declared.length > 1 || !item.repository ? "ambiguous-repository" : "repository-attribution", file, message: "Relative evidence requires exactly one declared repository root" }
        };
        resolvedFile = path.resolve(declared[0].root, file);
    }
    const matches = repositories.filter(repo => repo.root && (() => {
        const relative = path.relative(path.resolve(repo.root), path.resolve(resolvedFile));
        return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    })());
    if (matches.length !== 1) return {
        item: { ...item, repository: "" },
        diagnostic: { code: matches.length > 1 || !item.repository ? "ambiguous-repository" : "repository-attribution", file, message: "Evidence must identify exactly one declared repository root" }
    };
    const repository = matches[0];
    if (item.repository && item.repository !== repository.id) return {
        item: { ...item, repository: repository.id },
        diagnostic: { code: "repository-attribution", file, message: `Evidence repository ${item.repository} conflicts with containing root ${repository.id}` }
    };
    return { item: { ...item, repository: repository.id }, repository };
}
function exclusionRules(options = {}, repository = "") {
    return [...options.exclusions || [], ...(options.repositoryScope?.repositories || []).filter(r => r.id === repository).flatMap(r => r.exclusions || [])]
        .map(item => String(item).replaceAll("\\", "/").replace(/^\*+|\*+$/g, "")).filter(Boolean);
}
function excluded(value, options = {}, repository = "") {
    const repo = (options.repositoryScope?.repositories || []).find(r => r.id === repository) || {};
    const normalized = pathKey(value, repo), segments = normalized.split("/");
    return exclusionRules(options, repository).some(value => {
        const rule = pathKey(value, repo);
        return rule.includes("/") ? normalized.includes(rule) : segments.includes(rule) || normalized.endsWith(rule);
    });
}
function rangeOf(item) {
    const range = item.range || {};
    return {
        startLine: Number(range.startLine ?? range.start?.line ?? item.line ?? item.confirmation?.line ?? 0),
        startColumn: Number(range.startColumn ?? range.start?.column ?? item.column ?? 0),
        endLine: Number(range.endLine ?? range.end?.line ?? item.endLine ?? item.confirmation?.endLine ?? item.line ?? 0),
        endColumn: Number(range.endColumn ?? range.end?.column ?? item.column ?? 0)
    };
}
function keyOf(item, options = {}) {
    const range = rangeOf(item), repo = (options.repositoryScope?.repositories || []).find(r => r.id === item.repository) || {};
    const file = item.file || item.path;
    const identity = [item.repository || "", pathKey(repo.root && path.isAbsolute(file) ? path.relative(repo.root, file) : file, repo), item.symbol || "", range.startLine, range.startColumn, range.endLine, range.endColumn, item.usageKind || "source-text"];
    const claims = [...new Set([item.claimRef, ...(item.claimRefs || [])].filter(Boolean))].sort();
    if (claims.length || item.role) identity.push(JSON.stringify({ claims, role: item.role || "" }));
    return identity.join("\u001f");
}
module.exports = { attributeRepository, excluded, exclusionRules, keyOf, rangeOf };
