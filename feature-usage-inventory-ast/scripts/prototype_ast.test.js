const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseFile, parseSource } = require("./ast/parser");
const { buildSourceMap, evidenceFor } = require("./ast/evidence");
const { createSymbolIndex } = require("./ast/index");
const { createRelations } = require("./ast/relations");
const { analyzeFiles, buildChains, filesFromList, runQuery } = require("./ast/queries");
const { applyOutputPolicy, byteLength, groupKey } = require("./ast/output");
const { execute, parseArgs } = require("./prototype_ast");

const root = path.resolve(__dirname, "..");
const fixtures = path.join(root, "fixtures", "prototype");
const cli = path.join(__dirname, "prototype_ast.js");

function analyzeFixture(name) {
  const parsed = parseFile(path.join(fixtures, name));
  assert.equal(parsed.ok, true, parsed.diagnostics.map((item) => item.message).join("\n"));
  const context = { filename: parsed.filename, source: parsed.source, sourceMap: buildSourceMap(parsed.source) };
  const index = createSymbolIndex(parsed, context);
  return { parsed, index, relations: createRelations(parsed, context, index) };
}

function hasEdge(relations, owner, field, target) {
  return relations.some((item) => item.ownerQualifiedName === owner && item.field === field && (item.targetQualifiedName === target || (item.candidateTypes || []).includes(target)));
}

test("SWC parses JS, JSX, TS and TSX fixtures", () => {
  for (const name of ["constructors.js", "syntax.jsx", "syntax.ts", "syntax.tsx"]) assert.equal(parseFile(path.join(fixtures, name)).ok, true, name);
});

test("parse failures are isolated and marked unverified", () => {
  const analysis = analyzeFiles([path.join(fixtures, "constructors.js"), path.join(fixtures, "malformed.js")]);
  assert.equal(analysis.stats.parsed, 1);
  assert.equal(analysis.stats.failed, 1);
  assert.equal(analysis.results[1].status, "не проверено");
});

test("byte spans map correctly across Cyrillic and CRLF", () => {
  const source = "// ё\r\nconst value = new Thing();";
  const parsed = parseSource(source, "unicode.js");
  const context = { filename: parsed.filename, source, sourceMap: buildSourceMap(source) };
  const evidence = evidenceFor(parsed.ast.body[0], context, "test", "exact");
  assert.equal(evidence.range.start.line, 2);
  assert.equal(evidence.range.start.column, 1);
  assert.equal(evidence.snippet, "const value = new Thing();");
});

test("prototype methods and qualified owners are indexed", () => {
  const { index } = analyzeFixture("prototype-methods.js");
  const names = index.symbols.map((item) => item.qualifiedName);
  assert.ok(names.includes("Shape.setFill"));
  assert.ok(names.includes("Page.setMainShape"));
});

test("class methods and prototype aliases preserve qualified names", () => {
  const { index, relations } = analyzeFixture("advanced-patterns.js");
  const names = index.symbols.map((item) => item.qualifiedName);
  assert.ok(names.includes("ShapeStore.add"));
  assert.ok(names.includes("Shape.setFill"));
  assert.ok(relations.some((item) => item.relation === "parameter-to-field" && item.field === "fill" && item.targetQualifiedName === "unknown"));
  assert.ok(relations.some((item) => item.relation === "field-to-call-argument" && item.field === "fill"));
  assert.ok(relations.some((item) => item.relation === "call-result-to-field" && item.ownerQualifiedName === "Shape" && item.field === "fill"));
});

test("baseline ownership edges are extracted", () => {
  const files = ["ambiguous-owners.js", "array-ownership.js", "instance-assignments.js", "object-literals-conditionals.js", "setter-calls.js"];
  const relations = files.flatMap((name) => analyzeFixture(name).relations);
  assert.ok(hasEdge(relations, "Shape", "fill", "GradFill"));
  assert.ok(hasEdge(relations, "Page", "shapes[]", "Shape"));
  assert.ok(hasEdge(relations, "Document", "pages[]", "Page"));
  assert.ok(hasEdge(relations, "Theme", "fills[default]", "GradFill"));
  assert.ok(relations.some((item) => item.relation === "setter-argument-to-field" && item.ownerQualifiedName === "Shape" && item.field === "fill" && item.targetQualifiedName === "GradFill"));
});

test("noise strings do not create GradFill ownership", () => {
  const { relations } = analyzeFixture("noise.js");
  assert.equal(relations.some((item) => item.targetQualifiedName === "GradFill" || (item.candidateTypes || []).includes("GradFill")), false);
});

test("chains are bounded and report truncation", () => {
  const files = fs.readdirSync(fixtures).filter((name) => name.endsWith(".js") && name !== "malformed.js").map((name) => path.join(fixtures, name));
  const analysis = analyzeFiles(files);
  const chains = buildChains(analysis.results.flatMap((item) => item.relations), "GradFill", { maxDepth: 10, maxPaths: 2, maxBranches: 2 });
  assert.ok(chains.chains.length <= 2);
  assert.equal(chains.truncated, true);
});

