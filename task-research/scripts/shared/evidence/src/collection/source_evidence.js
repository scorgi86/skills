"use strict";
const { listFiles } = require("./source_files.js");
const { runSourceCheck } = require("./source_checks.js");
function runEvidenceChecks(request, dependencies = {}) {
    if (!request || !Array.isArray(request.checks)) throw new Error("Evidence request requires checks array");
    const contentCache = new Map();
    const traversalCache = new Map();
    const enumerateFiles = dependencies.listFiles || listFiles;
    return {
        schemaVersion: "1.1.0",
        checks: request.checks.map((check, index)=>runSourceCheck(check, index, request, contentCache, traversalCache, enumerateFiles))
    };
}
function parseArgs(argv) {
    const requestIndex = argv.indexOf("--request");
    const outputIndex = argv.indexOf("--output");
    if (requestIndex < 0 || !argv[requestIndex + 1]) throw new Error("Provide --request <json-file>");
    return {
        request: argv[requestIndex + 1],
        output: outputIndex >= 0 ? argv[outputIndex + 1] : null
    };
}
module.exports = {
    parseArgs,
    runEvidenceChecks
};
