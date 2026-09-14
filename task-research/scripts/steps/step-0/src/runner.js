"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const { resolveExecutionScope } = require("./execution_scope");
const { normalizeLimitations, limitationText } = require("../../../shared/artifacts/src/limitations.js");
const { runBounded } = require("../../../shared/execution/src/bounded_pool.js");
const { normalizeNewCoverageProfile } = require("../../../shared/report/src/model/coverage.js");

const RG_TIMEOUT_MS = 30000;

function unique(values = []) { return [...new Set(values.filter(Boolean).map(String))]; }

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function normalizeSearchConcurrency(value, repositoryCount) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new TypeError("searchConcurrency must be a positive integer");
  return Math.min(value === undefined ? 1 : value, repositoryCount);
}

function runRg(args, options, dependencies = {}) {
  const invoke = dependencies.spawn || spawn;
  const timeoutMs = dependencies.timeoutMs === undefined ? RG_TIMEOUT_MS : dependencies.timeoutMs;
  return new Promise((resolve) => {
    let child;
    try { child = invoke("rg", args, { ...options, shell: false, windowsHide: true }); }
    catch (error) { resolve({ error }); return; }
    let stderr = "";
    const files = [];
    let pending = "";
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stderr, files });
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      const lines = `${pending}${chunk}`.split(/\r?\n/);
      pending = lines.pop() || "";
      files.push(...lines.filter(Boolean));
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => { if (stderr.length < 65536) stderr += chunk.slice(0, 65536 - stderr.length); });
    child.once("error", (error) => finish({ error }));
    child.once("close", (status) => {
      if (pending) files.push(pending);
      finish({ status, timedOut });
    });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    timer.unref?.();
  });
}

async function scanRepo(repo, terms, exclusions = [], dependencies = {}) {
  const pattern = unique(terms).map(escapeRegex).join("|");
  if (!pattern) throw new Error("Stage 0 requires at least one seed term");
  const args = ["-l", "-i", "-e", pattern, "."];
  for (const exclusion of exclusions) args.push("-g", `!${exclusion}`);
  const result = await runRg(args, { cwd: repo.path }, dependencies);
  if (result.timedOut) return { id: repo.id, path: repo.path, status: "partial", reason: `rg timed out after ${dependencies.timeoutMs ?? RG_TIMEOUT_MS}ms`, files: [], totalFiles: 0 };
  if (result.error) return { id: repo.id, path: repo.path, status: result.error.code === "ENOENT" ? "tool-unavailable" : "partial", reason: result.error.message, files: [], totalFiles: 0 };
  if (![0, 1].includes(result.status)) return { id: repo.id, path: repo.path, status: "partial", reason: String(result.stderr || "rg failed").trim(), files: [], totalFiles: 0 };
  const files = result.files.filter(Boolean).map((file) => path.resolve(repo.path, file)).sort();
  return { id: repo.id, path: repo.path, status: files.length ? "candidate" : "candidate-empty", files, totalFiles: files.length };
}

function repositoryRules(facts) {
  return facts.repos.map((repo) => `${repo.id}: ${(repo.exclusions || []).join(", ") || "none"}`).join("; ");
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
    "skipped/forbidden": `${repositoryRules(facts)}; ${facts.limitations.map(limitationText).join("; ") || "source edits -> user-forbidden"}`,
    "open checks": "ownership, serializers, scenarios, recipients and paths begin at later stages",
    "next stage": "1 — Нижние слои и владение",
  };
}

