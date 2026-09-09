"use strict";
const { groupKey, semanticParts } = require("./identity.js");
const { compactEvidence } = require("./projection.js");
function groupItems(items, maxSnippetChars) {
    const groups = new Map();
    for (const item of items){
        const key = groupKey(item);
        let group = groups.get(key);
        if (!group) {
            const parts = semanticParts(item);
            group = {
                key,
                ...parts,
                items: 0,
                evidence: 0,
                sourceSymbols: new Set(),
                example: null
            };
            groups.set(key, group);
        }
        group.items += 1;
        group.evidence += Array.isArray(item.evidence) ? item.evidence.length : 0;
        if (item.sourceSymbol) group.sourceSymbols.add(item.sourceSymbol);
        if (!group.example && Array.isArray(item.evidence) && item.evidence[0]) group.example = compactEvidence(item.evidence[0], maxSnippetChars);
    }
    return [
        ...groups.values()
    ].map((group)=>({
            key: group.key,
            owner: group.owner,
            relation: group.relation,
            field: group.field,
            target: group.target,
            items: group.items,
            evidence: group.evidence,
            sourceSymbols: group.sourceSymbols.size,
            example: group.example
        }));
}
function splitFilterValues(value) {
    if (Array.isArray(value)) return value.flatMap(splitFilterValues);
    return String(value || "").split(",").map((part)=>part.trim()).filter(Boolean);
}
function wildcardPattern(value) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
}
function matchesFilter(actual, expected) {
    const values = splitFilterValues(expected);
    return !values.length || values.some((value)=>wildcardPattern(value).test(String(actual || "")));
}
function filterSemanticGroups(groups, filters = {}) {
    return groups.filter((group)=>matchesFilter(group.owner, filters.groupOwner) && matchesFilter(group.field, filters.groupField) && matchesFilter(group.relation, filters.groupRelation) && matchesFilter(group.target, filters.groupTarget));
}
module.exports = {
    filterSemanticGroups,
    groupItems,
    splitFilterValues
};
