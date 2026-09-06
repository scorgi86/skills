"use strict";
const fs = require("fs");
const path = require("path");
const REQUIRED_BUNDLE_DOCUMENTS = Object.freeze([
    "decision-report.md",
    "evidence.md",
    "implementation-map.md"
]);
function listMarkdownDocuments(root, current = root, visited = new Set()) {
    const physical = fs.realpathSync(current);
    if (visited.has(physical)) return [];
    visited.add(physical);
    return fs.readdirSync(current, {
        withFileTypes: true
    }).flatMap((entry)=>{
        const absolute = path.join(current, entry.name), stat = fs.statSync(absolute);
        if (stat.isDirectory()) return listMarkdownDocuments(root, absolute, visited);
        return stat.isFile() && entry.name.toLowerCase().endsWith(".md") ? [
            path.relative(root, absolute).replaceAll("\\", "/")
        ] : [];
    }).sort();
}
module.exports = {
    REQUIRED_BUNDLE_DOCUMENTS,
    listMarkdownDocuments
};
