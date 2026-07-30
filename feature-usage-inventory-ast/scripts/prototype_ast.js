#!/usr/bin/env node

const path = require("path");
const { swcVersion } = require("./ast/parser");
const { SCHEMA_VERSION, analyzeFiles, filesFromList, legacyView, listSourceFiles, runQuery } = require("./ast/queries");
const { applyOutputPolicy, DEFAULT_OUTPUT_BUDGET } = require("./ast/output");

const COMMANDS = new Set(["index", "analyze", "find", "symbols", "fields", "methods", "reads", "writes", "assignments", "calls", "callers", "callees", "owners", "recipients", "collections", "chain", "summary", "stats", "doctor"]);
const VALUE_OPTIONS = new Set(["file", "scope", "files-from", "type", "owner", "field", "terms", "kind", "symbol", "line-start", "line-end", "max-depth", "max-paths", "max-branches", "max-results", "max-lines", "min-confidence", "cache", "format", "value-type", "output-mode", "max-output-bytes", "max-evidence-per-item", "max-snippet-chars", "max-groups", "group-offset", "details-for", "group-owner", "group-field", "group-relation", "group-target"]);

function help() {
  return {
    usage: "node scripts/prototype_ast.js <command> [target] [options]",
    commands: [...COMMANDS],
    options: [...VALUE_OPTIONS].map((name) => `--${name}`).concat(["--allow-wide-scope", "--help"]),
    examples: [
      "analyze --file example.js",
      "owners --type GradFill --files-from candidates.txt",
      "fields --owner Shape --field fill --scope fixtures/prototype",
      "chain --type GradFill --scope fixtures/prototype --max-depth 10 --max-paths 25",
      "find --terms CSpPr,spPr --file ChartSpace.js --output-mode summary",
      "find --terms CSpPr,spPr --file ChartSpace.js --details-for g-0123456789ab --output-mode detail",
      "find --terms CSpPr,spPr --file ChartSpace.js --group-owner CChartSpace --group-field spPr --output-mode summary",
    ],
  };
}