function render(facts) {
  const next = transition(facts);
  const scanEnabled = facts.scanSeeds !== false;
  const lines = ["# Этап 0. Подготовка", "", "## Вход", "", `- Target: ${facts.target}.`, `- Mode: selected by the user and recorded in inventory-state.json.`, "", "## Действия", "", scanEnabled ? "- Выполнена диагностика и file-level exact seed scan без AST, source ranges или ownership expansion." : "- Зафиксированы диагностика, scope, seed dictionary и search plan; usage discovery не выполнялся.", "- GitNexus используется только как доступность/ограничение; отсутствие индекса не становится absence evidence.", "", "## Выход", "", "### Scope и seed dictionary", "", `- Репозитории: ${facts.repos.map((repo) => repo.id).join(", ")}.`, `- Прямые seed-термины: ${facts.seeds.direct.join(", ")}.`, `- Алиасы/форматные варианты: ${facts.seeds.aliases.join(", ") || "—"}.`, `- Ожидаемые слои: ${facts.expectedLayers.join(", ")}.`];
  lines.push(`- Исключения по репозиториям: ${repositoryRules(facts)}.`);
  if (facts.repositoryState.length) { lines.push("", "### Repository state", ""); for (const item of facts.repositoryState) lines.push(`- ${item.id}: ${item.state}`); }
  if (facts.tooling.length) { lines.push("", "### Tooling", ""); for (const item of facts.tooling) lines.push(`- ${item.id}: ${item.status}`); }
  lines.push("", "### File-level candidates", "", "| Repo | Статус | Файлы-кандидаты |", "|---|---|---:|");
  for (const scan of facts.scans) lines.push(`| ${scan.id} | ${scan.status} | ${scan.totalFiles} |`);
  lines.push("", "### Ограничения", "");
  for (const limitation of facts.limitations) lines.push(`- ${limitationText(limitation)}`);
  lines.push("", "## DoD", "", "- [x] Scope, exclusions, seed dictionary and expected layers recorded.", scanEnabled ? "- [x] Exact file-level seed scan completed without AST or ownership expansion." : "- [x] Strict Stage 0 records a content/file-name search plan; file-level usage discovery is deferred to Stage 1.", "- [x] Candidate results remain unconfirmed for Stage 1.", "", "## Статус этапа", "", "закрыт", "", "## Артефакт для следующего этапа", "");
  for (const [key, value] of Object.entries(next)) lines.push(`- ${key}: ${value}`);
  lines.push("", "## Следующий этап", "", "Этап 1 запускается согласно mode и driver из `inventory-state.json`: интерактивно или через активную цель.", "", "## Stage Execution Report", "", "- mode: read from inventory-state.json", "- driver: read from inventory-state.json", "- stages completed: 0 — Подготовка", "- stages completed this run: append stage 0 in state", scanEnabled ? "- evidence collected: scope, seed dictionary, exclusions, diagnostics and file-level candidate scan" : "- evidence collected: scope, seed dictionary, exclusions, diagnostics, repository/tool state and search plan", scanEnabled ? "- skipped/forbidden sources: AST/ownership/serializer analysis -> stage 1; source edits -> user-forbidden" : "- skipped/forbidden sources: usage discovery, AST/ownership/serializer analysis -> intentionally deferred to stage 1; source edits -> user-forbidden", "- open checks: stages 1–8", "- protocol deviations: none", "- next step: apply the recorded mode and driver for stage 1", "", "## Execution Status", "", "- Execution Status: complete", "- current stage: 0 — Подготовка", "- next step: 1 — Нижние слои и владение", "- continuation: interactive `продолжай` or active goal", "");
  return lines.join("\n");
}

async function runStage0(request, dependencies = {}) {
  if (Number(request && request.stage) !== 0) throw new Error("stage0_runner accepts only stage: 0");
  if (!request.coverageProfile) throw new Error("Stage 0 requires an explicit coverageProfile");
  const coverageProfile = normalizeNewCoverageProfile(request.coverageProfile);
  if (!Array.isArray(request.seeds?.direct) || !request.seeds.direct.length || request.seeds.direct.some(seed => typeof seed !== "string" || !seed.trim())) throw new Error("Stage 0 requires non-empty string seeds.direct");
  const executionScope = resolveExecutionScope(request);
  const { repos, exclusions } = executionScope;
  const seeds = request.seeds || {};
  const direct = unique(seeds.direct);
  if (!request.target || !direct.length) throw new Error("Stage 0 requires target, repositoryScope, and seeds.direct");
  const scanSeeds = request.scanSeeds !== false;
  const limitations = normalizeLimitations(request.limitations);
  const scans = scanSeeds
    ? await runBounded(repos, normalizeSearchConcurrency(request.searchConcurrency, repos.length), (repo) => scanRepo(repo, direct, repo.exclusions, dependencies))
    : repos.map((repo) => ({ id: repo.id, path: repo.path, status: "not-run", files: [], totalFiles: 0, reason: "Stage 0 strict mode records a search plan only" }));
  const facts = { schemaVersion: "1.0.0", stage: 0, status: "candidate", target: request.target, scope: request.scope || repos.map((repo) => repo.id).join(", "), repos, repositoryState: Array.isArray(request.repositoryState) ? request.repositoryState : [], tooling: Array.isArray(request.tooling) ? request.tooling : [], seeds: { direct, aliases: unique(seeds.aliases) }, expectedLayers: unique(request.expectedLayers), exclusions, limitations, scanSeeds, scans };
  facts.transition = { schemaVersion: "1.0.0", valid: true, missing: [], fields: { target: facts.target, scope: facts.scope, stage: "0", status: "closed", "confirmed evidence": scanSeeds ? "scope and exact file candidates" : "scope and search plan", "candidate evidence": scans.some((scan) => scan.totalFiles) ? "file-level candidates" : "none", "dictionary/graph/path state": "seed dictionary ready", "skipped/forbidden": repositoryRules(facts), "open checks": "stages 1-8", "next stage": "1" } };
  facts.repositoryScope = request.repositoryScope;
  facts.output = { factsBytes: Buffer.byteLength(JSON.stringify(facts)), summaryBudget: Number(request.summaryBytes || 8192) };
  facts.summary = { stage: 0, status: facts.status, coverageProfile, repos: facts.scans.map((scan) => ({ id: scan.id, status: scan.status, files: scan.totalFiles })), seeds: direct, output: { bytes: 0, budget: facts.output.summaryBudget } };
  facts.summary.executionScope = executionScope.descriptor;
  facts.summary.output.bytes = Buffer.byteLength(JSON.stringify(facts.summary));
  if (facts.summary.output.bytes > facts.summary.output.budget) throw new Error("Stage 0 summary budget overflow");
  return facts;
}

module.exports = { normalizeSearchConcurrency, render, runRg, runStage0, scanRepo };
