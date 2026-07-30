#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const FAST_FACTS_VERSION = 3;

function parseArgs(argv) {
  const args = { input: null, scope: null, output: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--scope") args.scope = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function candidateObjects(input) {
  return (input.candidates || []).map((item) => Array.isArray(item) ?
    { type: item[0], value: item[1], path: item[2], line: item[3] } : item);
}

function evidenceFor(input, candidate) {
  const file = (input.files || []).find((item) => item.path === candidate.path);
  const entry = file && (file.evidence || []).find((item) => {
    const line = Array.isArray(item) ? item[1] : item.line;
    const text = Array.isArray(item) ? item[2] : item.text;
    return line === candidate.line && clean(text).includes(candidate.value);
  });
  const quote = entry && (Array.isArray(entry) ? entry[2] : entry.text);
  return quote ? [{ repository: input.source.repository, path: candidate.path,
    line: candidate.line, quote: clean(quote), ...(candidate.type === "symbol" ? { symbol: candidate.value } : {}) }] : [];
}

function taskId(branch) {
  const match = clean(branch).match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return match ? match[1] : null;
}

function usefulSubject(repository) {
  const subjects = repository.commit_subjects || [];
  const ticket = taskId(repository.branch);
  return subjects.find((subject) => ticket && subject.includes(ticket) && !/\b(?:merge|conflict|draft)\b/i.test(subject)) ||
    subjects.find((subject) => !/\b(?:merge|conflict|draft)\b|конфликт/i.test(subject)) || null;
}

function addItem(items, kind, id, statement, impact, evidence) {
  if (!statement || !evidence.length) return;
  items.push({ id, kind, statement, impact, evidence });
}

function buildFastFacts(input, scope) {
  if (!input || input.schema_version !== 1 || !scope || !Array.isArray(scope.repositories)) {
    throw new Error("Fast facts require schema-version-1 analysis input and scope.");
  }
  const repository = scope.repositories[0];
  const files = input.files || [];
  const productionPaths = new Set(files.filter((file) => !file.test && !file.binary && !file.generated).map((file) => file.path));
  const candidates = candidateObjects(input);
  const production = candidates.filter((item) => productionPaths.has(item.path));
  const items = [];

  for (const filePath of productionPaths) {
    const fileSymbols = production.filter((item) => item.path === filePath && item.type === "symbol" && !item.value.includes(".prototype."));
    const symbols = unique(fileSymbols.map((item) => item.value)).slice(0, 6);
    const first = fileSymbols[0];
    if (first) addItem(items, "change", `file-${items.length + 1}`,
      `В ${filePath} добавлены или изменены точки реализации: ${symbols.map((value) => `\`${value}\``).join(", ")}.`,
      "Локализует основные точки изменения для ревью.", evidenceFor(input, first));
  }

  const typed = [
    ["feature_flag", "feature_flag", "Добавлена проверка feature flag", "Позволяет управлять доступностью нового поведения."],
    ["event", "contract", "Добавлен или изменен UI-событийный контракт", "Связывает измененную логику с ее получателем."],
    ["callback_value", "contract", "Зафиксировано значение callback", "Определяет поддерживаемый результат пользовательского выбора."]
  ];
  for (const [type, kind, prefix, impact] of typed) {
    const selected = unique(production.filter((item) => item.type === type).map((item) => `${item.value}\0${item.path}`)).slice(0, 10);
    for (const key of selected) {
      const [value, filePath] = key.split("\0");
      const candidate = production.find((item) => item.type === type && item.value === value && item.path === filePath);
      addItem(items, kind, `${type}-${items.length + 1}`, `${prefix} \`${value}\` в ${filePath}.`, impact, evidenceFor(input, candidate));
    }
  }

  const rules = production.filter((item) => item.type === "rule" &&
    /(?:threshold|limit|timeout|weight|score|mode|порог|вес|режим)/i.test(item.value)).slice(0, 8);
  for (const candidate of rules) addItem(items, "rule", `rule-${items.length + 1}`,
    `Изменено правило: \`${candidate.value}\`.`, "Определяет вычисление или условие нового поведения.", evidenceFor(input, candidate));

  const tests = [];
  for (const file of files.filter((item) => item.test)) {
    let fileTests = candidates.filter((item) => ["test_added", "test_updated", "test_removed"].includes(item.type) &&
      item.path === file.path && /\b(?:describe|it|test)\s*\(/.test((evidenceFor(input, item)[0] || {}).quote || "")).slice(0, 8);
    if (!fileTests.length && (file.evidence || []).length) {
      const entry = file.evidence[0];
      const line = Array.isArray(entry) ? entry[1] : entry.line;
      const value = clean(Array.isArray(entry) ? entry[2] : entry.text);
      fileTests = [{ type: `test_${file.change || "updated"}`, value, path: file.path, line }];
    }
    tests.push(...fileTests);
  }
  const testLabels = { test_added: "Добавлен", test_updated: "Обновлен", test_removed: "Удален" };
  for (const candidate of tests) addItem(items, candidate.type, `test-${items.length + 1}`,
    `${testLabels[candidate.type]} тест «${candidate.value}».`, "Фиксирует изменение тестового покрытия в diff.", evidenceFor(input, candidate));

  const subject = usefulSubject(repository);
  const changedPaths = files.map((file) => file.path);
  const keySymbols = unique(production.filter((item) => item.type === "symbol" && !item.value.includes(".prototype."))
    .map((item) => item.value)).slice(0, 5);
  const context = subject || `Изменения ветки ${repository.branch} относительно ${repository.base}`;
  const solution = keySymbols.length ? `Обновлены ${keySymbols.map((value) => `\`${value}\``).join(", ")}.` :
    `Обновлены файлы: ${changedPaths.slice(0, 5).join(", ")}.`;
  const after = items.filter((item) => !["test_added", "test_updated", "test_removed"].includes(item.kind)).slice(0, 6).map((item) => item.statement);
  const deepReasons = [];
  if (input.truncation && input.truncation.truncated) deepReasons.push("analysis_input_truncated");
  if (!production.length) deepReasons.push("no_production_candidates");
  if (files.some((file) => file.binary) && !production.length) deepReasons.push("binary_only_or_insufficient_text_evidence");

  return {
    facts: {
      schema_version: 1,
      title: subject || `Изменения ${repository.name}: ${taskId(repository.branch) || repository.branch}`,
      summary: {
        problem: context,
        solution,
        outcome: `Изменено файлов: ${changedPaths.length}; измененных тестовых сценариев: ${tests.length}.`
      },
      architecture: {
        before: [`До изменений использовалось поведение базовой ветки ${repository.base}.`],
        after: after.length ? after : [solution]
      },
      items,
      unknowns: subject ? [] : ["Бизнес-мотивация не определяется однозначно из Git diff."]
    },
    deep_recommended: deepReasons.length > 0,
    deep_reasons: deepReasons,
    generator_version: FAST_FACTS_VERSION
  };
}

function runSelfTest() {
  const input = {
    schema_version: 1, source: { repository: "repo" }, truncation: { truncated: false },
    candidates: [["symbol", "run", "src/a.js", 10], ["feature_flag", "flagA", "src/a.js", 11],
      ["callback_value", "continue", "src/a.js", 12], ["test", "runs", "src/a.test.js", 3]],
    files: [
      { path: "src/a.js", test: false, binary: false, generated: false,
        evidence: [["+", 10, "Api.prototype.run = function() {}"], ["+", 11, "Features.isEnabled(\"flagA\")"],
          ["+", 12, "callback(\"continue\")"]] },
      { path: "src/a.test.js", test: true, change: "added", binary: false, generated: false, evidence: [["+", 3, "it(\"runs\", test)"]] }
    ]
  };
  const scope = { repositories: [{ name: "repo", branch: "feature/ABC-1-fast", base: "main",
    commit_subjects: ["ABC-1: Add fast facts"] }] };
  const result = buildFastFacts(input, scope);
  if (result.deep_recommended || result.facts.items.length !== 4 || !result.facts.title.includes("ABC-1")) {
    throw new Error("Self-test failed: fast facts were not built.");
  }
  process.stdout.write("Self-test passed.\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  if (!args.input || !args.scope || !args.output) throw new Error("Use --input, --scope and --output.");
  const result = buildFastFacts(JSON.parse(fs.readFileSync(path.resolve(args.input), "utf8")),
    JSON.parse(fs.readFileSync(path.resolve(args.scope), "utf8")));
  fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ output: path.resolve(args.output), deep_recommended: result.deep_recommended }, null, 2)}\n`);
}

module.exports = { FAST_FACTS_VERSION, buildFastFacts };

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
