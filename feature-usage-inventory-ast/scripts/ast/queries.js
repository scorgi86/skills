const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseFile, swcVersion } = require("./parser");
const { buildSourceMap } = require("./evidence");
const { createSymbolIndex } = require("./index");
const { createRelations } = require("./relations");
const { shortName } = require("./helpers");
const { groupKey } = require("./output");

const SCHEMA_VERSION = "1.0.0";
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "out", "coverage"]);

function sameName(actual, expected) {
  if (!actual || !expected) return false;
  if (actual === expected || shortName(actual) === shortName(expected)) return true;
  const normalizeLegacy = (value) => {
    const short = shortName(value);
    return /^C[A-Z]/.test(short) ? short.slice(1) : short;
  };
  return normalizeLegacy(actual) === normalizeLegacy(expected);
}

function analyzeParsed(parsed) {
  if (!parsed.ok) {
    return { file: parsed.filename, parser: parsed.parser, status: "не проверено", symbols: [], relations: [], warnings: [], errors: parsed.diagnostics, elapsedMs: parsed.elapsedMs };
  }
  const context = { filename: parsed.filename, source: parsed.source, sourceMap: buildSourceMap(parsed.source) };
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
    elapsedMs: parsed.elapsedMs,
  };
}

function cacheKey(filename, parserOptions) {
  const content = fs.readFileSync(filename);
  return crypto.createHash("sha256").update(SCHEMA_VERSION).update(swcVersion).update(JSON.stringify(parserOptions)).update(path.resolve(filename)).update(content).digest("hex");
}

function analyzeFile(filename, options = {}) {
  const parsed = parseFile(filename);
  if (!options.cache || !parsed.ok) return { result: analyzeParsed(parsed), cache: "disabled" };
  const directory = path.resolve(options.cache);
  const key = cacheKey(parsed.filename, parsed.parser.options);
  const cacheFile = path.join(directory, `${key}.json`);
  try {
    if (fs.existsSync(cacheFile)) return { result: JSON.parse(fs.readFileSync(cacheFile, "utf8")), cache: "hit" };
    const result = analyzeParsed(parsed);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(result));
    return { result, cache: "miss" };
  } catch (error) {
    const result = analyzeParsed(parsed);
    result.warnings.push({ message: `Cache disabled for file: ${error.message}` });
    return { result, cache: "failed" };
  }
}

