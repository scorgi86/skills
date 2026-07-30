const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { analyzeFiles } = require("./ast/queries");
const { compileQueryPlan, runAstBatch } = require("./ast/batch");
const { projectAst, relevanceScore } = require("./fact_projection");
const { extractTransition } = require("./extract_stage_transition");
const { measureContext } = require("./measure_context");
const { buildReportModel, renderStage2Report } = require("./render_stage2_report");
const { runEvidenceChecks } = require("./source_evidence");
const { buildSourceSlices } = require("./source_slice");
const { runStage2 } = require("./stage2_runner");
const { buildStageSummary, normalizeBudgets, sourceProjection } = require("./stage_facts");
const { compactSummaryAnchors, resolveCompactAnchor } = require("./summary_compaction");
const { decodeHumanFields, encodeHumanFields, findInternalReportIdentifiers } = require("./human_report_codec");
const { compareStageRepresentations } = require("./quality_equivalence");
const { evaluateStage2Coverage } = require("./coverage_gate");
const { compareStageRuns } = require("./compare_stage_runs");

const fixture = path.resolve(__dirname, "../fixtures/prototype/high-fanout.js");

test("AST batch parses each unique file once for multiple queries", () => {
  let calls = 0;
  const output = runAstBatch({ queries: [
    { id: "symbols", command: "symbols", file: fixture },
    { id: "find", command: "find", file: fixture, options: { terms: "shadow" } },
  ] }, { analyzeFiles(files, options) { calls += 1; return analyzeFiles(files, options); } });
  assert.equal(calls, 1);
  assert.equal(output.stats.uniqueFiles, 1);
  assert.equal(output.stats.parseCounts[fixture], 1);
});

test("compiled AST query plan is stable and complete before parse", () => {
  const request = { queries: [
    { id: "symbols", command: "symbols", file: fixture },
    { id: "find", command: "find", file: fixture, options: { terms: "shadow" } },
  ] };
  const first = compileQueryPlan(request);
  const second = compileQueryPlan(request);
  assert.equal(first.id, second.id);
  assert.equal(first.compiledBeforeParse, true);
  assert.equal(first.uniqueFiles.length, 1);
  assert.deepEqual(first.queryIds, ["symbols", "find"]);
  assert.ok(first.projections.includes("first-anchor-per-group"));
});

test("semantic group filters retain full scan coverage", () => {
  const output = runAstBatch({ queries: [{ id: "filtered", command: "find", file: fixture, options: { terms: "shadow" }, groupFilters: { owner: "*" } }] });
  const coverage = output.results[0].coverage;
  assert.ok(coverage.groupsScanned >= coverage.groupsMatched);
  assert.ok(coverage.groupsMatched > 0);
});

