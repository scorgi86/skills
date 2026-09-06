"use strict";
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
function sourceAnchor(sourceEvidence, references = []) {
    for (const reference of references){
        const check = (sourceEvidence.checks || []).find((item)=>item.id === reference);
        const group = check && (check.groups || []).find((item)=>item.firstAnchor);
        if (group && group.firstAnchor) return group.firstAnchor;
        const match = check && check.matches && check.matches[0];
        if (match) return {
            file: match.file,
            line: match.line
        };
    }
    return null;
}
function confirmationAnchor(confirmation) {
    if (!confirmation || typeof confirmation !== "object") return null;
    const file = confirmation.file || confirmation.path;
    const line = Number(confirmation.line || confirmation.startLine);
    return file && Number.isFinite(line) && line > 0 ? {
        file,
        line
    } : null;
}
function confirmationWithFreshness(confirmation, sourceRoot, fileCache = new Map()) {
    if (!confirmation || typeof confirmation !== "object") return null;
    const result = {
        ...confirmation
    };
    const anchor = confirmationAnchor(result);
    if (!anchor) return result;
    const file = path.isAbsolute(anchor.file) ? anchor.file : sourceRoot ? path.resolve(sourceRoot, anchor.file) : null;
    if (!file || !fs.existsSync(file)) return result;
    const lines = fileCache.get(file) || (()=>{
        const loaded = fs.readFileSync(file, "utf8").split(/\r?\n/);
        fileCache.set(file, loaded);
        return loaded;
    })();
    const start = Math.max(0, anchor.line - 2);
    const fragment = lines.slice(start, anchor.line + 1).join("\n");
    result.freshness = {
        algorithm: "sha256",
        fragmentHash: crypto.createHash("sha256").update(fragment).digest("hex"),
        radius: 1
    };
    return result;
}
function isConfirmedOwnership(group) {
    return /^(confirmed|подтвержденное использование)$/i.test(String(group && group.status || ""));
}
function normalizeOwnership(request, sourceEvidence, freshnessFileCache = new Map()) {
    const ownership = request.ownership || {};
    const groups = Array.isArray(ownership.groups) ? ownership.groups : [];
    return {
        expectedIds: [
            ...new Set(ownership.expectedIds || [])
        ],
        groups: groups.map((group, index)=>{
            const confirmation = confirmationWithFreshness(group.confirmation, request.sourceRoot, freshnessFileCache);
            const status = group.status || "candidate";
            return {
                id: group.id || `ownership-${index + 1}`,
                order: group.order || "уточнить",
                role: group.role || "владелец/контейнер",
                object: group.object || "",
                relation: group.relation || "",
                evidenceRefs: [
                    ...new Set(group.evidenceRefs || [])
                ],
                // A confirmed finding keeps the reviewer-selected source location.
                anchor: isConfirmedOwnership({
                    status
                }) ? confirmationAnchor(confirmation) || group.anchor || sourceAnchor(sourceEvidence, group.evidenceRefs) : group.anchor || sourceAnchor(sourceEvidence, group.evidenceRefs),
                status,
                required: group.required !== false,
                confirmation
            };
        })
    };
}
module.exports = {
    confirmationWithFreshness,
    normalizeOwnership
};
