#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { assertHumanReadableMarkdown, decodeHumanFields, humanGroupName } = require("./human_report_codec");
const { resolveCompactAnchor } = require("./summary_compaction");

function text(value) {
  return String(value === undefined || value === null ? "" : value);
}

function escapeCell(value) {
  return text(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function sourceAnchor(container, match) {
  if (!match) return "";
  const resolved = match.fileId !== undefined ? resolveCompactAnchor(container, match) : match;
  const line = resolved.line || resolved.range && resolved.range.start && resolved.range.start.line;
  return line ? `${resolved.file}:${line}` : text(resolved.file);
}

function humanQueryName(result) {
  const terms = result.label || result.projectionHints && result.projectionHints.preferredTerms || result.options && (result.options.terms || result.options.symbol || result.options.field);
  return terms ? `${text(result.command)}: ${text(terms)}` : text(result.id || result.command);
}

function buildReportModel(input) {
  const facts = decodeHumanFields(input);
  if (!facts || Number(facts.stage) !== 2) throw new Error("Renderer requires stage 2 facts");
  const astResults = facts.ast && (facts.ast.results || facts.ast.queries);
  const evidenceChecks = facts.sourceEvidence && (facts.sourceEvidence.checks || facts.sourceEvidence);
  if (!Array.isArray(astResults)) throw new Error("Renderer requires ast.results or ast.queries");
  if (!Array.isArray(evidenceChecks)) throw new Error("Renderer requires sourceEvidence checks");

  const queries = astResults.map((result) => ({
    name: humanQueryName(result),
    command: text(result.command),
    status: text(result.status),
    coverage: { ...(result.coverage || {}) },
  })).sort((left, right) => left.name.localeCompare(right.name));

  const groups = astResults.flatMap((result) => (result.groups || []).map((group) => ({
    query: humanQueryName(result),
    status: "candidate",
    owner: text(group.owner),
    relation: text(group.relation),
    field: text(group.field),
    target: text(group.target),
    usagePath: humanGroupName(group),
    anchor: sourceAnchor(facts, group.firstAnchor || group.example),
    items: Number(group.items) || 0,
    evidence: Number(group.evidence) || 0,
  }))).sort((left, right) => `${left.usagePath}:${left.relation}:${left.anchor}`.localeCompare(`${right.usagePath}:${right.relation}:${right.anchor}`));

  const sourceChecks = evidenceChecks.map((check) => ({
    name: text(check.label || check.id || "source check"),
    status: text(check.status),
    filesScanned: Number(check.filesScanned) || 0,
    totalMatches: Number(check.totalMatches) || 0,
    returned: Number(check.returned) || 0,
    truncated: Boolean(check.truncated),
  })).sort((left, right) => left.name.localeCompare(right.name));

  const sourceMatches = evidenceChecks.flatMap((check) => (check.matches || []).map((match) => ({
    check: text(check.label || check.id || "source check"),
    status: "source-match",
    anchor: sourceAnchor(facts, match),
    snippet: text(match.snippet),
  }))).sort((left, right) => `${left.anchor}:${left.check}`.localeCompare(`${right.anchor}:${right.check}`));

  return {
    schemaVersion: "1.0.0",
    stage: 2,
    status: text(facts.status),
    transition: facts.transition,
    quality: { ...(facts.quality || {}) },
    output: { ...(facts.output || {}) },
    queries,
    groups,
    sourceChecks,
    sourceMatches,
    notices: [
      "AST groups are candidates, not confirmed usage.",
      "A source match confirms text at an anchor; it does not promote a candidate by itself.",
      "Empty, stale, partial, or truncated results are not absence evidence.",
    ],
  };
}

function markdownTable(headers, rows) {
  const lines = [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) lines.push(`| ${row.map(escapeCell).join(" | ")} |`);
  return lines.join("\n");
}

function renderMarkdown(model) {
  const lines = [
    "# Stage 2 Facts Report",
    "",
    `Status: ${model.status}`,
    "",
    "## Safety notices",
    "",
    ...model.notices.map((notice) => `- ${notice}`),
    "",
    "## Query coverage",
    "",
    markdownTable(
      ["Query", "Command", "Status", "Groups scanned", "Groups matched", "Groups returned", "Details requested", "Details returned", "Details suppressed"],
      model.queries.map((query) => [
        query.name,
        query.command,
        query.status,
        query.coverage.groupsScanned,
        query.coverage.groupsMatched,
        query.coverage.groupsReturned,
        query.coverage.detailsRequested,
        query.coverage.detailsReturned,
        query.coverage.detailsSuppressed,
      ]),
    ),
    "",
    "## AST candidate groups",
    "",
    markdownTable(
      ["Status", "Usage path", "Relation", "Source", "Items", "Evidence"],
      model.groups.map((group) => [group.status, group.usagePath, group.relation, group.anchor, group.items, group.evidence]),
    ),
    "",
    "## Source checks",
    "",
    markdownTable(
      ["Check", "Status", "Files", "Total", "Returned", "Truncated"],
      model.sourceChecks.map((check) => [check.name, check.status, check.filesScanned, check.totalMatches, check.returned, check.truncated]),
    ),
    "",
    "## Source matches",
    "",
    markdownTable(
      ["Status", "Check", "Anchor", "Snippet"],
      model.sourceMatches.map((match) => [match.status, match.check, match.anchor, match.snippet]),
    ),
    "",
    "## Quality",
    "",
    "```json",
    JSON.stringify(model.quality, null, 2),
    "```",
    "",
  ];
  const markdown = `${lines.join("\n")}\n`;
  assertHumanReadableMarkdown(markdown);
  return markdown;
}

function renderStage2Report(facts, format = "markdown") {
  const model = buildReportModel(facts);
  if (format === "json") return `${JSON.stringify(model, null, 2)}\n`;
  if (format === "markdown") return renderMarkdown(model);
  throw new Error("format must be markdown or json");
}

function renderStage2BundleReport({ facts, findings, transition, artifacts, maxFindings = 60 }) {
  const astResults = facts.ast && (facts.ast.results || facts.ast.queries) || [];
  const sourceChecks = facts.sourceEvidence && (facts.sourceEvidence.checks || facts.sourceEvidence) || [];
  const parseCounts = facts.ast && facts.ast.stats && facts.ast.stats.parseCounts || {};
  const coveragePassed = Boolean(facts.quality && facts.quality.coverageGate && facts.quality.coverageGate.ok);
  const stageStatus = coveragePassed ? "закрыт" : "частично";
  const selected = findings.slice(0, Math.max(1, Number(maxFindings) || 60));
  const artifactRows = [
    ["manifest.json", "Manifest, версии и контрольные суммы", "—", "—", "—", "[Открыть](./manifest.json)"],
    ...artifacts.map((artifact) => [artifact.path, artifact.purpose, artifact.records === null ? "—" : artifact.records, artifact.bytes, artifact.sha256.slice(0, 16), `[Открыть](./${artifact.path})`]),
  ];
  const transitionFields = transition.fields || {};
  const lines = [
    "# Этап 2 — словарь и карта связей",
    "",
    "Отчёт полностью сформирован детерминированным скриптом из сохранённых facts и evidence.",
    "",
    "## Вход",
    "",
    `- Target: ${transitionFields.target || "не задан"}.`,
    `- Scope: ${transitionFields.scope || "не задан"}.`,
    `- AST plan: ${facts.runtime && facts.runtime.planId || "не задан"}.`,
    `- Cache: ${facts.runtime && facts.runtime.cache && facts.runtime.cache.enabled ? "enabled" : "disabled/not configured"}.`,
    "",
    "## Пайплайн обработки этапа",
    "",
    "```mermaid",
    "flowchart LR",
    "    A[\"Свежий поиск и transition\"] --> B[\"Компиляция AST-плана\"]",
    "    B --> C[\"SWC: один parse файла\"]",
    "    C --> D[\"Полные facts\"]",
    "    D --> E[\"Source confirmation\"]",
    "    E --> F[\"Findings и evidence\"]",
    "    F --> G[\"Coverage gate\"]",
    "    G --> H[\"Отчёт и artifact bundle\"]",
    "    H --> I[\"Валидация ссылок и SHA-256\"]",
    "    I --> J[\"Компактный stdout\"]",
    "```",
    "",
    "## Действия",
    "",
    `- Выполнено AST-запросов: ${astResults.length}.`,
    `- Выполнено source checks: ${sourceChecks.length}.`,
    `- Уникальных разобранных файлов: ${Object.keys(parseCounts).length}.`,
    `- Повторных разборов: ${Object.values(parseCounts).filter((count) => count !== 1).length}.`,
    `- Coverage gate: ${coveragePassed ? "passed" : "failed/partial"}.`,
    "",
    "## Выход",
    "",
    `Сформировано агрегированных находок: ${findings.length}. В таблице показано не более ${selected.length}; полные данные доступны через артефакты и query-скрипт.`,
    "",
    markdownTable(
      ["Status", "Owner", "Relation", "Field", "Target", "Source"],
      selected.map((finding) => [finding.status, finding.owner, finding.relation, finding.field, finding.target, sourceAnchor(facts, finding.source)]),
    ),
    "",
    "Кандидаты не повышаются до подтверждённых автоматически. Source matches и AST-группы сохранены раздельно.",
    "",
    "## Артефакты",
    "",
    markdownTable(["Файл", "Назначение", "Записей", "Байт", "SHA-256", "Ссылка"], artifactRows),
    "",
    "Человекочитаемые выборки: [владение](./evidence-view/ownership.md), [сохранение](./evidence-view/persistence.md), [получатели](./evidence-view/recipients.md).",
    "",
    "## DoD",
    "",
    `- [${coveragePassed ? "x" : " "}] Coverage gate пройден.`,
    `- [${Object.values(parseCounts).every((count) => count === 1) ? "x" : " "}] Каждый файл разобран один раз.`,
    "- [x] Facts, findings и evidence сохранены раздельно.",
    "- [x] Отчёт содержит схему фактически выполненного пайплайна.",
    "- [x] Отчёт содержит относительные ссылки на доказательную базу.",
    "- [x] Кандидаты не повышены до confirmed генератором.",
    "",
    "## Статус этапа",
    "",
    `\`${stageStatus}\``,
    "",
    "## Артефакт для следующего этапа",
    "",
    ...Object.entries(transitionFields).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Следующий этап",
    "",
    "Этап 3 запускается согласно mode и driver из `inventory-state.json`: интерактивно или через активную цель.",
    "",
    "## Stage Execution Report",
    "",
    "- mode: read from inventory-state.json",
    "- driver: read from inventory-state.json",
    "- stages completed: 2 — dictionary and relation expansion",
    "- stages completed this run: append stage 2 after successful advance",
    "- stage artifacts: linked in the artifact table above",
    `- evidence collected: ${findings.length} findings; source and AST evidence stored separately`,
    `- skipped/forbidden sources: ${transitionFields["skipped/forbidden"] || "see transition.json"}`,
    `- open checks: ${transitionFields["open checks"] || "see transition.json"}`,
    "- protocol deviations: none recorded by the generator",
    "- next step: apply the recorded mode and driver for stage 3",
    "",
  ];
  const markdown = `${lines.join("\n")}\n`;
  assertHumanReadableMarkdown(markdown);
  const budget = facts.runtime && facts.runtime.budgets && facts.runtime.budgets.reportBytes;
  if (budget && Buffer.byteLength(markdown, "utf8") > budget) throw new Error(`Generated report exceeds reportBytes budget: ${Buffer.byteLength(markdown, "utf8")} > ${budget}`);
  return markdown;
}

function parseArgs(argv) {
  const options = { format: "markdown", stdout: "full" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--input", "--output", "--format", "--stdout"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = argv[++index];
  }
  if (!options.input) throw new Error("Provide --input <stage2-facts.json>");
  if (!["markdown", "json"].includes(options.format)) throw new Error("format must be markdown or json");
  if (!["full", "summary"].includes(options.stdout)) throw new Error("stdout must be full or summary");
  if (options.stdout === "summary" && !options.output) throw new Error("--stdout summary requires --output");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const facts = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
    const output = renderStage2Report(facts, options.format);
    const artifact = options.output ? path.resolve(options.output) : null;
    if (artifact) fs.writeFileSync(artifact, output);
    if (options.stdout === "summary") {
      process.stdout.write(`${JSON.stringify({ status: "rendered", format: options.format, artifact, bytes: Buffer.byteLength(output, "utf8") })}\n`);
    } else {
      process.stdout.write(output);
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { buildReportModel, parseArgs, renderMarkdown, renderStage2BundleReport, renderStage2Report };