test("selected details report suppression explicitly", () => {
  const output = runAstBatch({ maxEvidencePerItem: 100, queries: [{ id: "details", command: "find", file: fixture, options: { terms: "shadow" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 500 }] });
  assert.equal(output.results[0].coverage.detailsRequested, output.results[0].coverage.detailsReturned);
  assert.equal(output.results[0].coverage.detailsSuppressed, 0);
  assert.equal(output.results[0].coverage.detailEvidenceSuppressed, 0);
});

test("safe budget preflight preserves the same result set without reparsing", () => {
  const request = { queries: [{ id: "details", command: "find", file: fixture, options: { terms: "shadow" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 500 }] };
  const low = runAstBatch({ ...request, maxOutputBytes: 4096 });
  const high = runAstBatch({ ...request, maxOutputBytes: 1024 * 1024 });
  assert.deepEqual(low.results, high.results);
  assert.equal(low.stats.parseCounts[fixture], 1);
  assert.equal(low.output.autoRaised, true);
  assert.ok(low.output.budgetApplied >= low.output.budgetRequired);
  assert.equal(low.results[0].coverage.detailsSuppressed, 0);
  assert.equal(low.results[0].coverage.detailEvidenceSuppressed, 0);
});

test("context measurement returns only sanitized counters", () => {
  const secret = "do-not-echo-this-source";
  const output = measureContext({ inputs: [{ id: "source", category: "source", value: secret }, { id: "hidden", bytes: 800, modelVisible: false }] });
  assert.equal(output.inputs[0].bytes, Buffer.byteLength(secret));
  assert.equal(output.totals.modelVisibleBytes, output.inputs[0].bytes);
  assert.equal(JSON.stringify(output).includes(secret), false);
});

test("bounded source evidence reports total and truncation", () => {
  const output = runEvidenceChecks({ checks: [{ id: "many", file: fixture, pattern: "shadow", maxMatches: 2 }] });
  assert.ok(output.checks[0].totalMatches > 2);
  assert.equal(output.checks[0].returned, 2);
  assert.equal(output.checks[0].truncated, true);
});

test("source evidence reads a repeated file once per run", () => {
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (...args) {
    if (path.resolve(args[0]) === fixture) reads += 1;
    return original.apply(this, args);
  };
  try {
    const output = runEvidenceChecks({ checks: [
      { id: "first", file: fixture, pattern: "shadow" },
      { id: "second", file: fixture, pattern: "RareGlow" },
    ] });
    assert.equal(output.checks.length, 2);
    assert.equal(reads, 1);
  } finally {
    fs.readFileSync = original;
  }
});

test("source evidence line cache preserves grouped results for repeated files", () => {
  const shared = runEvidenceChecks({ checks: [
    { id: "first", file: fixture, pattern: "shadow", maxMatches: 8 },
    { id: "second", file: fixture, pattern: "Shadow", maxMatches: 8 },
  ] });
  const separateFirst = runEvidenceChecks({ checks: [{ id: "first", file: fixture, pattern: "shadow", maxMatches: 8 }] });
  const separateSecond = runEvidenceChecks({ checks: [{ id: "second", file: fixture, pattern: "Shadow", maxMatches: 8 }] });
  assert.deepEqual(shared.checks[0], separateFirst.checks[0]);
  assert.deepEqual(shared.checks[1], separateSecond.checks[0]);
});

test("retained source evidence preserves every match beyond report cap", () => {
  const output = runEvidenceChecks({ retainAllMatches: true, checks: [{ id: "all", file: fixture, pattern: "shadow", maxMatches: 1 }] });
  const check = output.checks[0];
  assert.equal(check.returned, 1);
  assert.ok(check.fullMatches.length > check.returned);
  assert.equal(check.fullMatches.length, check.totalMatches);
});

test("grouped source evidence keeps semantic diversity under a small match cap", () => {
  const output = runEvidenceChecks({ checks: [{
    id: "diverse",
    file: fixture,
    patterns: [{ id: "common", value: "shadow" }, { id: "rare", value: "RareGlow" }],
    groupBy: "pattern",
    maxMatches: 2,
  }] });
  const check = output.checks[0];
  assert.equal(check.groupsTotal, 2);
  assert.equal(check.matches.length, 2);
  assert.equal(new Set(check.matches.map((match) => match.groupKey)).size, 2);
  assert.ok(check.groups.every((group) => group.firstAnchor && group.firstAnchor.file));
  assert.equal(typeof check.groupDigest, "string");
});

test("overlapping evidence patterns do not inflate legacy returned counters", () => {
  const output = runEvidenceChecks({ checks: [{ file: fixture, patterns: ["shadow", "CShadow"], maxMatches: 100 }] });
  const check = output.checks[0];
  assert.ok(check.returned <= check.totalMatches);
  assert.equal(new Set(check.matches.map((match) => `${match.file}:${match.line}`)).size, check.matches.length);
});

test("AST semantic projection covers every group by digest and emits first anchors", () => {
  const ast = runAstBatch({ maxGroups: 1, queries: [{ id: "owners", command: "find", file: fixture, options: { terms: "shadow,glow" }, groupFilters: { owner: "*" } }] });
  const projection = projectAst(ast, { maxGroupsPerQuery: 3 });
  const query = projection.queries[0];
  assert.equal(query.groupsAvailable, ast.results[0].coverage.groupsMatched);
  assert.equal(query.groupDigest, ast.results[0].groupDigest);
  assert.ok(query.groups.every((group) => group.firstAnchor));
  assert.ok(query.groups.every((group) => Object.hasOwn(group, "owner") && Object.hasOwn(group, "relation") && Object.hasOwn(group, "field")));
});

test("required semantic selector can retain a rare tail group", () => {
  const groups = Array.from({ length: 20 }, (_, index) => ({ key: `g-${index}`, owner: "ChartSpace", relation: "method", field: `common-${index}`, target: "CShadow", items: 1, evidence: 1, example: { file: fixture, line: index + 1 } }));
  groups.push({ key: "g-rare", owner: "RareOwner", relation: "field-write", field: "glow", target: "CShadow", items: 1, evidence: 1, example: { file: fixture, line: 99 } });
  const projection = projectAst({ status: "candidate", stats: {}, results: [{ id: "tail", command: "find", status: "candidate", coverage: {}, semanticGroups: groups }] }, { maxGroupsPerQuery: 2, requiredGroups: { tail: [{ key: "g-rare" }] } });
  assert.ok(projection.queries[0].groups.some((group) => group.key === "g-rare"));
  assert.equal(projection.queries[0].groupsTruncated, true);
});

test("target-aware projection ranks preferred feature groups before broad noise", () => {
  const groups = [
    { key: "g-noise", owner: "<module>", relation: "call", field: "InitClass", target: "InitClass", items: 1, evidence: 100, example: { file: fixture, line: 1 } },
    { key: "g-neighbor", owner: "CEffectLst", relation: "field-read", field: "blur", target: "unknown", items: 1, evidence: 1, example: { file: fixture, line: 2 } },
    { key: "g-target", owner: "CEffectLst", relation: "field-write", field: "innerShdw", target: "CInnerShdw", items: 1, evidence: 1, example: { file: fixture, line: 3 } },
  ];
  const projection = projectAst({ status: "candidate", stats: {}, results: [{ id: "shadow", command: "find", status: "candidate", coverage: {}, projectionHints: { preferredTerms: "innerShdw,CInnerShdw" }, semanticGroups: groups }] }, { maxGroupsPerQuery: 1 });
  assert.equal(projection.queries[0].groups[0].key, "g-target");
  assert.equal(projection.queries[0].ranking.mode, "target-aware");
  assert.ok(relevanceScore(groups[2], ["innerShdw"]) > relevanceScore(groups[0], ["innerShdw"]));
});

test("source projection cap preserves full digest and totals with explicit truncation", () => {
  const groups = Array.from({ length: 5 }, (_, index) => ({ key: `se-${index}`, label: `group-${index}`, totalMatches: index + 1, returned: 1, truncated: index > 0, firstAnchor: { file: fixture, line: index + 1 } }));
  const source = { checks: [{ id: "source", status: "candidate", filesScanned: 1, totalMatches: 15, returned: 5, truncated: true, groupDigest: "full-digest", groupsTotal: 5, groupsReturned: 5, groupsTruncated: false, groups }] };
  const projected = sourceProjection(source, { maxGroupsPerCheck: 2, requiredGroupKeys: { source: ["se-4"] } })[0];
  assert.equal(projected.groupDigest, "full-digest");
  assert.equal(projected.groupsTotal, 5);
  assert.equal(projected.groupsReturned, 2);
  assert.equal(projected.groupsOmitted, 3);
  assert.equal(projected.groupsTruncated, true);
  assert.ok(projected.groups.some((group) => group.key === "se-4"));
});

test("compact anchors use one file table and preserve resolvable line evidence", () => {
  const summary = {
    ast: { queries: [{ groups: [
      { firstAnchor: { file: fixture, range: { start: { line: 4, column: 1 }, end: { line: 4, column: 20 } } } },
      { firstAnchor: { file: fixture, range: { start: { line: 5, column: 1 }, end: { line: 6, column: 20 } } } },
    ] }] },
    sourceEvidence: [{ groups: [{ firstAnchor: { file: fixture, line: 4 } }] }],
  };
  const compacted = compactSummaryAnchors(summary);
  assert.equal(compacted.anchors, 3);
  assert.equal(compacted.files, 1);
  assert.equal(summary.anchorFiles.paths.length, 1);
  const anchor = summary.ast.queries[0].groups[0].firstAnchor;
  assert.equal(Object.hasOwn(anchor, "file"), false);
  assert.equal(anchor.line, 4);
  assert.equal(resolveCompactAnchor(summary, anchor).file, fixture);
});

test("human dictionary round-trip preserves concrete names and rejects unresolved references", () => {
  const summary = {
    stage: 2,
    ast: { queries: [{ id: "shadow", groups: Array.from({ length: 40 }, (_, index) => ({
      key: `g-${index}`,
      owner: "CChartSpace",
      relation: "field-write",
      field: "innerShdw",
      target: "CInnerShdw",
      firstAnchor: { file: fixture, line: index + 1 },
    })) }] },
    sourceEvidence: [{ id: "source", groups: [{ key: "se-1", label: "ChartSpace inner shadow", firstAnchor: { file: fixture, line: 1 } }] }],
  };
  const encoded = encodeHumanFields(summary);
  assert.equal(encoded.ast.queries[0].groups[0].owner, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(encoded)) < Buffer.byteLength(JSON.stringify(summary)));
  assert.deepEqual(decodeHumanFields(encoded), summary);
  encoded.ast.queries[0].groups[0].h[0] = 999;
  assert.throws(() => decodeHumanFields(encoded), /Unresolved human dictionary reference/);
});

test("stage 2 renderer expands encoded fields and emits human-readable paths without evidence ids", () => {
  const summary = encodeHumanFields({
    stage: 2,
    status: "candidate",
    ast: { queries: [{ id: "shadow", command: "find", status: "candidate", coverage: {}, groups: [{ key: "g-test", owner: "Shape", relation: "field-write", field: "shadow", target: "InnerShadow", items: 1, evidence: 1, firstAnchor: { file: "Shape.js", line: 10 } }] }] },
    sourceEvidence: [],
    quality: {}, output: {},
  });
  const markdown = renderStage2Report(summary);
  assert.match(markdown, /Shape\.shadow -> InnerShadow/);
  assert.match(markdown, /Shape\.js:10/);
  assert.equal(findInternalReportIdentifiers(markdown).length, 0);
  assert.doesNotMatch(markdown, /g-test|Evidence ID|ast:shadow/);
});

test("quality equivalence preserves digests, counters, required groups and anchors", () => {
  const before = {
    stage: 2,
    ast: { queries: [{ id: "shadow", groupDigest: "ast-digest", coverage: { groupsMatched: 2, detailsRequested: 1, detailsReturned: 1, detailsSuppressed: 0 }, groups: [
      { key: "g-required", owner: "Shape", relation: "field-write", field: "shadow", target: "InnerShadow", firstAnchor: { file: "Shape.js", line: 10 } },
    ] }] },
    sourceEvidence: [{ id: "source", groupDigest: "source-digest", filesScanned: 1, totalMatches: 1, returned: 1, groupsTotal: 1, groups: [{ key: "se-required", label: "source", firstAnchor: { file: "Shape.js", line: 10 } }] }],
  };
  const after = encodeHumanFields(before);
  const equivalent = compareStageRepresentations(before, after, { requiredGroups: { shadow: [{ key: "g-required" }] }, requiredSourceGroups: { source: ["se-required"] } });
  assert.equal(equivalent.ok, true);
  after.ast.queries[0].groupDigest = "changed";
  assert.equal(compareStageRepresentations(before, after).ok, false);
});

test("coverage gate blocks suppression, parse repetition, missing anchors and overflow", () => {
  const valid = {
    stage: 2,
    ast: {
      stats: { parseCounts: { "Shape.js": 1 }, failed: 0 },
      plan: { compiledBeforeParse: true, lateQueries: 0 },
      queries: [{ id: "shadow", groupDigest: "digest", coverage: { groupsMatched: 1, detailsRequested: 1, detailsReturned: 1, detailsSuppressed: 0, detailEvidenceSuppressed: 0 }, groups: [{ key: "g-1", firstAnchor: { file: "Shape.js", line: 10 } }] }],
    },
    sourceEvidence: [{ id: "source", groupDigest: "source", groupsTotal: 1, groups: [{ key: "se-1", firstAnchor: { file: "Shape.js", line: 10 } }] }],
    output: { bounded: true, overflow: false },
  };
  assert.equal(evaluateStage2Coverage(valid, { requirePlan: true }).ok, true);
  const invalid = JSON.parse(JSON.stringify(valid));
  invalid.ast.stats.parseCounts["Shape.js"] = 2;
  invalid.ast.queries[0].coverage.detailsSuppressed = 1;
  delete invalid.ast.queries[0].groups[0].firstAnchor;
  invalid.output = { bounded: false, overflow: true };
  const result = evaluateStage2Coverage(invalid, { requirePlan: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 4);
});

test("stage run comparison returns compact metric deltas and equivalence status", () => {
  const run = {
    stage: 2, status: "candidate", runtime: { planId: "qp-test" },
    ast: { stats: { parseCounts: { "Shape.js": 1 } }, queries: [{ id: "shadow", groupDigest: "digest", coverage: { groupsMatched: 1, groupsReturned: 1 }, groups: [] }] },
    sourceEvidence: [{ id: "source", groupDigest: "source", filesScanned: 1, totalMatches: 1, returned: 1, groupsTotal: 0, groups: [] }],
    output: { bounded: true },
  };
  const result = compareStageRuns(run, run, { beforeBytes: 2000, afterBytes: 1500 });
  assert.equal(result.status, "comparable");
  assert.equal(result.delta.bytes, -500);
  assert.equal(result.equivalence.ok, true);
});

test("human codec and quality CLI tools exchange compact argv-safe JSON", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-quality-cli-"));
  const beforeFile = path.join(directory, "before.json");
  const encodedFile = path.join(directory, "encoded.json");
  const value = {
    stage: 2, status: "candidate", runtime: { planId: "qp-cli" },
    ast: { stats: { parseCounts: { "Shape.js": 1 }, failed: 0 }, plan: { compiledBeforeParse: true, lateQueries: 0 }, queries: [{ id: "shadow", command: "find", groupDigest: "digest", coverage: { groupsMatched: 1, groupsReturned: 1, detailsRequested: 0, detailsReturned: 0, detailsSuppressed: 0, detailEvidenceSuppressed: 0 }, groups: [{ key: "g-1", owner: "Shape", relation: "field-write", field: "shadow", target: "InnerShadow", firstAnchor: { file: "Shape.js", line: 10 } }] }] },
    sourceEvidence: [], output: { bounded: true, overflow: false },
  };
  fs.writeFileSync(beforeFile, JSON.stringify(value));
  const encoded = spawnSync(process.execPath, [path.resolve(__dirname, "human_report_codec.js"), "--input", beforeFile, "--output", encodedFile, "--mode", "encode"], { encoding: "utf8" });
  assert.equal(encoded.status, 0, encoded.stderr || encoded.stdout);
  const equivalent = spawnSync(process.execPath, [path.resolve(__dirname, "quality_equivalence.js"), "--before", beforeFile, "--after", encodedFile], { encoding: "utf8" });
  assert.equal(equivalent.status, 0, equivalent.stderr || equivalent.stdout);
  assert.equal(JSON.parse(equivalent.stdout).ok, true);
  const gate = spawnSync(process.execPath, [path.resolve(__dirname, "coverage_gate.js"), "--input", encodedFile, "--require-plan"], { encoding: "utf8" });
  assert.equal(gate.status, 0, gate.stderr || gate.stdout);
  const compared = spawnSync(process.execPath, [path.resolve(__dirname, "compare_stage_runs.js"), "--before", beforeFile, "--after", encodedFile], { encoding: "utf8" });
  assert.equal(compared.status, 0, compared.stderr || compared.stdout);
  assert.equal(JSON.parse(compared.stdout).status, "comparable");
});

test("adaptive fitter reaches reserve target without changing full digests or required groups", () => {
  const semanticGroups = Array.from({ length: 20 }, (_, index) => ({ key: `g-${index}`, owner: `Owner${index}`, relation: "field-write", field: index < 2 ? "shadow" : "noise", target: "CShadow", items: 1, evidence: 1, example: { file: fixture, line: index + 1 } }));
  const sourceGroups = Array.from({ length: 10 }, (_, index) => ({ key: `se-${index}`, label: `source-${index}`, totalMatches: 1, returned: 1, truncated: false, firstAnchor: { file: fixture, line: index + 1 } }));
  const facts = {
    stage: 2,
    status: "candidate",
    runtime: { budgets: { factsBytes: 999999, summaryBytes: 4096, evidenceBytes: 999999, reportBytes: 999999 } },
    quality: {}, output: {}, measurements: {},
    ast: { status: "candidate", stats: {}, results: [{ id: "large", command: "find", status: "candidate", coverage: { groupsMatched: 20 }, groupDigest: "ast-full", semanticGroups }] },
    sourceEvidence: { checks: [{ id: "source", status: "candidate", filesScanned: 1, totalMatches: 10, returned: 10, truncated: false, groupDigest: "source-full", groupsTotal: 10, groups: sourceGroups }] },
  };
  const summary = buildStageSummary(facts, { projection: {
    maxGroupsPerQuery: 12,
    requiredGroups: { large: [{ key: "g-0" }, { key: "g-1" }] },
    source: { maxGroupsPerCheck: 8, requiredGroupKeys: { source: ["se-0", "se-1"] } },
    compactAnchors: true,
    humanDictionary: true,
    adaptive: { enabled: true, targetRatio: 0.75 },
  } });
  assert.equal(summary.ast.queries[0].groupDigest, "ast-full");
  assert.equal(summary.sourceEvidence[0].groupDigest, "source-full");
  assert.ok(summary.ast.queries[0].groups.some((group) => group.key === "g-0"));
  assert.ok(summary.ast.queries[0].groups.some((group) => group.key === "g-1"));
  assert.ok(summary.sourceEvidence[0].groups.some((group) => group.key === "se-0"));
  assert.ok(summary.sourceEvidence[0].groups.some((group) => group.key === "se-1"));
  assert.equal(summary.humanDictionary.schemaVersion, "1.0.0");
  assert.equal(decodeHumanFields(summary).ast.queries[0].groups[0].owner.startsWith("Owner"), true);
  assert.ok(summary.adaptive.attempts > 0);
  assert.equal(summary.adaptive.fit, true);
  assert.equal(summary.output.bounded, true);
});

test("source slice assembler resolves compact anchors and merges duplicate ranges", () => {
  const summary = {
    ast: { queries: [{ id: "shadow", groups: [
      { key: "g-1", firstAnchor: { file: fixture, line: 4 } },
      { key: "g-2", firstAnchor: { file: fixture, line: 5 } },
    ] }] },
    sourceEvidence: [{ id: "source", groups: [{ key: "se-1", firstAnchor: { file: fixture, line: 4 } }] }],
  };
  compactSummaryAnchors(summary);
  const slices = buildSourceSlices(summary, { contextBefore: 0, contextAfter: 0, maxLines: 4, maxSlices: 5 });
  assert.equal(slices.coverage.anchorsSelected, 3);
  assert.equal(slices.coverage.rangesAfterMerge, 1);
  assert.equal(slices.slices.length, 1);
  assert.equal(slices.slices[0].startLine, 4);
  assert.equal(slices.slices[0].endLine, 5);
  assert.equal(slices.slices[0].sources.length, 3);
  assert.ok(slices.coverage.linesReturned <= 4);
  const limited = buildSourceSlices(summary, { contextBefore: 0, contextAfter: 0, maxLines: 1, maxSlices: 5 });
  assert.equal(limited.coverage.linesReturned, 1);
  assert.equal(limited.coverage.truncated, true);
});

test("stage budgets are separate and legacy maxOutputBytes maps to facts only", () => {
  const budgets = normalizeBudgets({ maxOutputBytes: 12345, budgets: { summaryBytes: 4096, evidenceBytes: 8192, reportBytes: 16384 } });
  assert.equal(budgets.factsBytes, 12345);
  assert.equal(budgets.summaryBytes, 4096);
  assert.equal(budgets.evidenceBytes, 8192);
  assert.equal(budgets.reportBytes, 16384);
});

test("summary budget reports explicit overflow without dropping required projection", () => {
  const semanticGroups = Array.from({ length: 20 }, (_, index) => ({ key: `g-${index}`, owner: `Owner${index}`, relation: "field-write", field: "shadow", target: "CShadow", items: 1, evidence: 1, example: { file: fixture, line: index + 1 } }));
  const facts = {
    stage: 2,
    status: "candidate",
    runtime: { budgets: { factsBytes: 999999, summaryBytes: 1024, evidenceBytes: 999999, reportBytes: 999999 } },
    quality: {},
    output: {},
    measurements: {},
    ast: { status: "candidate", stats: {}, results: [{ id: "large", command: "find", status: "candidate", coverage: { groupsMatched: 20 }, semanticGroups }] },
    sourceEvidence: { checks: [] },
  };
  const summary = buildStageSummary(facts, { projection: { maxGroupsPerQuery: 20 } });
  assert.equal(summary.output.overflow, true);
  assert.equal(summary.output.bounded, false);
  assert.equal(summary.status, "partial");
  assert.equal(summary.ast.queries[0].groups.length, 20);
});

test("empty source evidence remains candidate-empty", () => {
  const output = runEvidenceChecks({ checks: [{ id: "empty", file: fixture, pattern: "definitely_missing_symbol" }] });
  assert.equal(output.checks[0].status, "candidate-empty");
});

test("transition extractor returns only required structured fields", () => {
  const markdown = `# stage\n\n- target: shadows\n- scope: sdkjs\n- stage: 1\n- status: complete\n- confirmed evidence: yes\n- candidate evidence: maybe\n- dictionary/graph/path state: ready\n- skipped/forbidden: none\n- open checks: owners\n- next stage: 2\n`;
  const output = extractTransition(markdown);
  assert.equal(output.valid, true);
  assert.equal(output.fields["open checks"], "owners");
  assert.equal(Object.keys(output.fields).length, 10);
});

test("transition extractor accepts the fenced plain-field artifact format", () => {
  const markdown = `## Артефакт для следующего этапа\n\n\`\`\`text\ntarget: shadows\nscope: sdkjs\nstage: 3\nstatus: closed\nconfirmed evidence: yes\ncandidate evidence: maybe\ndictionary/graph/path state: ready\nskipped/forbidden: none\nopen checks: recipients\nnext stage: 4\n\`\`\`\n`;
  const output = extractTransition(markdown);
  assert.equal(output.valid, true);
  assert.equal(output.fields.stage, "3");
  assert.equal(output.fields["next stage"], "4");
});

test("stage 2 runner produces bounded facts-first artifact", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-"));
  const transitionArtifact = path.join(directory, "stage1.md");
  fs.writeFileSync(transitionArtifact, `- target: shadows\n- scope: sdkjs\n- stage: 1\n- status: complete\n- confirmed evidence: yes\n- candidate evidence: maybe\n- dictionary/graph/path state: ready\n- skipped/forbidden: none\n- open checks: owners\n- next stage: 2\n`);
  const output = runStage2({ stage: 2, transitionArtifact, ast: { queries: [{ command: "find", file: fixture, options: { terms: "shadow" }, groupFilters: { owner: "*" } }] }, evidence: { checks: [{ file: fixture, pattern: "shadow", maxMatches: 2 }] } });
  assert.equal(output.output.bounded, true);
  assert.equal(output.quality.astFilesParsedOnce, true);
  assert.equal(output.quality.coverageGate.ok, true);
  assert.ok(output.measurements.ast.bytes > 0);
  assert.ok(output.measurements.sourceEvidence.estimatedTokens > 0);
});

