"use strict";

const { invokeGitNexus } = require("./gitnexus_runtime.js");

const { spawnSync } = require("node:child_process");

const path = require("node:path");

const fs = require("node:fs");

const skillRoot = path.resolve(require("node:path").resolve(__dirname, "../../.."), "..");

const requiredScripts = [
  "shared/diagnostics/src/diagnose.js",
  "shared/diagnostics/src/quick_validate.js",
  "shared/ast/src/prototype_ast.js",
  "shared/ast/src/batch/ast_batch.js",
  "steps/step-0/src/runner.js",
  "shared/output/src/fact_projection.js",
  "shared/output/src/stage_facts.js",
  "shared/output/src/summary/compaction.js",
  "shared/output/src/human_report_codec.js",
  "shared/output/src/compare_stage_runs.js",
  "shared/dto/src/extract_stage_transition.js",
  "state/src/goal_contract.js",
  "flows/full-flow/src/stage_pipeline.js",
  "steps/step-1/src/runner.js",
  "steps/step-1/src/stage1_coverage_gate.js",
  "steps/step-1/src/render_stage1_report.js",
  "steps/step-2/src/runner.js",
  "shared/artifacts/src/query_stage_artifacts.js",
  "shared/output/src/measure_context.js",
  "steps/step-2/src/render_stage2_report.js",
  "shared/search/src/inventory_search.js",
  "shared/evidence/src/collection/source_evidence.js",
  "shared/evidence/src/source_slice.js",
  "steps/step-2/src/coverage_gate.js",
  "shared/output/src/quality_equivalence.js",
  "shared/report/src/validate_inventory_stage.js",
  "shared/report/src/markdown/validate_report.js",
  "shared/report/src/model/normalization.js",
  "steps/step-7/src/runner.js",
  "cli/src/commands/stage7_coverage_gate.js",
  "steps/step-8/src/runner.js",
  "shared/artifacts/src/canonical/result.js",
  "cli/src/commands/canonical_stage_cli.js",
  "shared/artifacts/src/stage_artifact_v4.js",
  "shared/evidence/src/canonicalization/canonicalize.js",
  "shared/dto/src/repository_scope.js",
  "shared/diagnostics/src/validate_skill.js",
];

function parseArgs(argv) {
  const args = { pretty: false, strict: false, indexes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pretty") args.pretty = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--indexes") args.indexes = (argv[++index] || "").split(",").map((v) => v.trim()).filter(Boolean);
    else if (arg === "--gitnexus-runner") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("Missing value for --gitnexus-runner");
      args.gitnexus = { runnerPath: path.resolve(argv[++index]) };
    }
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function command(commandName, args = [], options = {}) {
  const executable = resolveCommand(commandName);
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    shell: process.platform === "win32" && /\.cmd$/i.test(executable),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error ? result.error.message : undefined,
  };
}

