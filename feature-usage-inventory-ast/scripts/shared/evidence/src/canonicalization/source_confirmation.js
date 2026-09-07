"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { validateSourceAnchor } = require("./source_anchor.js");
function declaredRepository(item, options = {}) {
    return (options.repositoryScope?.repositories || []).find((repository)=>repository && repository.id === item.repository && repository.root);
}
function sourceFile(item, options = {}) {
    const repository = declaredRepository(item, options);
    if (!repository) return null;
    const root = path.resolve(repository.root), file = path.resolve(root, item.file || item.path || ""), relative = path.relative(root, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    try {
        const physicalRoot = fs.realpathSync(root), physicalFile = fs.realpathSync(file), physicalRelative = path.relative(physicalRoot, physicalFile);
        if (!physicalRelative || physicalRelative.startsWith("..") || path.isAbsolute(physicalRelative)) return null;
        return {
            file: physicalFile,
            repository
        };
    } catch  {
        return null;
    }
}
function confirmationOf(item, options = {}) {
    const confirmation = item.confirmation || (item.status === "source-confirmed" ? { ...item, evidenceRefs: item.evidenceRefs?.length ? item.evidenceRefs : [item.id].filter(Boolean) } : {}), evidenceRefs = [
        ...new Set(confirmation.evidenceRefs || item.evidenceRefs || [])
    ].sort(), claimedHash = confirmation.sourceHash || item.sourceHash || null, resolved = sourceFile(item, options);
    const anchor = { sourceHash: claimedHash, line: item.line ?? confirmation.line, endLine: item.endLine ?? confirmation.endLine, sourceFragment: item.sourceFragment ?? confirmation.sourceFragment };
    let valid = false;
    let validation = {code: "repository-attribution", message: "Confirmation file must be inside its declared repository"};
    if (resolved) {
        try {
            if (fs.statSync(resolved.file).isFile()) { validation = validateSourceAnchor(anchor, fs.readFileSync(resolved.file)); valid = validation.ok; }
        } catch  {}
    }
    if (confirmation.status === "source-confirmed" && !valid) options.diagnostics?.push({ ...validation, file: item.file || item.path, repository: item.repository });
    const confirmed = confirmation.status === "source-confirmed" && evidenceRefs.length && valid;
    return {
        status: confirmed ? "source-confirmed" : "candidate",
        evidenceRefs,
        sourceHash: confirmed ? claimedHash.toLowerCase() : null,
        ...(confirmed ? { line: anchor.line, endLine: anchor.endLine, sourceFragment: anchor.sourceFragment } : {})
    };
}
module.exports = {
    confirmationOf,
    declaredRepository,
    sourceFile
};
