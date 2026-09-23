"use strict";
const { shortName } = require("../helpers.js");
function sameName(actual, expected) {
    if (!actual || !expected) return false;
    return actual === expected || shortName(actual) === shortName(expected);
}
function typeMatcher(typeAliases = []) {
    const parents = new Map();
    const root = name => {
        if (!parents.has(name)) parents.set(name, name);
        if (parents.get(name) !== name) parents.set(name, root(parents.get(name)));
        return parents.get(name);
    };
    for (const { aliasQualifiedName, targetQualifiedName } of typeAliases) {
        if (!aliasQualifiedName || !targetQualifiedName) continue;
        const alias = root(aliasQualifiedName), target = root(targetQualifiedName);
        if (alias !== target) parents.set(alias, target);
    }
    return (actual, expected) => sameName(actual, expected)
        || (actual && expected && parents.has(actual) && parents.has(expected) && root(actual) === root(expected));
}
function buildChains(relations, typeName, options = {}) {
    const maxDepth = Math.max(1, Number(options.maxDepth) || 10);
    const maxPaths = Math.max(1, Number(options.maxPaths) || 25);
    const maxBranches = Math.max(1, Number(options.maxBranches) || 20);
    const sameType = typeMatcher(options.typeAliases);
    const edges = relations.filter((relation)=>relation.ownerQualifiedName !== "unknown" && relation.ownerQualifiedName !== "null" && relation.targetQualifiedName !== "unknown" && relation.targetQualifiedName !== "null" && relation.relation !== "call" && relation.relation !== "field-read");
    const chains = [];
    let truncated = false;
    function walkType(current, chain, visited, depth) {
        if (chains.length >= maxPaths) {
            truncated = true;
            return;
        }
        if (depth >= maxDepth) {
            chains.push({
                status: "max-depth",
                chain
            });
            return;
        }
        const next = edges.filter((edge)=>sameType(edge.targetQualifiedName, current));
        if (!next.length) {
            chains.push({
                status: chain.length > 1 ? "leaf" : "not-found",
                chain
            });
            return;
        }
        if (next.length > maxBranches) truncated = true;
        for (const edge of next.slice(0, maxBranches)){
            const key = `${edge.ownerQualifiedName}|${edge.field}|${edge.targetQualifiedName}`;
            const step = {
                level: depth + 1,
                owner: edge.ownerQualifiedName,
                field: edge.field,
                type: edge.targetQualifiedName,
                relation: edge.relation,
                ownerCandidate: Boolean(edge.ownerCandidate),
                ownerConfidence: edge.ownerConfidence || "candidate",
                dynamic: Boolean(edge.dynamic),
                targetConfidence: edge.targetConfidence,
                targetProof: edge.targetProof,
                ownerProofEvidence: edge.ownerProofEvidence,
                assignmentSourceHash: edge.assignmentSourceHash,
                evidence: edge.evidence,
                status: "не проверено"
            };
            if (visited.has(key)) {
                chains.push({
                    status: "cycle",
                    chain: [
                        ...chain,
                        step
                    ]
                });
                continue;
            }
            walkType(edge.ownerQualifiedName, [
                ...chain,
                step
            ], new Set([
                ...visited,
                key
            ]), depth + 1);
        }
    }
    walkType(typeName, [
        {
            level: 0,
            type: typeName,
            role: "target"
        }
    ], new Set(), 0);
    return {
        chains,
        returned: chains.length,
        truncated,
        limits: {
            maxDepth,
            maxPaths,
            maxBranches
        }
    };
}
module.exports = {
    buildChains,
    sameName,
    typeMatcher
};