function resolveCommand(commandName) {
  if (process.platform !== "win32") return commandName;
  const appData = process.env.APPDATA;
  if (appData) {
    for (const extension of [".cmd", ".exe"]) {
      const candidate = path.join(appData, "npm", `${commandName}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return commandName;
}

function addCheck(checks, id, severity, ok, message, details) {
  checks.push({ id, severity, ok, message, ...(details ? { details } : {}) });
}

function evaluateStatus(checks, strict = false) {
  if (checks.some((item) => !item.ok && (item.severity === "required" || (strict && item.severity === "recommended")))) return "blocked";
  if (checks.some((item) => !item.ok && item.severity === "recommended")) return "degraded";
  return "ready";
}

function runDiagnostics(options = {}) {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  addCheck(checks, "node", "required", nodeMajor >= 22, `Node.js ${process.version}`, { minimum: "22" });

  try {
    const swcPackage = require(path.join(skillRoot, "node_modules", "@swc", "core", "package.json"));
    const swc = require(path.join(skillRoot, "node_modules", "@swc", "core"));
    addCheck(checks, "swc", "required", typeof swc.parseSync === "function", `@swc/core ${swcPackage.version}`, {
      runtime: path.join(skillRoot, "node_modules"),
    });
  } catch (error) {
    addCheck(checks, "swc", "required", false, "@swc/core is unavailable", { error: error.message });
  }

  const missingScripts = requiredScripts.filter((name) => !fs.existsSync(path.join(skillRoot, "scripts", name)));
  addCheck(checks, "skill-scripts", "required", missingScripts.length === 0, missingScripts.length === 0 ? "Required scripts are present" : "Required scripts are missing", { missing: missingScripts });

  const quickValidation = command(process.execPath, [path.join(skillRoot, "scripts", "cli", "src", "commands", "quick_validate.js"), skillRoot]);
  addCheck(checks, "quick-validation", "required", quickValidation.ok, quickValidation.ok ? quickValidation.stdout : "Node.js quick validation failed", quickValidation.ok ? undefined : { error: quickValidation.error || quickValidation.stderr || quickValidation.stdout });

  for (const tool of ["rg", "git"]) {
    const result = command(tool, ["--version"]);
    addCheck(checks, tool, "recommended", result.ok, result.ok ? result.stdout.split(/\r?\n/)[0] : `${tool} is unavailable`, result.ok ? undefined : { error: result.error || result.stderr });
  }

  const gitnexusConfig = options.gitnexus || {};
  const globalVersion = invokeGitNexus({ command: gitnexusConfig.command || "gitnexus" }, ["--version"]);
  const localVersion = gitnexusConfig.runnerPath ? invokeGitNexus(gitnexusConfig, ["--version"]) : null;
  const selectedConfig = localVersion && localVersion.ok ? gitnexusConfig : { command: gitnexusConfig.command || "gitnexus" };
  const gitnexusVersion = localVersion && localVersion.ok ? localVersion : globalVersion;
  const gitnexusCommand = (args, extra = {}) => invokeGitNexus({ ...selectedConfig, ...extra }, args);
  addCheck(checks, "gitnexus", "recommended", gitnexusVersion.ok, gitnexusVersion.ok ? `GitNexus ${gitnexusVersion.stdout}` : "GitNexus CLI is unavailable", { selected: gitnexusVersion.invocation, global: globalVersion, local: localVersion, error: gitnexusVersion.error || gitnexusVersion.stderr });

  if (gitnexusVersion.ok) {
    const doctor = gitnexusCommand(["doctor"]);
    const graphAvailable = doctor.ok && /Graph store:\s+available/i.test(doctor.stdout);
    const ftsAvailable = doctor.ok && /Full-text search:\s+available/i.test(doctor.stdout);
    const vectorAvailable = doctor.ok && /VECTOR index:\s+available/i.test(doctor.stdout);
    addCheck(checks, "gitnexus-graph", "recommended", graphAvailable, graphAvailable ? "GitNexus graph store is available" : "GitNexus graph store is unavailable", { doctor: doctor.ok ? undefined : doctor.stderr });
    addCheck(checks, "gitnexus-fts", "recommended", ftsAvailable, ftsAvailable ? "GitNexus FTS is available" : "GitNexus FTS is unavailable or degraded");
    addCheck(checks, "gitnexus-vector", "optional", vectorAvailable, vectorAvailable ? "GitNexus VECTOR index is available" : "GitNexus VECTOR index is unavailable; exact graph/FTS/AST workflows remain usable");

    const list = gitnexusCommand(["list"]);
    const registered = parseRepoList(list.stdout);
    const requestedRepos = options.indexes || [];
    const missingRepos = requestedRepos.filter((repo) => !registered.has(repo.toLowerCase()));
    const staleRepos = [];
    const statusErrors = [];
    for (const repoName of requestedRepos) {
      const entry = registered.get(repoName.toLowerCase());
      if (!entry) continue;
      const status = gitnexusCommand(["status"], { cwd: entry.path });
      if (!status.ok) statusErrors.push({ repo: repoName, error: status.error || status.stderr });
      else if (!/Status:\s+.*up-to-date/i.test(status.stdout)) staleRepos.push(repoName);
    }
    const indexesOk = list.ok && missingRepos.length === 0 && staleRepos.length === 0 && statusErrors.length === 0;
    addCheck(checks, "gitnexus-indexes", "recommended", indexesOk, !list.ok ? "GitNexus registry cannot be read" : indexesOk ? "Requested GitNexus indexes are registered and up to date" : "Some requested GitNexus indexes are missing, stale, or unreadable", { requested: requestedRepos, missing: missingRepos, stale: staleRepos, statusErrors });
  }

  const status = evaluateStatus(checks, options.strict === true);
  return {
    schemaVersion: "1.0.0",
    skillVersion: JSON.parse(fs.readFileSync(path.join(skillRoot, "package.json"), "utf8")).version,
    canonicalStageSchemaVersion: "4.0.0",
    command: "diagnose",
    status,
    strict: options.strict === true,
    skillRoot,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.ok).length,
      failed: checks.filter((item) => !item.ok).length,
      requiredFailed: checks.filter((item) => !item.ok && item.severity === "required").map((item) => item.id),
      recommendedFailed: checks.filter((item) => !item.ok && item.severity === "recommended").map((item) => item.id),
      optionalUnavailable: checks.filter((item) => !item.ok && item.severity === "optional").map((item) => item.id),
    },
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRepoList(output) {
  const repos = new Map();
  const lines = output.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const nameMatch = lines[index].match(/^ {0,2}([^:\r\n]+?)\s*$/);
    if (!nameMatch) continue;
    const pathMatch = lines.slice(index + 1, index + 5).join("\n").match(/^\s+Path:\s+(.+)$/m);
    if (pathMatch) repos.set(nameMatch[1].trim().toLowerCase(), { name: nameMatch[1].trim(), path: pathMatch[1].trim() });
  }
  return repos;
}

module.exports = { evaluateStatus, parseArgs, parseRepoList, runDiagnostics };
