"use strict";
const { groupKey } = require("../output/identity.js");
const { sameName, buildChains } = require("./chains.js");
function allSymbols(analysis) {
    return analysis.results.flatMap((result)=>result.symbols);
}
function allRelations(analysis) {
    return analysis.results.flatMap((result)=>result.relations);
}
function bounded(items, maxResults = 100) {
    const limit = Math.max(1, Number(maxResults) || 100);
    const result = {
        items: items.slice(0, limit),
        returned: Math.min(items.length, limit),
        total: items.length,
        truncated: items.length > limit
    };
    Object.defineProperty(result, "_allItems", {
        value: items,
        enumerable: false
    });
    return result;
}
function runQuery(command, analysis, options = {}) {
    const symbols = allSymbols(analysis);
    const relations = allRelations(analysis);
    let selected;
    if (command === "symbols" || command === "index") selected = symbols.filter((item)=>!options.kind || item.kind === options.kind);
    else if (command === "fields") selected = relations.filter((item)=>item.field && (!options.owner || sameName(item.ownerQualifiedName, options.owner)) && (!options.field || item.field === options.field));
    else if (command === "methods") selected = symbols.filter((item)=>item.kind.includes("method") && (!options.owner || sameName(item.owner, options.owner)));
    else if (command === "reads") selected = relations.filter((item)=>item.relation === "field-read" && (!options.field || item.field === options.field));
    else if (command === "writes" || command === "assignments") selected = relations.filter((item)=>item.relation.includes("write") || item.relation.includes("to-field") || item.relation === "object-field");
    else if (command === "calls") selected = relations.filter((item)=>[
            "call",
            "construct"
        ].includes(item.relation) && (!options.symbol || sameName(item.sourceSymbol, options.symbol) || String(item.sourceSymbol || "").startsWith(`${options.symbol}.`) || sameName(item.targetQualifiedName, options.symbol)));
    else if (command === "callers") selected = relations.filter((item)=>[
            "call",
            "construct"
        ].includes(item.relation) && sameName(item.targetQualifiedName, options.symbol));
    else if (command === "callees") selected = relations.filter((item)=>[
            "call",
            "construct"
        ].includes(item.relation) && (sameName(item.sourceSymbol, options.symbol) || String(item.sourceSymbol || "").startsWith(`${options.symbol}.`)));
    else if (command === "owners" || command === "recipients") {
        selected = relations.filter((item)=>![
                "call",
                "construct",
                "field-read",
                "import",
                "export"
            ].includes(item.relation) && (sameName(item.targetQualifiedName, options.type) || (item.candidateTypes || []).some((name)=>sameName(name, options.type))));
        if (command === "owners") {
            selected.push(...symbols.filter((item)=>item.kind === "variable" && (sameName(item.inferredType, options.type) || sameName(item.candidateType, options.type))).map((item)=>({
                    ownerQualifiedName: item.scope || "<module>",
                    relation: "local-instance",
                    field: item.name,
                    targetQualifiedName: item.inferredType !== "unknown" ? item.inferredType : item.candidateType,
                    sourceSymbol: item.scope || "<module>",
                    evidence: item.evidence
                })));
        }
        selected = selected.map((item)=>{
            return {
                ...item,
                matchMode: "exact"
            };
        });
    } else if (command === "collections") selected = relations.filter((item)=>item.relation.startsWith("collection-"));
    else if (command === "chain") return buildChains(relations, options.type, options);
    else if (command === "find" || command === "summary") {
        const terms = String(options.terms || options.type || "").split(",").map((term)=>term.trim().toLowerCase()).filter(Boolean);
        selected = [
            ...symbols,
            ...relations
        ].filter((item)=>terms.some((term)=>JSON.stringify(item).toLowerCase().includes(term)));
    } else if (command === "stats") return analysis.stats;
    else selected = relations;
    if (options.owner) selected = selected.filter((item)=>sameName(item.ownerQualifiedName || item.owner, options.owner));
    if (options.field) selected = selected.filter((item)=>item.field === options.field);
    if (options.kind && command !== "symbols" && command !== "index") selected = selected.filter((item)=>item.relation === options.kind);
    if (options.terms && command !== "find" && command !== "summary") {
        const terms = String(options.terms).split(",").map((term)=>term.trim().toLowerCase()).filter(Boolean);
        selected = selected.filter((item)=>terms.some((term)=>JSON.stringify(item).toLowerCase().includes(term)));
    }
    if (options.lineStart || options.lineEnd) {
        const start = options.lineStart || 1;
        const end = options.lineEnd || Number.MAX_SAFE_INTEGER;
        selected = selected.filter((item)=>(item.evidence || []).some((evidence)=>{
                const line = evidence.range && evidence.range.start && evidence.range.start.line;
                return Number.isFinite(line) && line >= start && line <= end;
            }));
    }
    if (options.minConfidence) {
        const rank = {
            candidate: 1,
            "name-inferred": 1,
            resolved: 2,
            exact: 3
        };
        const minimum = rank[options.minConfidence] || 1;
        selected = selected.filter((item)=>Math.max(...(item.evidence || []).map((evidence)=>rank[evidence.confidence] || 1), 1) >= minimum);
    }
    if (options.detailsFor) selected = selected.filter((item)=>groupKey(item) === options.detailsFor);
    return bounded(selected, options.maxResults);
}
function legacyView(result) {
    const symbols = result.symbols || [];
    const relations = result.relations || [];
    const fields = relations.filter((item)=>item.field && item.relation !== "field-read");
    return {
        constructors: symbols.filter((item)=>item.method === "constructor"),
        fields,
        prototypeMethods: symbols.filter((item)=>item.kind.includes("method")),
        variables: symbols.filter((item)=>item.kind === "variable"),
        aliases: symbols.filter((item)=>item.kind === "alias"),
        instanceAssignments: fields.filter((item)=>item.relation.includes("write")),
        setterAssignments: fields.filter((item)=>item.relation.includes("to-field")),
        arrayOwnership: fields.filter((item)=>item.relation === "collection-push"),
        indexedAssignments: fields.filter((item)=>item.relation === "computed-write"),
        owners: fields.filter((item)=>item.targetQualifiedName !== "unknown"),
        chains: []
    };
}
module.exports = {
    legacyView,
    runQuery
};
