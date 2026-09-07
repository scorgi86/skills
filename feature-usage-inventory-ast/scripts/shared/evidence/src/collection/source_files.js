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
        diagnostics: [],
        followSymlinks: check.followSymlinks === true || check.followSymlinks === undefined && request.followSymlinks === true
    };
}
function listFiles(entry, extensions, seen = new Set(), options = createTraversalOptions()) {
    const resolved = path.resolve(entry);
    const skip = (file, reason) => options.diagnostics?.push({ code: "excluded", file, reason });
    try {
        const stat = fs.statSync(resolved), real = fs.realpathSync(resolved);
        if (seen.has(real)) { skip(resolved, "already-visited"); return []; }
        if (stat.isFile()) {
            if (extensions.has(path.extname(resolved).toLowerCase()) && !isExcludedFile(resolved, options)) return [resolved];
            skip(resolved, "extension-or-exclusion"); return [];
        }
        if (!stat.isDirectory()) { skip(resolved, "unsupported-file-type"); return []; }
        seen.add(real);
        const files = [];
        for (const child of fs.readdirSync(resolved, { withFileTypes: true })) {
            const full = path.join(resolved, child.name);
            if (options.excludeDirs.has(child.name)) { skip(full, "directory-exclusion"); continue; }
            if (child.isDirectory() || child.isSymbolicLink()) {
                if (shouldTraverseEntry(child, options)) files.push(...listFiles(full, extensions, seen, options));
                else skip(full, "symlink-policy");
            } else if (child.isFile() && extensions.has(path.extname(child.name).toLowerCase()) && !isExcludedFile(full, options)) files.push(full);
            else skip(full, "extension-or-exclusion");
        }
        return files;
    } catch (error) {
        options.diagnostics?.push({ code: error.code || "traversal-error", file: resolved, message: error.message });
        return [];
    }
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
