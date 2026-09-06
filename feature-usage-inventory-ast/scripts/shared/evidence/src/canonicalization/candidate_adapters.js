"use strict";
function candidatesFromSourceEvidence(sourceEvidence = {}, repository = "") {
    return (sourceEvidence.checks || []).flatMap((check)=>(check.matches || check.evidence || []).map((match)=>({
                repository: match.repository || check.repository || repository,
                file: match.file || match.path,
                symbol: match.symbol || check.symbol || "",
                line: match.line,
                column: match.column,
                usageKind: match.usageKind || "source-text",
                matchedTerm: check.term || check.query,
                excerpt: match.excerpt || match.text || match.snippet,
                evidenceRefs: match.evidenceRefs || [],
                sourceHash: match.sourceHash || null,
                provenance: {
                    checkId: check.id || null,
                    source: "source-evidence"
                }
            })));
}
function astUsageKind(group) {
    const relation = String(group.relation || "").toLowerCase();
    if (/write|assign|set/.test(relation)) return "field-write";
    if (/read|get|access/.test(relation)) return "field-read";
    if (/call|invoke/.test(relation)) return "call-graph";
    if (/declar|define|export/.test(relation)) return "ast-definition";
    return "ast-reference";
}
function candidatesFromAst(ast = {}, repository = "") {
    return (ast.results || []).flatMap((result)=>(result.semanticGroups || result.groups || []).map((group)=>({
                repository,
                file: group.example?.file || group.firstAnchor?.file,
                symbol: group.owner || group.field || group.target || "",
                range: group.example?.range || group.firstAnchor?.range,
                line: group.firstAnchor?.line,
                usageKind: astUsageKind(group),
                matchedTerms: result.projectionHints?.terms || [],
                excerpt: group.example?.snippet,
                provenance: {
                    queryId: result.id || null,
                    groupKey: group.key || null,
                    source: "ast"
                }
            })));
}
function candidatesFromGitNexus(graph = {}, repository = "") {
    const context = graph.context || graph, values = [
        context.symbol,
        ...Object.values(context.incoming || {}).flat(),
        ...Object.values(context.outgoing || {}).flat()
    ].filter(Boolean);
    return values.map((item)=>({
            repository,
            file: item.filePath || item.file,
            symbol: item.name || item.qualifiedName || "",
            line: item.startLine,
            usageKind: "call-graph",
            provenance: {
                source: "gitnexus",
                queryId: context.seed || null
            }
        }));
}
function candidatesFromBoundaries(boundaries = [], repository = "") {
    return boundaries.map((item)=>({
            repository: item.producerRepo || repository,
            file: item.anchor?.file,
            line: item.anchor?.line,
            symbol: item.symbol || "",
            usageKind: "ast-reference",
            matchedTerms: item.searchTerms || [],
            evidenceRefs: item.evidenceRefs || [],
            provenance: {
                source: "boundary",
                queryId: item.id || null
            }
        }));
}
function candidatesFromOwnership(ownership = {}, repository = "") {
    return (ownership?.groups || ownership?.nodes || []).filter((item)=>item.anchor || item.example).map((item)=>({
            repository,
            file: (item.anchor || item.example).file,
            line: (item.anchor || item.example).line,
            symbol: item.object || item.id || "",
            usageKind: /define/i.test(item.relation || "") ? "ast-definition" : "ast-reference",
            evidenceRefs: item.evidenceRefs || [],
            confirmation: item.confirmation,
            provenance: {
                source: "ownership",
                queryId: item.id || null
            }
        }));
}
module.exports = {
    astUsageKind,
    candidatesFromAst,
    candidatesFromBoundaries,
    candidatesFromGitNexus,
    candidatesFromOwnership,
    candidatesFromSourceEvidence
};
