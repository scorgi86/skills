#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function unique(values = []) { return [...new Set(values.filter(Boolean).map(String))]; }
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function scanRepo(repo, terms, exclusions = [], dependencies = {}) {
  const invoke = dependencies.spawnSync || spawnSync;
  const pattern = unique(terms).map(escapeRegex).join("|");
  if (!pattern) throw new Error("Stage 0 requires at least one seed term");
  const args = ["-l", "-i", pattern, repo.path];
  for (const exclusion of exclusions) args.push("-g", `!${exclusion}`);
  const result = invoke("rg", args, { encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (result.error) return { id: repo.id, path: repo.path, status: "tool-unavailable", reason: result.error.message, files: [], totalFiles: 0 };
  if (![0, 1].includes(result.status)) return { id: repo.id, path: repo.path, status: "partial", reason: String(result.stderr || "rg failed").trim(), files: [], totalFiles: 0 };
  const files = String(result.stdout || "").split(/\r?\n/).filter(Boolean).sort();
  return { id: repo.id, path: repo.path, status: files.length ? "candidate" : "candidate-empty", files, totalFiles: files.length };
}

function transition(facts) {
  const scanEnabled = facts.scanSeeds !== false;
  return {
    target: facts.target,
    scope: facts.scope,
    stage: "0 — Подготовка",
    status: "закрыт",
    "confirmed evidence": scanEnabled ? "scope, seed dictionary, exclusions, tool readiness and file-level candidate scan" : "scope, seed dictionary, exclusions, repository/tool state and search plan",
    "candidate evidence": scanEnabled ? facts.scans.map((scan) => `${scan.id}: ${scan.totalFiles} seed-matching files`).join("; ") : "No usage candidates collected: strict Stage 0 defers the exact seed scan to Stage 1",
    "dictionary/graph/path state": `seed terms: ${facts.seeds.direct.join(", ")}; aliases: ${facts.seeds.aliases.join(", ")}`,
    "skipped/forbidden": facts.limitations.join("; ") || "source edits -> user-forbidden",
    "open checks": "ownership, serializers, scenarios, recipients and paths begin at later stages",
    "next stage": "1 — Нижние слои и владение",
  };
}

function render(facts) {
  const next = transition(facts);
  const scanEnabled = facts.scanSeeds !== false;
  const lines = ["# Этап 0. Подготовка", "", "## Вход", "", `- Target: ${facts.target}.`, `- Mode: selected by the user and recorded in inventory-state.json.`, "", "## Действия", "", scanEnabled ? "- Выполнена диагностика и file-level exact seed scan без AST, source ranges или ownership expansion." : "- Зафиксированы диагностика, scope, seed dictionary и search plan; usage discovery не выполнялся.", "- GitNexus используется только как доступность/ограничение; отсутствие индекса не становится absence evidence.", "", "## Выход", "", "### Scope и seed dictionary", "", `- Репозитории: ${facts.repos.map((repo) => repo.id).join(", ")}.`, `- Прямые seed-термины: ${facts.seeds.direct.join(", ")}.`, `- Алиасы/форматные варианты: ${facts.seeds.aliases.join(", ") || "—"}.`, `- Ожидаемые слои: ${facts.expectedLayers.join(", ")}.`];
  if (facts.repositoryState.length) { lines.push("", "### Repository state", ""); for (const item of facts.repositoryState) lines.push(`- ${item.id}: ${item.state}`); }
  if (facts.tooling.length) { lines.push("", "### Tooling", ""); for (const item of facts.tooling) lines.push(`- ${item.id}: ${item.status}`); }
  lines.push("", "### File-level candidates", "", "| Repo | Статус | Файлы-кандидаты |", "|---|---|---:|");
  for (const scan of facts.scans) lines.push(`| ${scan.id} | ${scan.status} | ${scan.totalFiles} |`);
  lines.push("", "### Ограничения", "");
  for (const limitation of facts.limitations) lines.push(`- ${limitation}`);
  lines.push("", "## DoD", "", "- [x] Scope, exclusions, seed dictionary and expected layers recorded.", scanEnabled ? "- [x] Exact file-level seed scan completed without AST or ownership expansion." : "- [x] Strict Stage 0 records a content/file-name search plan; file-level usage discovery is deferred to Stage 1.", "- [x] Candidate results remain unconfirmed for Stage 1.", "", "## Статус этапа", "", "закрыт", "", "## Артефакт для следующего этапа", "");
  for (const [key, value] of Object.entries(next)) lines.push(`- ${key}: ${value}`);
  lines.push("", "## Следующий этап", "", "Этап 1 запускается согласно mode и driver из `inventory-state.json`: интерактивно или через активную цель.", "", "## Stage Execution Report", "", "- mode: read from inventory-state.json", "- driver: read from inventory-state.json", "- stages completed: 0 — Подготовка", "- stages completed this run: append stage 0 in state", scanEnabled ? "- evidence collected: scope, seed dictionary, exclusions, diagnostics and file-level candidate scan" : "- evidence collected: scope, seed dictionary, exclusions, diagnostics, repository/tool state and search plan", scanEnabled ? "- skipped/forbidden sources: AST/ownership/serializer analysis -> stage 1; source edits -> user-forbidden" : "- skipped/forbidden sources: usage discovery, AST/ownership/serializer analysis -> intentionally deferred to stage 1; source edits -> user-forbidden", "- open checks: stages 1–8", "- protocol deviations: none", "- next step: apply the recorded mode and driver for stage 1", "", "## Execution Status", "", "- Execution Status: complete", "- current stage: 0 — Подготовка", "- next step: 1 — Нижние слои и владение", "- continuation: interactive `продолжай` or active goal", "");
  return lines.join("\n");
}

function runStage0(request, dependencies = {}) {
  if (Number(request && request.stage) !== 0) throw new Error("stage0_runner accepts only stage: 0");
  const repos = Array.isArray(request.repos) ? request.repos : [];
  const seeds = request.seeds || {};
  const direct = unique(seeds.direct);
  if (!request.target || !repos.length || !direct.length) throw new Error("Stage 0 requires target, repos, and seeds.direct");
  const exclusions = unique(request.exclusions || ["node_modules", "dist", "build", "out", "coverage", "*.min.js", "*.map"]);
  const scanSeeds = request.scanSeeds !== false;
  const scans = scanSeeds ? repos.map((repo) => scanRepo(repo, direct, exclusions, dependencies)) : repos.map((repo) => ({ id: repo.id, path: repo.path, status: "not-run", files: [], totalFiles: 0, reason: "Stage 0 strict mode records a search plan only" }));
  const facts = { schemaVersion: "1.0.0", stage: 0, status: "candidate", target: request.target, scope: request.scope || repos.map((repo) => repo.id).join(", "), repos, repositoryState: Array.isArray(request.repositoryState) ? request.repositoryState : [], tooling: Array.isArray(request.tooling) ? request.tooling : [], seeds: { direct, aliases: unique(seeds.aliases) }, expectedLayers: unique(request.expectedLayers), exclusions, limitations: unique(request.limitations), scanSeeds, scans };
  facts.output = { factsBytes: Buffer.byteLength(JSON.stringify(facts)), summaryBudget: Number(request.summaryBytes || 8192) };
  facts.summary = { stage: 0, status: facts.status, repos: facts.scans.map((scan) => ({ id: scan.id, status: scan.status, files: scan.totalFiles })), seeds: direct, output: { bytes: 0, budget: facts.output.summaryBudget } };
  facts.summary.output.bytes = Buffer.byteLength(JSON.stringify(facts.summary));
  if (facts.summary.output.bytes > facts.summary.output.budget) throw new Error("Stage 0 summary budget overflow");
  return facts;
}

function buildBundle(facts, outputDirectory) {
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output)) throw new Error(`Bundle destination already exists: ${output}`);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(output)}.tmp-${process.pid}`);
  fs.mkdirSync(temporary);
  try {
    const report = render(facts);
    fs.writeFileSync(path.join(temporary, "facts.json"), json(facts));
    fs.writeFileSync(path.join(temporary, "checks.json"), json({ schemaVersion: "1.0.0", stage: 0, checks: facts.scans.map((scan) => ({ id: scan.id, status: scan.status, scope: scan.path, terms: facts.seeds.direct, exclusions: facts.exclusions, candidateFiles: scan.files, totalFiles: scan.totalFiles, reason: scan.reason || null })) }));
    fs.writeFileSync(path.join(temporary, "summary.json"), json(facts.summary));
    fs.writeFileSync(path.join(temporary, "report.md"), report);
    const files = ["facts.json", "checks.json", "summary.json", "report.md"].map((name) => ({ path: name, bytes: fs.statSync(path.join(temporary, name)).size, sha256: hash(path.join(temporary, name)) }));
    fs.writeFileSync(path.join(temporary, "manifest.json"), json({ schemaVersion: "1.0.0", stage: 0, status: facts.status, scans: facts.scans.map((scan) => ({ id: scan.id, status: scan.status, totalFiles: scan.totalFiles })), artifacts: files }));
    fs.renameSync(temporary, output);
    return { stage: 0, status: facts.status, report: path.join(output, "report.md"), manifest: path.join(output, "manifest.json"), stdoutBytes: 0 };
  } catch (error) { if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true }); throw error; }
}

function main() {
  try {
    const args = process.argv.slice(2); const requestAt = args.indexOf("--request"); const bundleAt = args.indexOf("--bundle");
    if (requestAt < 0 || bundleAt < 0 || !args[requestAt + 1] || !args[bundleAt + 1]) throw new Error("Usage: --request <json> --bundle <new-directory>");
    const facts = runStage0(JSON.parse(fs.readFileSync(path.resolve(args[requestAt + 1]), "utf8")));
    const summary = buildBundle(facts, args[bundleAt + 1]); summary.stdoutBytes = Buffer.byteLength(`${JSON.stringify(summary)}\n`); process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) { process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`); process.exitCode = 2; }
}
if (require.main === module) main();
module.exports = { buildBundle, render, runStage0, scanRepo };