function parseArgs(argv) {
  const options = { command: "", positional: [], format: "json", maxDepth: 10, maxPaths: 25, maxBranches: 20, maxResults: 100, allowWideScope: false, outputMode: "auto", maxOutputBytes: DEFAULT_OUTPUT_BUDGET, maxEvidencePerItem: 3, maxSnippetChars: 160, maxGroups: 100, groupOffset: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--allow-wide-scope") options.allowWideScope = true;
    else if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (!VALUE_OPTIONS.has(name)) throw new Error(`Unknown option: ${arg}`);
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}`);
      const value = argv[++i];
      const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = value;
    } else if (!options.command) options.command = arg;
    else options.positional.push(arg);
  }
  if (options.maxLines) options.maxResults = options.maxLines;
  if (options.valueType && !options.type) options.type = options.valueType;
  options.maxDepth = Math.max(1, Number(options.maxDepth) || 10);
  options.maxPaths = Math.max(1, Number(options.maxPaths) || 25);
  options.maxBranches = Math.max(1, Number(options.maxBranches) || 20);
  options.maxResults = Math.max(1, Number(options.maxResults) || 100);
  options.maxOutputBytes = Math.max(2048, Number(options.maxOutputBytes) || DEFAULT_OUTPUT_BUDGET);
  options.maxEvidencePerItem = Number.isFinite(Number(options.maxEvidencePerItem)) ? Math.max(0, Number(options.maxEvidencePerItem)) : 3;
  options.maxSnippetChars = Number.isFinite(Number(options.maxSnippetChars)) ? Math.max(0, Number(options.maxSnippetChars)) : 160;
  options.maxGroups = Math.max(1, Number(options.maxGroups) || 100);
  options.groupOffset = Math.max(0, Number(options.groupOffset) || 0);
  if (!["auto", "summary", "detail"].includes(options.outputMode)) throw new Error(`Unsupported output mode: ${options.outputMode}`);
  if (options.lineStart) options.lineStart = Math.max(1, Number(options.lineStart) || 1);
  if (options.lineEnd) options.lineEnd = Math.max(options.lineStart || 1, Number(options.lineEnd) || options.lineStart || 1);
  return options;
}

function selectFiles(options) {
  if (options.file) return [path.resolve(options.file)];
  if (options.command === "analyze" && options.positional[0]) return [path.resolve(options.positional[0])];
  if (options.filesFrom) return filesFromList(options.filesFrom);
  if (!options.scope) throw new Error("Provide --file, --files-from, or explicit --scope");
  const files = listSourceFiles(options.scope);
  if (files.length > 200 && !options.allowWideScope) throw new Error(`Wide AST scope blocked: ${files.length} files. Use a candidate list or --allow-wide-scope after recording the reason.`);
  return files;
}

function envelope(command, analysis, data, warnings = [], errors = []) {
  return {
    schemaVersion: SCHEMA_VERSION,
    command,
    parser: { name: "@swc/core", version: swcVersion },
    status: errors.length ? "не проверено" : data && data.total === 0 ? "not-found" : "candidate",
    data,
    stats: analysis ? analysis.stats : { parsed: 0, failed: 0, skipped: 0, elapsedMs: 0 },
    warnings,
    errors,
  };
}

function doctor() {
  return envelope("doctor", null, {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    swc: swcVersion,
    binding: "ok",
    localRuntime: path.resolve(__dirname, "..", "node_modules"),
  });
}

function execute(options) {
  if (options.help || !options.command) return { output: envelope("help", null, help()), exitCode: 0 };
  if (!COMMANDS.has(options.command)) return { output: envelope(options.command, null, null, [], [{ message: `Unknown command: ${options.command}` }]), exitCode: 2 };
  if (options.format !== "json" && options.format !== "pretty") return { output: envelope(options.command, null, null, [], [{ message: `Unsupported format: ${options.format}` }]), exitCode: 2 };
  if (options.command === "doctor") return { output: doctor(), exitCode: 0 };

  let files;
  try { files = selectFiles(options); } catch (error) { return { output: envelope(options.command, null, null, [], [{ message: error.message }]), exitCode: 2 }; }
  if (!files.length) return { output: envelope(options.command, { stats: { filesMatched: 0, parsed: 0, failed: 0, skipped: 0, elapsedMs: 0 } }, { items: [], returned: 0, total: 0, truncated: false }), exitCode: 0 };

  const analysis = analyzeFiles(files, { cache: options.cache });
  const fileErrors = analysis.results.flatMap((result) => result.errors.map((error) => ({ ...error, file: result.file })));
  if (options.command === "analyze") {
    if (analysis.results.length !== 1) return { output: envelope("analyze", analysis, null, [], [{ message: "analyze requires exactly one candidate file" }]), exitCode: 2 };
    const result = analysis.results[0];
    const legacy = legacyView(result);
    const data = { ...result, ...legacy };
    return { output: envelope("analyze", analysis, data, result.warnings, fileErrors), exitCode: fileErrors.length ? 1 : 0 };
  }

  const query = runQuery(options.command, analysis, options);
  let data = query;
  if (options.command === "owners") data = { owners: query.items || [], returned: query.returned, total: query.total, truncated: query.truncated };
  if (options.command === "recipients") data = { recipients: query.items || [], returned: query.returned, total: query.total, truncated: query.truncated };
  if (query && query._allItems && data !== query) Object.defineProperty(data, "_allItems", { value: query._allItems, enumerable: false });
  if (options.command === "chain") data = { ...query, chains: query.chains || [] };
  const output = envelope(options.command, analysis, data, [], fileErrors);
  if (options.command === "owners" || options.command === "recipients") output.status = data.total > 1 ? "ambiguous" : data.total === 1 ? "candidate" : "not-found";
  if (options.command === "chain") output.status = data.truncated ? "truncated" : data.returned ? "candidate" : "not-found";
  return { output, exitCode: fileErrors.length ? 1 : 0 };
}

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) {
    process.stdout.write(`${JSON.stringify(envelope("arguments", null, null, [], [{ message: error.message }]))}\n`);
    process.exitCode = 2;
    return;
  }
  const { output, exitCode } = execute(options);
  applyOutputPolicy(output, options);
  const spacing = options.format === "pretty" ? 2 : 0;
  process.stdout.write(`${JSON.stringify(output, null, spacing)}\n`);
  process.exitCode = exitCode;
}

if (require.main === module) main();

module.exports = { COMMANDS, execute, help, parseArgs, selectFiles };
