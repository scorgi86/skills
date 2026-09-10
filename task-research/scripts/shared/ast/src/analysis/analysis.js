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
function withIdentity(value, identityKey) {
    if (identityKey) Object.defineProperty(value, "identityKey", { value: identityKey, enumerable: false });
    return value;
}
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
    if (entry.status === "hit") return withIdentity({ result: entry.result, cache: "hit" }, identity.key);

    const parsed = parseSource(content.toString("utf8"), resolved);
    // Analysis exceptions belong to the analyzer, not the optional cache.
    const result = analyzeParsed(parsed);
    if (!parsed.ok) return withIdentity({ result, cache: "disabled" }, identity.key);
    const stored = entry.status === "failed" ? entry : writeEntry(directory, identity, result);
    if (stored.status === "failed") {
        result.warnings.push({ message: `Cache disabled for file: ${stored.error.message}` });
        return withIdentity({ result, cache: "failed" }, identity.key);
    }
    return withIdentity({ result, cache: "miss" }, identity.key);
}
async function analyzeFiles(files, options = {}, dependencies = {}) {
    const uniqueFiles = [
        ...new Set(files.map((file)=>path.resolve(file)))
    ];
    const started = process.hrtime.bigint();
    const concurrency = require("./parallel_analysis.js").normalizeConcurrency(options.concurrency, uniqueFiles.length);
    const analyzedFiles = concurrency === 1
        ? uniqueFiles.map(file => analyzeFile(file, options))
        : await require("./parallel_analysis.js").analyzeInWorkers(uniqueFiles, { ...options, concurrency }, dependencies);
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
    for (const analyzed of analyzedFiles){
        results.push(analyzed.result);
        if (analyzed.result.errors.length) stats.failed += 1;
        else stats.parsed += 1;
        if (analyzed.cache === "hit") stats.cacheHits += 1;
        if (analyzed.cache === "miss") stats.cacheMisses += 1;
    }
    stats.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const output = {
        results,
        stats
    };
    Object.defineProperty(output, "identities", {
        value: new Map(analyzedFiles.filter(item => item.identityKey).map(item => [path.resolve(item.result.file), item.identityKey])),
        enumerable: false
    });
    return output;
}
module.exports = {
    SCHEMA_VERSION,
    analyzeFile,
    analyzeFiles
};