function listSourceFiles(scope, seen = new Set()) {
  const resolved = path.resolve(scope);
  let stat;
  try { stat = fs.statSync(resolved); } catch { return []; }
  const real = fs.realpathSync(resolved);
  if (seen.has(real)) return [];
  if (stat.isFile()) return SOURCE_EXTENSIONS.has(path.extname(resolved).toLowerCase()) ? [resolved] : [];
  if (!stat.isDirectory()) return [];
  seen.add(real);
  const files = [];
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(resolved, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) files.push(...listSourceFiles(full, seen));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

function filesFromList(listFile, baseDirectory) {
  const resolvedList = path.resolve(listFile);
  const base = baseDirectory ? path.resolve(baseDirectory) : path.dirname(resolvedList);
  return fs.readFileSync(resolvedList, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => path.resolve(base, line));
}

function analyzeFiles(files, options = {}) {
  const uniqueFiles = [...new Set(files.map((file) => path.resolve(file)))];
  const started = process.hrtime.bigint();
  const results = [];
  const stats = { filesMatched: uniqueFiles.length, parsed: 0, failed: 0, skipped: 0, cacheHits: 0, cacheMisses: 0, elapsedMs: 0 };
  for (const file of uniqueFiles) {
    const analyzed = analyzeFile(file, options);
    results.push(analyzed.result);
    if (analyzed.result.errors.length) stats.failed += 1;
    else stats.parsed += 1;
    if (analyzed.cache === "hit") stats.cacheHits += 1;
    if (analyzed.cache === "miss") stats.cacheMisses += 1;
  }
  stats.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { results, stats };
}

function allSymbols(analysis) { return analysis.results.flatMap((result) => result.symbols); }
function allRelations(analysis) { return analysis.results.flatMap((result) => result.relations); }

function bounded(items, maxResults = 100) {
  const limit = Math.max(1, Number(maxResults) || 100);
  const result = { items: items.slice(0, limit), returned: Math.min(items.length, limit), total: items.length, truncated: items.length > limit };
  Object.defineProperty(result, "_allItems", { value: items, enumerable: false });
  return result;
}

function buildChains(relations, typeName, options = {}) {
  const maxDepth = Math.max(1, Number(options.maxDepth) || 10);
  const maxPaths = Math.max(1, Number(options.maxPaths) || 25);
  const maxBranches = Math.max(1, Number(options.maxBranches) || 20);
  const edges = relations.filter((relation) => relation.ownerQualifiedName !== "unknown" && relation.targetQualifiedName !== "unknown" && relation.relation !== "call" && relation.relation !== "field-read");
  const chains = [];
  let truncated = false;

  function walkType(current, chain, visited, depth) {
    if (chains.length >= maxPaths) { truncated = true; return; }
    if (depth >= maxDepth) { chains.push({ status: "max-depth", chain }); return; }
    const next = edges.filter((edge) => sameName(edge.targetQualifiedName, current));
    if (!next.length) { chains.push({ status: chain.length > 1 ? "leaf" : "not-found", chain }); return; }
    if (next.length > maxBranches) truncated = true;
    for (const edge of next.slice(0, maxBranches)) {
      const key = `${edge.ownerQualifiedName}|${edge.field}|${edge.targetQualifiedName}`;
      const step = { level: depth + 1, owner: edge.ownerQualifiedName, field: edge.field, type: edge.targetQualifiedName, relation: edge.relation, evidence: edge.evidence, status: "не проверено" };
      if (visited.has(key)) { chains.push({ status: "cycle", chain: [...chain, step] }); continue; }
      walkType(edge.ownerQualifiedName, [...chain, step], new Set([...visited, key]), depth + 1);
    }
  }

  walkType(typeName, [{ level: 0, type: typeName, role: "target" }], new Set(), 0);
  return { chains, returned: chains.length, truncated, limits: { maxDepth, maxPaths, maxBranches } };
}

function runQuery(command, analysis, options = {}) {
  const symbols = allSymbols(analysis);
  const relations = allRelations(analysis);
  let selected;
  if (command === "symbols" || command === "index") selected = symbols.filter((item) => !options.kind || item.kind === options.kind);
  else if (command === "fields") selected = relations.filter((item) => item.field && (!options.owner || sameName(item.ownerQualifiedName, options.owner)) && (!options.field || item.field === options.field));
  else if (command === "methods") selected = symbols.filter((item) => item.kind.includes("method") && (!options.owner || sameName(item.owner, options.owner)));
  else if (command === "reads") selected = relations.filter((item) => item.relation === "field-read" && (!options.field || item.field === options.field));
  else if (command === "writes" || command === "assignments") selected = relations.filter((item) => item.relation.includes("write") || item.relation.includes("to-field") || item.relation === "object-field");
  else if (command === "calls") selected = relations.filter((item) => ["call", "construct"].includes(item.relation) && (!options.symbol || sameName(item.sourceSymbol, options.symbol) || String(item.sourceSymbol || "").startsWith(`${options.symbol}.`) || sameName(item.targetQualifiedName, options.symbol)));
  else if (command === "callers") selected = relations.filter((item) => ["call", "construct"].includes(item.relation) && sameName(item.targetQualifiedName, options.symbol));
  else if (command === "callees") selected = relations.filter((item) => ["call", "construct"].includes(item.relation) && (sameName(item.sourceSymbol, options.symbol) || String(item.sourceSymbol || "").startsWith(`${options.symbol}.`)));
  else if (command === "owners" || command === "recipients") {
    selected = relations.filter((item) => !["call", "construct", "field-read", "import", "export"].includes(item.relation) && (sameName(item.targetQualifiedName, options.type) || (item.candidateTypes || []).some((name) => sameName(name, options.type))));
    if (command === "owners") {
      selected.push(...symbols.filter((item) => item.kind === "variable" && (sameName(item.inferredType, options.type) || sameName(item.candidateType, options.type))).map((item) => ({ ownerQualifiedName: item.scope || "<module>", relation: "local-instance", field: item.name, targetQualifiedName: item.inferredType !== "unknown" ? item.inferredType : item.candidateType, sourceSymbol: item.scope || "<module>", evidence: item.evidence })));
    }
    selected = selected.map((item) => {
      const actual = item.targetQualifiedName || (item.candidateTypes || [])[0] || "";
      const exact = actual === options.type || shortName(actual) === shortName(options.type);
      return { ...item, matchMode: exact ? "exact" : "legacy-c-prefix" };
    });
  }
  else if (command === "collections") selected = relations.filter((item) => item.relation.startsWith("collection-"));
  else if (command === "chain") return buildChains(relations, options.type, options);
  else if (command === "find" || command === "summary") {
    const terms = String(options.terms || options.type || "").split(",").map((term) => term.trim().toLowerCase()).filter(Boolean);
    selected = [...symbols, ...relations].filter((item) => terms.some((term) => JSON.stringify(item).toLowerCase().includes(term)));
  } else if (command === "stats") return analysis.stats;
  else selected = relations;
  if (options.owner) selected = selected.filter((item) => sameName(item.ownerQualifiedName || item.owner, options.owner));
  if (options.field) selected = selected.filter((item) => item.field === options.field);
  if (options.kind && command !== "symbols" && command !== "index") selected = selected.filter((item) => item.relation === options.kind);
  if (options.terms && command !== "find" && command !== "summary") {
    const terms = String(options.terms).split(",").map((term) => term.trim().toLowerCase()).filter(Boolean);
    selected = selected.filter((item) => terms.some((term) => JSON.stringify(item).toLowerCase().includes(term)));
  }
  if (options.lineStart || options.lineEnd) {
    const start = options.lineStart || 1;
    const end = options.lineEnd || Number.MAX_SAFE_INTEGER;
    selected = selected.filter((item) => (item.evidence || []).some((evidence) => {
      const line = evidence.range && evidence.range.start && evidence.range.start.line;
      return Number.isFinite(line) && line >= start && line <= end;
    }));
  }
  if (options.minConfidence) {
    const rank = { candidate: 1, "name-inferred": 1, resolved: 2, exact: 3 };
    const minimum = rank[options.minConfidence] || 1;
    selected = selected.filter((item) => Math.max(...(item.evidence || []).map((evidence) => rank[evidence.confidence] || 1), 1) >= minimum);
  }
  if (options.detailsFor) selected = selected.filter((item) => groupKey(item) === options.detailsFor);
  return bounded(selected, options.maxResults);
}

function legacyView(result) {
  const symbols = result.symbols || [];
  const relations = result.relations || [];
  const fields = relations.filter((item) => item.field && item.relation !== "field-read");
  return {
    constructors: symbols.filter((item) => item.method === "constructor"),
    fields,
    prototypeMethods: symbols.filter((item) => item.kind.includes("method")),
    variables: symbols.filter((item) => item.kind === "variable"),
    aliases: symbols.filter((item) => item.kind === "alias"),
    instanceAssignments: fields.filter((item) => item.relation.includes("write")),
    setterAssignments: fields.filter((item) => item.relation.includes("to-field")),
    arrayOwnership: fields.filter((item) => item.relation === "collection-push"),
    indexedAssignments: fields.filter((item) => item.relation === "computed-write"),
    owners: fields.filter((item) => item.targetQualifiedName !== "unknown"),
    chains: [],
  };
}

module.exports = { SCHEMA_VERSION, analyzeFile, analyzeFiles, buildChains, filesFromList, legacyView, listSourceFiles, runQuery, sameName };
