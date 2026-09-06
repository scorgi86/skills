"use strict";
const path = require("path");
const fs = require("fs");
const DEFAULT_EXTENSIONS = new Set([
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
    ".md",
    ".xml"
]);
function shouldTraverseEntry(entry, options) {
    if (options.excludeDirs.has(entry.name)) return false;
    return options.followSymlinks || !entry.isSymbolicLink();
}
function isExcludedFile(file, options) {
    return options.excludeFilePatterns.some((pattern)=>{
        pattern.lastIndex = 0;
        return pattern.test(file);
    });
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function createTraversalOptions(request = {}, check = {}) {
    const names = [
        ...request.excludeDirs || [],
        ...check.excludeDirs || []
    ].map((value)=>String(value));
    const patterns = [
        ...request.excludeFilePatterns || [],
        ...check.excludeFilePatterns || []
    ].map((value)=>value instanceof RegExp ? value : new RegExp(String(value)));
    return {
        excludeDirs: new Set(names),
        excludeFilePatterns: patterns,
        followSymlinks: check.followSymlinks === true || check.followSymlinks === undefined && request.followSymlinks === true
    };
}
function listFiles(entry, extensions, seen = new Set(), options = createTraversalOptions()) {
    const resolved = path.resolve(entry);
    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch  {
        return [];
    }
    const real = fs.realpathSync(resolved);
    if (seen.has(real)) return [];
    if (stat.isFile()) return extensions.has(path.extname(resolved).toLowerCase()) && !isExcludedFile(resolved, options) ? [
        resolved
    ] : [];
    if (!stat.isDirectory()) return [];
    seen.add(real);
    const files = [];
    for (const child of fs.readdirSync(resolved, {
        withFileTypes: true
    })){
        if (options.excludeDirs.has(child.name)) continue;
        const full = path.join(resolved, child.name);
        if ((child.isDirectory() || child.isSymbolicLink()) && shouldTraverseEntry(child, options)) files.push(...listFiles(full, extensions, seen, options));
        else if (child.isFile() && extensions.has(path.extname(child.name).toLowerCase()) && !isExcludedFile(full, options)) files.push(full);
    }
    return files;
}
function traversalKey(entries, extensions, options) {
    return JSON.stringify({
        entries: entries.map((entry)=>path.resolve(entry)).sort(compareText),
        extensions: [
            ...extensions
        ].sort(compareText),
        excludeDirs: [
            ...options.excludeDirs
        ].sort(compareText),
        excludeFilePatterns: options.excludeFilePatterns.map((pattern)=>({
                source: pattern.source,
                flags: pattern.flags
            })).sort((left, right)=>compareText(`${left.source}\u0000${left.flags}`, `${right.source}\u0000${right.flags}`)),
        followSymlinks: options.followSymlinks
    });
}
module.exports = {
    createTraversalOptions,
    isExcludedFile,
    listFiles,
    shouldTraverseEntry,
    compareText,
    DEFAULT_EXTENSIONS,
    traversalKey
};
