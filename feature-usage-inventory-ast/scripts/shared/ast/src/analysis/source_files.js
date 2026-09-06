"use strict";
const path = require("path");
const fs = require("fs");
const SOURCE_EXTENSIONS = new Set([
    ".js",
    ".jsx",
    ".ts",
    ".tsx"
]);
function listSourceFiles(scope, seen = new Set()) {
    const resolved = path.resolve(scope);
    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch  {
        return [];
    }
    const real = fs.realpathSync(resolved);
    if (seen.has(real)) return [];
    if (stat.isFile()) return SOURCE_EXTENSIONS.has(path.extname(resolved).toLowerCase()) ? [
        resolved
    ] : [];
    if (!stat.isDirectory()) return [];
    seen.add(real);
    const files = [];
    for (const entry of fs.readdirSync(resolved, {
        withFileTypes: true
    })){
        const full = path.join(resolved, entry.name);
        if (entry.isDirectory() || entry.isSymbolicLink()) files.push(...listSourceFiles(full, seen));
        else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
    return files;
}
function filesFromList(listFile, baseDirectory) {
    const resolvedList = path.resolve(listFile);
    const base = baseDirectory ? path.resolve(baseDirectory) : path.dirname(resolvedList);
    return fs.readFileSync(resolvedList, "utf8").split(/\r?\n/).map((line)=>line.trim()).filter((line)=>line && !line.startsWith("#")).map((line)=>path.resolve(base, line));
}
module.exports = {
    filesFromList,
    listSourceFiles
};
