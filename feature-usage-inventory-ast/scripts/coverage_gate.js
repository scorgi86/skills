const fs = require("fs");
const path = require("path");
const { decodeHumanFields } = require("./human_report_codec");

function astQueries(value) {
  return value && value.ast && (value.ast.queries || value.ast.results) || [];
}

function sourceChecks(value) {
  return value && value.sourceEvidence && (value.sourceEvidence.checks || value.sourceEvidence) || [];
}

function evaluateStage2Coverage(input, options = {}) {
  const errors = [];
  const warnings = [];
  let value;
  try { value = decodeHumanFields(input); } catch (error) {
    return { schemaVersion: "1.0.0", status: "blocked", ok: false, errors: [error.message], warnings };
  }
  if (Number(value.stage) !== 2) errors.push("Coverage gate requires stage 2 data");

  const stats = value.ast && value.ast.stats || {};
  const parseCounts = Object.values(stats.parseCounts || {});
  if (parseCounts.some((count) => count !== 1)) errors.push("Every parsed file must have parse count 1");
  if (stats.failed > 0) errors.push(`AST parse failures: ${stats.failed}`);
  const plan = value.ast && value.ast.plan || value.runtime && value.runtime.plan || null;
  if (plan && plan.compiledBeforeParse !== true) errors.push("AST plan was not compiled before parse");
  if (plan && Number(plan.lateQueries || 0) !== 0) errors.push(`AST late queries: ${plan.lateQueries}`);
  if (!plan && options.requirePlan) errors.push("AST plan metadata is missing");

  for (const query of astQueries(value)) {
    const id = query.id || query.command || "<query>";
    const coverage = query.coverage || {};
    if ((coverage.detailsRequested || 0) !== (coverage.detailsReturned || 0)) errors.push(`${id}: requested and returned details differ`);
    if ((coverage.detailsSuppressed || 0) !== 0) errors.push(`${id}: details were suppressed`);
    if ((coverage.detailEvidenceSuppressed || 0) !== 0) errors.push(`${id}: detail evidence was suppressed`);
    const matched = coverage.groupsMatched ?? query.groupsAvailable ?? 0;
    if (matched > 0 && !query.groupDigest) errors.push(`${id}: group digest is missing`);
    for (const group of query.groups || []) if (!group.firstAnchor && !group.example) errors.push(`${id}/${group.key || "<group>"}: first anchor is missing`);
  }

  for (const check of sourceChecks(value)) {
    const id = check.id || "<check>";
    const groupsTotal = check.groupsTotal || (check.groups || []).length;
    if (groupsTotal > 0 && !check.groupDigest) errors.push(`${id}: source group digest is missing`);
    for (const group of check.groups || []) if (!group.firstAnchor) errors.push(`${id}/${group.key || "<group>"}: source first anchor is missing`);
    if (check.status === "candidate-empty") warnings.push(`${id}: empty source result remains candidate-only`);
  }

  const output = value.output || null;
  if (output && output.overflow === true) errors.push("Output budget overflow");
  if (output && output.bounded === false) errors.push("Output is not bounded");
  return {
    schemaVersion: "1.0.0",
    status: errors.length ? "blocked" : "passed",
    ok: errors.length === 0,
    checks: { parseFiles: parseCounts.length, astQueries: astQueries(value).length, sourceChecks: sourceChecks(value).length },
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--input", "--require-plan"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if (arg === "--require-plan") options.requirePlan = true;
    else {
      if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      options.input = argv[++index];
    }
  }
  if (!options.input) throw new Error("Provide --input <stage2-json>");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const value = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
    const result = evaluateStage2Coverage(value, options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { evaluateStage2Coverage };
