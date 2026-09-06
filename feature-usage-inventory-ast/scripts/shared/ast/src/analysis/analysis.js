"use strict";
const { buildSourceMap } = require("./evidence.js");
const { createSymbolIndex } = require("./symbol_index.js");
const { createRelations } = require("./relations.js");
const fs = require("fs");
const { parseFile, parseSource, parserOptions, swcVersion } = require("../parsing/parser.js");
const { createIdentity } = require("../cache/identity.js");
const { readEntry, writeEntry } = require("../cache/storage.js");
const path = require("path");
const SCHEMA_VERSION = "1.0.0";
function analyzeParsed(parsed) {
    if (!parsed.ok) {
        return {
            file: parsed.filename,
            parser: parsed.parser,
            status: "не проверено",
            symbols: [],
            relations: [],
            warnings: [],
            errors: parsed.diagnostics,
            elapsedMs: parsed.elapsedMs
        };
    }
    const context = {
        filename: parsed.filename,
        source: parsed.source,
        sourceMap: buildSourceMap(parsed.source)
    };
    const symbolIndex = createSymbolIndex(parsed, context);
    const relations = createRelations(parsed, context, symbolIndex);
    return {
        file: parsed.filename,
        parser: parsed.parser,
        status: "candidate",
        symbols: symbolIndex.symbols,
        relations,
        warnings: [],
        errors: [],
        elapsedMs: parsed.elapsedMs
    };
}
function analyzeFile(filename, options = {}) {
    if (!options.cache) return {
        result: analyzeParsed(parseFile(filename)),
        cache: "disabled"
    };
    const resolved = path.resolve(filename);
    const parser = { name: "@swc/core", version: swcVersion, options: parserOptions(resolved) };
    let content;
    try {
        content = fs.readFileSync(resolved);
    } catch (error) {
        return {
            result: analyzeParsed({ ok: false, filename: resolved, parser, elapsedMs: 0,
                diagnostics: [{ message: error.message, status: "не проверено" }] }),
            cache: "disabled"
        };
    }
    const directory = path.resolve(options.cache);
    const identity = createIdentity(content, resolved, parser);
    const entry = readEntry(directory, identity);
    if (entry.status === "hit") return { result: entry.result, cache: "hit" };

    const parsed = parseSource(content.toString("utf8"), resolved);
    // Analysis exceptions belong to the analyzer, not the optional cache.
    const result = analyzeParsed(parsed);
    if (!parsed.ok) return { result, cache: "disabled" };
    const stored = entry.status === "failed" ? entry : writeEntry(directory, identity, result);
    if (stored.status === "failed") {
        result.warnings.push({ message: `Cache disabled for file: ${stored.error.message}` });
        return { result, cache: "failed" };
    }
    return { result, cache: "miss" };
}
function analyzeFiles(files, options = {}) {
    const uniqueFiles = [
        ...new Set(files.map((file)=>path.resolve(file)))
    ];
    const started = process.hrtime.bigint();
    const results = [];
    const stats = {
        filesMatched: uniqueFiles.length,
        parsed: 0,
        failed: 0,
        skipped: 0,
        cacheHits: 0,
        cacheMisses: 0,
        elapsedMs: 0
    };
    for (const file of uniqueFiles){
        const analyzed = analyzeFile(file, options);
        results.push(analyzed.result);
        if (analyzed.result.errors.length) stats.failed += 1;
        else stats.parsed += 1;
        if (analyzed.cache === "hit") stats.cacheHits += 1;
        if (analyzed.cache === "miss") stats.cacheMisses += 1;
    }
    stats.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    return {
        results,
        stats
    };
}
module.exports = {
    SCHEMA_VERSION,
    analyzeFile,
    analyzeFiles
};
