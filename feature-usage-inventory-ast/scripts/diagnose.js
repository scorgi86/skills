#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const skillRoot = path.resolve(__dirname, "..");
const baseSkillRoot = path.resolve(skillRoot, "..", "feature-usage-inventory");

const requiredScripts = [
  "diagnose.js",
  "quick_validate.js",
  "prototype_ast.js",
  "ast_batch.js",
  "stage0_runner.js",
  "fact_projection.js",
  "stage_facts.js",
  "summary_compaction.js",
  "human_report_codec.js",
  "compare_stage_runs.js",
  "extract_stage_transition.js",
  "goal_contract.js",
  "stage1_runner.js",
  "stage1_coverage_gate.js",
  "stage1_bundle.js",
  "render_stage1_report.js",
  "stage2_runner.js",
  "stage2_bundle.js",
  "stage_findings.js",
  "query_stage_artifacts.js",
  "validate_stage_bundle.js",
  "measure_context.js",
  "render_stage2_report.js",
  "inventory_search.js",
  "source_evidence.js",
  "source_slice.js",
  "coverage_gate.js",
  "quality_equivalence.js",
  "validate_inventory_stage.js",
  "validate_inventory_report.js",
  "report_model.js",
  "stage7_runner.js",
  "stage7_coverage_gate.js",
  "stage8_runner.js",
  "validate_skill.js",
];

const requiredBaseFiles = [
  "SKILL.md",
  "references/inventory-report-template.md",
  "scripts/validate_inventory_stage.js",
  "scripts/validate_inventory_report.js",
];

function parseArgs(argv) {
  const args = { pretty: false, strict: false, repos: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pretty") args.pretty = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--repos") args.repos = (argv[++index] || "").split(",").map((v) => v.trim()).filter(Boolean);
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

  const missingBaseFiles = requiredBaseFiles.filter((name) => !fs.existsSync(path.join(baseSkillRoot, name)));
  addCheck(checks, "base-skill", "required", missingBaseFiles.length === 0, missingBaseFiles.length === 0 ? "Base feature-usage-inventory skill is present" : "Base skill files are missing", { root: baseSkillRoot, missing: missingBaseFiles });

  const quickValidation = command(process.execPath, [path.join(skillRoot, "scripts", "quick_validate.js"), skillRoot]);
  addCheck(checks, "quick-validation", "required", quickValidation.ok, quickValidation.ok ? quickValidation.stdout : "Node.js quick validation failed", quickValidation.ok ? undefined : { error: quickValidation.error || quickValidation.stderr || quickValidation.stdout });

  for (const tool of ["rg", "git"]) {
    const result = command(tool, ["--version"]);
    addCheck(checks, tool, "recommended", result.ok, result.ok ? result.stdout.split(/\r?\n/)[0] : `${tool} is unavailable`, result.ok ? undefined : { error: result.error || result.stderr });
  }

  const gitnexusVersion = command("gitnexus", ["--version"]);
  addCheck(checks, "gitnexus", "recommended", gitnexusVersion.ok, gitnexusVersion.ok ? `GitNexus ${gitnexusVersion.stdout}` : "GitNexus CLI is unavailable", gitnexusVersion.ok ? undefined : { error: gitnexusVersion.error || gitnexusVersion.stderr });

  if (gitnexusVersion.ok) {
    const doctor = command("gitnexus", ["doctor"]);
    const graphAvailable = doctor.ok && /Graph store:\s+available/i.test(doctor.stdout);
    const ftsAvailable = doctor.ok && /Full-text search:\s+available/i.test(doctor.stdout);
    const vectorAvailable = doctor.ok && /VECTOR index:\s+available/i.test(doctor.stdout);
    addCheck(checks, "gitnexus-graph", "recommended", graphAvailable, graphAvailable ? "GitNexus graph store is available" : "GitNexus graph store is unavailable", { doctor: doctor.ok ? undefined : doctor.stderr });
    addCheck(checks, "gitnexus-fts", "recommended", ftsAvailable, ftsAvailable ? "GitNexus FTS is available" : "GitNexus FTS is unavailable or degraded");
    addCheck(checks, "gitnexus-vector", "optional", vectorAvailable, vectorAvailable ? "GitNexus VECTOR index is available" : "GitNexus VECTOR index is unavailable; exact graph/FTS/AST workflows remain usable");

    const list = command("gitnexus", ["list"]);
    const registered = parseRepoList(list.stdout);
    const requestedRepos = options.repos || [];
    const missingRepos = requestedRepos.filter((repo) => !registered.has(repo.toLowerCase()));
    const staleRepos = [];
    const statusErrors = [];
    for (const repoName of requestedRepos) {
      const entry = registered.get(repoName.toLowerCase());
      if (!entry) continue;
      const status = command("gitnexus", ["status"], { cwd: entry.path });
      if (!status.ok) statusErrors.push({ repo: repoName, error: status.error || status.stderr });
      else if (!/Status:\s+.*up-to-date/i.test(status.stdout)) staleRepos.push(repoName);
    }
    const indexesOk = list.ok && missingRepos.length === 0 && staleRepos.length === 0 && statusErrors.length === 0;
    addCheck(checks, "gitnexus-indexes", "recommended", indexesOk, !list.ok ? "GitNexus registry cannot be read" : indexesOk ? "Requested GitNexus indexes are registered and up to date" : "Some requested GitNexus indexes are missing, stale, or unreadable", { requested: requestedRepos, missing: missingRepos, stale: staleRepos, statusErrors });
  }

  const status = evaluateStatus(checks, options.strict === true);
  return {
    schemaVersion: "1.0.0",
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
    const nameMatch = lines[index].match(/^\s{2}([^:\r\n]+?)\s*$/);
    if (!nameMatch) continue;
    const pathMatch = lines.slice(index + 1, index + 5).join("\n").match(/^\s+Path:\s+(.+)$/m);
    if (pathMatch) repos.set(nameMatch[1].trim().toLowerCase(), { name: nameMatch[1].trim(), path: pathMatch[1].trim() });
  }
  return repos;
}

function usage() {
  console.log("Usage: node scripts/diagnose.js [--repos sdkjs,web-apps,desktop-apps] [--strict] [--pretty]");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(2);
  }
  if (args.help) {
    usage();
    return;
  }
  const result = runDiagnostics(args);
  console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
  process.exit(result.status === "ready" ? 0 : result.status === "degraded" ? 1 : 2);
}

if (require.main === module) main();

module.exports = { evaluateStatus, parseArgs, parseRepoList, runDiagnostics };
