"use strict";
const crypto = require("crypto");
function semanticParts(item = {}) {
    return {
        owner: item.ownerQualifiedName || item.owner || item.scope || "<module>",
        relation: item.relation || item.kind || "unknown",
        field: item.field || item.method || item.name || "",
        target: item.targetQualifiedName || item.inferredType || item.candidateType || item.qualifiedName || "unknown"
    };
}
function semanticSignature(item) {
    const parts = semanticParts(item);
    return [
        parts.owner,
        parts.relation,
        parts.field,
        parts.target
    ].join("\u001f");
}
function groupKey(item) {
    return `g-${crypto.createHash("sha256").update(semanticSignature(item)).digest("hex").slice(0, 12)}`;
}
module.exports = {
    groupKey,
    semanticSignature,
    semanticParts
};
