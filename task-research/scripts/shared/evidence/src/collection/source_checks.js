"use strict";
const path = require("path");
const crypto = require("node:crypto");
const fs = require("fs");
const { stableHash } = require("../../../output/src/fact_projection.js");
const { compareText, DEFAULT_EXTENSIONS, createTraversalOptions, traversalKey } = require("./source_files.js");
const { evidenceGroupIdentity } = require("./groups.js");
const { selectEvidenceGroups, selectRoundRobin } = require("./selection.js");
function compilePattern(pattern) {
    const value = typeof pattern === "string" ? {
        value: pattern
    } : pattern;
    if (!value || !value.value) throw new Error("Evidence pattern requires value");
    if (value.regex) return new RegExp(value.value, value.caseSensitive ? "g" : "gi");
    const escaped = value.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, value.caseSensitive ? "g" : "gi");
}
function runSourceCheck(check, index, request, contentCache, traversalCache, enumerateFiles) {
    const entries = (check.files || (check.file ? [
        check.file
    ] : check.scope ? [
        check.scope
    ] : [])).map((entry)=>path.resolve(entry)).sort(compareText);
    if (!entries.length) throw new Error(`Check ${check.id || index + 1} requires explicit file, files, or scope`);
    const extensions = new Set((check.extensions || [
        ...DEFAULT_EXTENSIONS
    ]).map((extension)=>extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`));
    const traversal = createTraversalOptions(request, check);
    const cacheKey = traversalKey(entries, extensions, traversal);
    if (!traversalCache.has(cacheKey)) {
        const files = [
            ...new Set(entries.flatMap((entry)=>enumerateFiles(entry, extensions, new Set(), traversal)))
        ].map((file)=>path.resolve(file)).sort(compareText);
        traversalCache.set(cacheKey, { files, diagnostics: [...traversal.diagnostics] });
    }
    const {files, diagnostics} = traversalCache.get(cacheKey);
    const maxFiles = Math.max(1, Number(check.maxFiles || request.maxFiles) || 200);
    if (files.length > maxFiles && !check.allowWideScope) throw new Error(`Evidence scope blocked for ${check.id || index + 1}: ${files.length} files exceeds ${maxFiles}`);
    const maxMatches = Math.max(1, Number(check.maxMatches || request.maxMatches) || 20);
    const maxSnippetChars = Math.max(20, Number(check.maxSnippetChars || request.maxSnippetChars) || 240);
    const patternSpecs = check.patterns || (check.pattern ? [
        check.pattern
    ] : []);
    const patterns = patternSpecs.map((spec, patternIndex)=>({
            regex: compilePattern(spec),
            id: typeof spec === "object" && spec.id ? String(spec.id) : `pattern-${patternIndex + 1}`
        }));
    if (!patterns.length) throw new Error(`Check ${check.id || index + 1} requires pattern or patterns`);
    const groupsByKey = new Map();
    const retainAllMatches = check.retainAllMatches === true || check.retainAllMatches === undefined && request.retainAllMatches === true;
    const fullMatches = [];
    let totalMatches = 0;
    for (const file of files){
        const cached = check.mode === "file-name" ? null : contentCache.get(file) || (()=>{
            const bytes = fs.readFileSync(file);
            const content = bytes.toString("utf8");
            const value = {
                content,
                bytes,
                sourceHash: crypto.createHash("sha256").update(bytes).digest("hex"),
                lines: content.split(/\r?\n/)
            };
            contentCache.set(file, value);
            return value;
        })();
        const lines = check.mode === "file-name" ? [
            file
        ] : cached.lines;
        for(let lineIndex = 0; lineIndex < lines.length; lineIndex += 1){
            const line = lines[lineIndex];
            const matchedPatterns = patterns.filter(({ regex })=>{
                regex.lastIndex = 0;
                return regex.test(line);
            });
            if (!matchedPatterns.length) continue;
            totalMatches += 1;
            const explicit = [...check.confirmations || [], ...check.confirmation ? [check.confirmation] : []].find(value =>
                value.line === lineIndex + 1 && (!value.file || path.resolve(value.file) === file));
            if (explicit?.status === "source-confirmed") {
                const validation = require("../canonicalization/source_anchor.js").validateSourceAnchor(explicit, cached.bytes);
                if (!validation.ok) throw new Error(`Check ${check.id || index + 1}: ${validation.code}: ${validation.message}`);
            }
            const anchor = check.mode === "file-name" ? {} : { endLine: lineIndex + 1, sourceFragment: line, sourceHash: cached.sourceHash, repository: check.repository, ...(explicit ? { endLine: explicit.endLine, sourceFragment: explicit.sourceFragment, confirmation: { ...explicit, evidenceRefs: explicit.evidenceRefs?.length ? explicit.evidenceRefs : [check.id || `check-${index + 1}`] } } : {}) };
            const snippet = line.replace(/\s+/g, " ").trim();
            for (const pattern of matchedPatterns){
                const descriptor = evidenceGroupIdentity(check, file, pattern.id);
                const key = `se-${stableHash(descriptor.identity, 12)}`;
                if (!groupsByKey.has(key)) groupsByKey.set(key, {
                    key,
                    label: descriptor.label,
                    identity: descriptor.identity,
                    totalMatches: 0,
                    candidates: []
                });
                const group = groupsByKey.get(key);
                group.totalMatches += 1;
                group.candidates.push({
                    file,
                    ...anchor,
                    line: check.mode === "file-name" ? null : lineIndex + 1,
                    snippet: snippet.length > maxSnippetChars ? `${snippet.slice(0, maxSnippetChars - 1)}…` : snippet,
                    groupKey: key
                });
                if (retainAllMatches) fullMatches.push({
                    file,
                    ...anchor,
                    line: check.mode === "file-name" ? null : lineIndex + 1,
                    snippet: snippet.length > maxSnippetChars ? `${snippet.slice(0, maxSnippetChars - 1)}…` : snippet,
                    groupKey: key,
                    patternId: pattern.id
                });
            }
        }
    }
    const allGroups = [
        ...groupsByKey.values()
    ].sort((left, right)=>left.key.localeCompare(right.key));
    const maxGroups = Math.max(1, Number(check.maxGroups || request.maxGroups) || 50);
    const selectedGroups = selectEvidenceGroups(allGroups, maxGroups, check.requiredGroupKeys || []);
    const matches = selectRoundRobin(selectedGroups, maxMatches);
    const returnedByGroup = new Map();
    for (const match of matches)returnedByGroup.set(match.groupKey, (returnedByGroup.get(match.groupKey) || 0) + 1);
    const groups = selectedGroups.map((group)=>{
        const returned = returnedByGroup.get(group.key) || 0;
        const first = group.candidates[0];
        return {
            key: group.key,
            label: group.label,
            identity: group.identity,
            totalMatches: group.totalMatches,
            returned,
            truncated: returned < group.totalMatches,
            firstAnchor: first ? {
                file: first.file,
                line: first.line
            } : null
        };
    });
    const result = {
        id: check.id || `check-${index + 1}`,
        spec: {
            entries,
            extensions: [...extensions].sort(),
            patterns: patternSpecs.map((item)=>typeof item === "string" ? {
                    value: item
                } : {
                    id: item.id || null,
                    value: item.value,
                    regex: Boolean(item.regex),
                    caseSensitive: Boolean(item.caseSensitive)
                }),
            excludeDirs: [
                ...traversal.excludeDirs
            ].sort(),
            excludeFilePatterns: traversal.excludeFilePatterns.map((item)=>item.source),
            followSymlinks: traversal.followSymlinks
        },
        status: diagnostics.some(d=>d.code !== "excluded") ? "partial" : totalMatches ? "candidate" : "candidate-empty",
        resultComplete: !diagnostics.some(d=>d.code !== "excluded"),
        errors: diagnostics.filter(d=>d.code !== "excluded"),
        skipped: diagnostics.filter(d=>d.code === "excluded"),
        filesScanned: files.length,
        totalMatches,
        returned: matches.length,
        truncated: matches.length < totalMatches,
        matches,
        groupDigest: stableHash(allGroups.map((group)=>group.key)),
        groupsTotal: allGroups.length,
        groupsReturned: groups.length,
        groupsTruncated: groups.length < allGroups.length,
        groups
    };
    if (retainAllMatches) result.fullMatches = fullMatches;
    return result;
}
module.exports = {
    compilePattern,
    runSourceCheck
};