test("cache is opt-in and content-addressed", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "feature-ast-cache-"));
  try {
    const file = path.join(fixtures, "setter-calls.js");
    const first = analyzeFiles([file], { cache });
    const second = analyzeFiles([file], { cache });
    assert.equal(first.stats.cacheMisses, 1);
    assert.equal(second.stats.cacheHits, 1);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test("files-from accepts relative and absolute UTF-8 paths", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "feature-ast-files-"));
  try {
    const local = path.join(directory, "candidate.js");
    fs.writeFileSync(local, "const value = 1;", "utf8");
    const list = path.join(directory, "candidates.txt");
    const absolute = path.join(fixtures, "setter-calls.js");
    fs.writeFileSync(list, `candidate.js\n${absolute}\n`, "utf8");
    assert.deepEqual(filesFromList(list), [local, absolute]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("query filters cover owners, terms, line ranges and constructor callers", () => {
  const advanced = analyzeFiles([path.join(fixtures, "advanced-patterns.js")]);
  const writes = runQuery("writes", advanced, { owner: "Shape", terms: "createFill", maxResults: 20 });
  assert.ok(writes.items.length > 0);
  assert.ok(writes.items.every((item) => item.ownerQualifiedName === "Shape"));

  const callers = runQuery("callers", advanced, { symbol: "GradFill", maxResults: 20 });
  assert.ok(callers.items.some((item) => item.relation === "construct" && item.targetQualifiedName === "GradFill"));

  const normalizedOwners = runQuery("owners", advanced, { type: "GradFill", maxResults: 20 });
  assert.ok(normalizedOwners.items.some((item) => item.targetQualifiedName === "GradFill" && item.matchMode === "exact"));

  const setter = analyzeFiles([path.join(fixtures, "setter-calls.js")]);
  const ranged = runQuery("fields", setter, { owner: "Shape", lineStart: 11, lineEnd: 11, maxResults: 20 });
  assert.ok(ranged.items.length > 0);
  assert.ok(ranged.items.every((item) => item.evidence.some((evidence) => evidence.range.start.line === 11)));
});

test("local identifiers resolve within their function scope", () => {
  const { relations } = analyzeFixture("scope-collisions.js");
  assert.ok(hasEdge(relations, "TypeA", "value", "ValueA"));
  assert.ok(hasEdge(relations, "TypeB", "value", "ValueB"));
  assert.equal(hasEdge(relations, "TypeA", "value", "ValueB"), false);
  assert.equal(hasEdge(relations, "TypeB", "value", "ValueA"), false);
});

test("CLI returns JSON and standardized exit codes", () => {
  const help = execute(parseArgs(["--help"]));
  assert.equal(help.exitCode, 0);
  assert.equal(help.output.command, "help");

  const unknown = execute(parseArgs(["unknown"]));
  assert.equal(unknown.exitCode, 2);
  assert.equal(unknown.output.errors.length, 1);

  const analyzed = execute(parseArgs(["analyze", path.join(fixtures, "setter-calls.js")]));
  const output = analyzed.output;
  assert.equal(analyzed.exitCode, 0);
  assert.equal(output.schemaVersion, "1.0.0");
  assert.ok(Array.isArray(output.data.prototypeMethods));
  assert.ok(Array.isArray(output.data.setterAssignments));
  assert.equal(JSON.stringify(output).split(/\r?\n/).length, 1);
});

test("adaptive output groups high fanout without losing coverage counters", () => {
  const analysis = analyzeFiles([path.join(fixtures, "high-fanout.js")]);
  const query = runQuery("fields", analysis, { owner: "ChartSpace", maxResults: 100 });
  const output = {
    schemaVersion: "1.0.0",
    command: "fields",
    parser: { name: "@swc/core" },
    status: "candidate",
    data: query,
    stats: analysis.stats,
    warnings: [],
    errors: [],
  };
  applyOutputPolicy(output, { outputMode: "summary", maxOutputBytes: 4096, maxGroups: 100, maxSnippetChars: 80 });
  assert.equal(output.coverage.modeApplied, "summary");
  assert.ok(output.coverage.totalItems >= 21);
  assert.equal(output.coverage.uniqueGroups, 2);
  assert.equal(output.data.items.length, 0);
  assert.equal(output.data.groups.length, 2);
  assert.ok(output.coverage.evidenceSuppressed > 0);
  assert.ok(byteLength(output) <= 4096);
});

test("group keys support exact detail follow-up including a rare final group", () => {
  const analysis = analyzeFiles([path.join(fixtures, "high-fanout.js")]);
  const all = runQuery("fields", analysis, { owner: "ChartSpace", maxResults: 100 });
  const rare = all.items.find((item) => item.field === "glow");
  assert.ok(rare);
  const details = runQuery("fields", analysis, { owner: "ChartSpace", detailsFor: groupKey(rare), maxResults: 100 });
  assert.equal(details.total, 1);
  assert.equal(details.items[0].field, "glow");
});

test("group pagination exposes every semantic group", () => {
  const analysis = analyzeFiles([path.join(fixtures, "high-fanout.js")]);
  const query = runQuery("fields", analysis, { owner: "ChartSpace", maxResults: 100 });
  const first = { schemaVersion: "1.0.0", command: "fields", data: query, stats: analysis.stats, warnings: [], errors: [] };
  applyOutputPolicy(first, { outputMode: "summary", maxOutputBytes: 4096, maxGroups: 1, groupOffset: 0 });
  assert.equal(first.coverage.groupsReturned, 1);
  assert.equal(first.coverage.nextGroupOffset, 1);

  const secondQuery = runQuery("fields", analysis, { owner: "ChartSpace", maxResults: 100 });
  const second = { schemaVersion: "1.0.0", command: "fields", data: secondQuery, stats: analysis.stats, warnings: [], errors: [] };
  applyOutputPolicy(second, { outputMode: "summary", maxOutputBytes: 4096, maxGroups: 1, groupOffset: 1 });
  assert.equal(second.data.groups[0].field, "glow");
  assert.equal(second.coverage.nextGroupOffset, null);
});
