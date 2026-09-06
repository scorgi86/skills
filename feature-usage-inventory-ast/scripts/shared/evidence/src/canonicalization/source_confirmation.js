"use strict";
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
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
    const confirmation = item.confirmation || {}, evidenceRefs = [
        ...new Set(confirmation.evidenceRefs || item.evidenceRefs || [])
    ].sort(), claimedHash = confirmation.sourceHash || item.sourceHash || null, resolved = sourceFile(item, options);
    let currentHash = null;
    if (resolved) {
        try {
            if (fs.statSync(resolved.file).isFile()) currentHash = crypto.createHash("sha256").update(fs.readFileSync(resolved.file)).digest("hex");
        } catch  {}
    }
    const confirmed = confirmation.status === "source-confirmed" && evidenceRefs.length && /^[a-f0-9]{64}$/i.test(String(claimedHash || "")) && currentHash === String(claimedHash).toLowerCase();
    return {
        status: confirmed ? "source-confirmed" : "candidate",
        evidenceRefs,
        sourceHash: confirmed ? currentHash : null
    };
}
module.exports = {
    confirmationOf,
    declaredRepository,
    sourceFile
};
