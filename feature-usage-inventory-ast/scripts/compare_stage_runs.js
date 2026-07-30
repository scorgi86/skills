const fs = require("fs");
const path = require("path");
const { compareStageRepresentations } = require("./quality_equivalence");

function queries(value) {
  return value && value.ast && (value.ast.queries || value.ast.results) || [];
}

function checks(value) {
  return value && value.sourceEvidence && (value.sourceEvidence.checks || value.sourceEvidence) || [];
}

function sum(items, selector) {
  return items.reduce((total, item) => total + (Number(selector(item)) || 0), 0);
}

function metrics(value, bytes = null) {
  const ast = queries(value);
  const source = checks(value);
  const parseCounts = value && value.ast && value.ast.stats && value.ast.stats.parseCounts || {};
  return {
    bytes,
    estimatedTokens: bytes === null ? null : Math.ceil(bytes / 4),
    status: value && value.status || null,
    planId: value && value.runtime && value.runtime.planId || value && value.ast && value.ast.plan && value.ast.plan.id || null,
    parsedFiles: Object.keys(parseCounts).length,
    parseOperations: sum(Object.values(parseCounts), (count) => count),
    astQueries: ast.length,
    astGroupsMatched: sum(ast, (query) => (query.coverage && query.coverage.groupsMatched) ?? query.groupsAvailable),
    astGroupsReturned: sum(ast, (query) => (query.coverage && query.coverage.groupsReturned) ?? query.groupsReturned),
    sourceChecks: source.length,
    sourceMatches: sum(source, (check) => check.totalMatches),
    bounded: value && value.output ? value.output.bounded : null,
  };
}

function numericDelta(before, after) {
  if (before === null || after === null || before === undefined || after === undefined) return null;
  return after - before;
}

function compareStageRuns(before, after, options = {}) {
  const beforeMetrics = metrics(before, options.beforeBytes ?? null);
  const afterMetrics = metrics(after, options.afterBytes ?? null);
  const equivalence = compareStageRepresentations(before, after, options);
  const delta = {};
  for (const key of ["bytes", "estimatedTokens", "parsedFiles", "parseOperations", "astQueries", "astGroupsMatched", "astGroupsReturned", "sourceChecks", "sourceMatches"]) {
    delta[key] = numericDelta(beforeMetrics[key], afterMetrics[key]);
  }
  return { schemaVersion: "1.0.0", status: equivalence.ok ? "comparable" : "quality-regression", before: beforeMetrics, after: afterMetrics, delta, equivalence };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--before", "--after", "--request"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = argv[++index];
  }
  if (!options.before || !options.after) throw new Error("Provide --before and --after JSON files");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const beforePath = path.resolve(options.before);
    const afterPath = path.resolve(options.after);
    const beforeText = fs.readFileSync(beforePath, "utf8");
    const afterText = fs.readFileSync(afterPath, "utf8");
    const request = options.request ? JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8")) : {};
    const projection = request.projection || {};
    const result = compareStageRuns(JSON.parse(beforeText), JSON.parse(afterText), {
      beforeBytes: Buffer.byteLength(beforeText),
      afterBytes: Buffer.byteLength(afterText),
      requiredGroups: projection.requiredGroups || {},
      requiredSourceGroups: projection.source && projection.source.requiredGroupKeys || {},
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.equivalence.ok) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { compareStageRuns, metrics };