test("stage 2 renderer is deterministic and cannot promote candidates", () => {
  const facts = {
    stage: 2,
    status: "candidate",
    ast: { results: [{ id: "owners", command: "find", status: "candidate", coverage: { groupsScanned: 1, groupsMatched: 1, groupsReturned: 1, detailsRequested: 1, detailsReturned: 1, detailsSuppressed: 0 }, groups: [{ key: "g-test", owner: "Shape", relation: "field-write", field: "shadow", target: "InnerShadow", items: 1, evidence: 1 }] }] },
    sourceEvidence: { checks: [{ id: "source", status: "candidate", filesScanned: 1, totalMatches: 1, returned: 1, truncated: false, matches: [{ file: "Shape.js", line: 10, snippet: "this.shadow = value" }] }] },
    quality: { astFilesParsedOnce: true },
    output: { bounded: true },
  };
  const first = renderStage2Report(facts);
  const second = renderStage2Report(facts);
  const model = buildReportModel(facts);
  assert.equal(first, second);
  assert.equal(model.groups[0].status, "candidate");
  assert.equal(model.sourceMatches[0].status, "source-match");
  assert.equal(model.groups.some((group) => group.status === "confirmed"), false);
});

test("measurement and renderer CLIs run with argv-safe JSON files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-cli-"));
  const measurementRequest = path.join(directory, "measure.json");
  fs.writeFileSync(measurementRequest, JSON.stringify({ inputs: [{ id: "facts", bytes: 1024 }] }));
  const measured = spawnSync(process.execPath, [path.resolve(__dirname, "measure_context.js"), "--request", measurementRequest], { encoding: "utf8" });
  assert.equal(measured.status, 0, measured.stderr || measured.stdout);
  assert.equal(JSON.parse(measured.stdout).totals.modelVisibleBytes, 1024);

  const factsFile = path.join(directory, "facts.json");
  fs.writeFileSync(factsFile, JSON.stringify({ stage: 2, status: "candidate", ast: { results: [] }, sourceEvidence: { checks: [] }, quality: {}, output: {} }));
  const reportFile = path.join(directory, "report.md");
  const rendered = spawnSync(process.execPath, [path.resolve(__dirname, "render_stage2_report.js"), "--input", factsFile, "--output", reportFile, "--stdout", "summary"], { encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  assert.equal(JSON.parse(rendered.stdout).status, "rendered");
  assert.match(fs.readFileSync(reportFile, "utf8"), /^# Stage 2 Facts Report/);
});

test("stage 2 summary stdout requires and preserves the full facts artifact", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-summary-"));
  const transitionArtifact = path.join(directory, "stage1.md");
  const requestFile = path.join(directory, "request.json");
  const outputFile = path.join(directory, "facts.json");
  fs.writeFileSync(transitionArtifact, `- target: shadows\n- scope: sdkjs\n- stage: 1\n- status: complete\n- confirmed evidence: yes\n- candidate evidence: maybe\n- dictionary/graph/path state: ready\n- skipped/forbidden: none\n- open checks: owners\n- next stage: 2\n`);
  fs.writeFileSync(requestFile, JSON.stringify({ stage: 2, transitionArtifact, maxOutputBytes: 4096, ast: { queries: [{ id: "shadow", command: "find", file: fixture, options: { terms: "shadow" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 500 }] }, evidence: { checks: [{ id: "source", file: fixture, pattern: "shadow", maxMatches: 2 }] } }));
  const completed = spawnSync(process.execPath, [path.resolve(__dirname, "stage2_runner.js"), "--request", requestFile, "--output", outputFile, "--stdout", "summary"], { encoding: "utf8" });
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  const summary = JSON.parse(completed.stdout);
  const facts = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(summary.artifact, outputFile);
  assert.equal(summary.quality.astDetailsSuppressed, 0);
  assert.equal(facts.ast.results[0].coverage.detailsSuppressed, 0);
  assert.ok(Buffer.byteLength(completed.stdout) < Buffer.byteLength(fs.readFileSync(outputFile)));
});
