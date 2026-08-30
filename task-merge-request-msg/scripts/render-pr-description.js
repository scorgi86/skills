#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { REVIEW_DIMENSIONS } = require("./validate-artifacts");

function parseArgs(argv) {
  const args = { facts: null, analysisInput: null, draft: null, review: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--facts") args.facts = argv[++i];
    else if (arg === "--analysis-input") args.analysisInput = argv[++i];
    else if (arg === "--draft") args.draft = argv[++i];
    else if (arg === "--review") args.review = argv[++i];
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function bullets(values) {
  return unique(values).map((value) => `- ${value}`).join("\n");
}

function architectureValues(facts, side) {
  if (facts.architecture && Array.isArray(facts.architecture[side]) && facts.architecture[side].some(clean)) {
    const values = facts.architecture[side];
    if (side !== "after") return values;
    return values.flatMap((value) => {
      const combinesThresholdAndFlag = /(?:threshold|порог)/i.test(value) &&
        /(?:feature[\s-]*flags?|фич[аеи]?-?флаг)/i.test(value);
      const supportedAsOneMechanism = facts.items.some((item) =>
        /(?:threshold|порог)/i.test(item.statement) && /(?:feature[\s-]*flags?|фич[аеи]?-?флаг)/i.test(item.statement));
      if (!combinesThresholdAndFlag || supportedAsOneMechanism) return [value];
      const thresholdItem = facts.items.find((item) => ["change", "rule", "contract"].includes(item.kind) &&
        /(?:threshold|порог)/i.test(item.statement));
      const flagItem = facts.items.find((item) => item.kind === "feature_flag");
      const replacements = [thresholdItem, flagItem].filter(Boolean).map((item) => item.statement);
      return replacements.length ? replacements : [value];
    });
  }
  if (side === "before") return [facts.summary.problem];
  return [facts.summary.solution, facts.summary.outcome];
}

function evidenceText(item) {
  return (item.evidence || []).map((evidence) => clean(evidence.quote)).filter(Boolean).join("\n");
}

function enrichRuleStatement(item) {
  let statement = clean(item.statement);
  if (item.kind !== "rule") return statement;
  const source = evidenceText(item);
  const assignments = [];
  for (const match of source.matchAll(/\b(threshold|[A-Za-z_$][\w$]*(?:Thresholds?|Limit|Timeout))\s*:\s*(\[[^\]]+\]|-?\d+(?:\.\d+)?)/gi)) {
    assignments.push(`${match[1]}=${match[2]}`);
  }
  const missingAssignments = unique(assignments).filter((value) => {
    const assignmentValue = value.slice(value.indexOf("=") + 1);
    return !statement.includes(assignmentValue);
  });
  if (missingAssignments.length) {
    statement = `${statement.replace(/[.;:]$/, "")}: ${missingAssignments.join("; ")}`;
  }
  const normalized = source.replace(/\s+/g, " ");
  const formula = normalized.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/);
  if (formula && !statement.includes(`${formula[1]} =`)) {
    statement = `${statement.replace(/[.;:]$/, "")}; ${formula[1]} = ${formula[2].trim()}`;
  }
  return statement;
}

function uncoveredCandidateLines(facts, analysisInput) {
  if (!analysisInput || !Array.isArray(analysisInput.candidates)) return [];
  const productionPaths = new Set((analysisInput.files || []).filter((file) => !file.test && !file.binary && !file.generated)
    .map((file) => file.path));
  const factText = facts.items.map((item) => item.statement).join("\n");
  const callbackCandidates = [];
  const featureFlags = [];
  for (const candidate of analysisInput.candidates) {
    const [type, value, candidatePath, line] = candidate;
    if (!productionPaths.has(candidatePath)) continue;
    if (type === "callback_value") callbackCandidates.push({ value, path: candidatePath, line });
    if (type === "feature_flag" && !factText.includes(value)) featureFlags.push(value);
  }
  const lines = [];
  callbackCandidates.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const groups = [];
  for (const item of callbackCandidates) {
    const group = groups[groups.length - 1];
    if (!group || group.path !== item.path || item.line - group.lastLine > 3) {
      groups.push({ path: item.path, firstLine: item.line, lastLine: item.line, values: [item.value] });
    } else {
      group.lastLine = item.line;
      group.values.push(item.value);
    }
  }
  const emittedCallbackValues = new Set();
  for (const group of groups) {
    const values = unique(group.values).filter((value) => !emittedCallbackValues.has(value));
    if (!values.length) continue;
    values.forEach((value) => emittedCallbackValues.add(value));
    lines.push(`Callback values (${group.path}:${group.firstLine}): ${values.map((value) => `\`${value}\``).join(", ")}`);
  }
  if (featureFlags.length) lines.push(`Feature flags: ${unique(featureFlags).map((value) => `\`${value}\``).join(", ")}`);
  return lines;
}

function render(facts, analysisInput) {
  if (!facts || facts.schema_version !== 1 || !facts.summary || !Array.isArray(facts.items)) {
    throw new Error("facts.json does not match schema version 1.");
  }
  const suppliedTitle = clean(facts.title);
  const title = suppliedTitle && /\s/.test(suppliedTitle) ? suppliedTitle : clean(facts.summary.solution) || "Описание изменений";
  const sections = [
    `# ${title}`,
    "",
    "## Контекст задачи",
    "",
    clean(facts.summary.problem),
    "",
    clean(facts.summary.outcome),
    "",
    "## Архитектура решения",
    "",
    "### Как было",
    "",
    bullets(architectureValues(facts, "before")),
    "",
    "### Как стало",
    "",
    bullets(architectureValues(facts, "after"))
  ];

  let changes = facts.items.filter((item) => ["change", "contract"].includes(item.kind));
  const usedFallbackChanges = changes.length === 0;
  if (usedFallbackChanges) changes = facts.items.filter((item) => ["flow", "feature_flag"].includes(item.kind));
  const mechanics = facts.items.filter((item) => item.kind === "rule" ||
    (!usedFallbackChanges && ["flow", "feature_flag"].includes(item.kind)));
  const reasons = unique(facts.items.filter((item) =>
    !["test_added", "test_updated", "test_removed", "check_run", "context"].includes(item.kind))
    .map((item) => item.impact));
  const testsAdded = facts.items.filter((item) => item.kind === "test_added");
  const testsUpdated = facts.items.filter((item) => item.kind === "test_updated");
  const testsRemoved = facts.items.filter((item) => item.kind === "test_removed");
  const checksRun = facts.items.filter((item) => item.kind === "check_run");

  if (changes.length) sections.push("", "## Что изменено", "", bullets(changes.map((item) => item.statement)));
  if (reasons.length) sections.push("", "## Почему изменено", "", bullets(reasons));
  const mechanicLines = mechanics.map(enrichRuleStatement).concat(uncoveredCandidateLines(facts, analysisInput));
  if (mechanicLines.length) sections.push("", "## Как работает", "", bullets(mechanicLines));
  sections.push("", "## Что проверено", "");
  sections.push("Изменения тестового покрытия:", "");
  sections.push("Добавлены:", testsAdded.length ? bullets(testsAdded.map((item) => item.statement)) : "- Нет", "");
  sections.push("Обновлены:", testsUpdated.length ? bullets(testsUpdated.map((item) => item.statement)) : "- Нет", "");
  sections.push("Удалены:", testsRemoved.length ? bullets(testsRemoved.map((item) => item.statement)) : "- Нет", "");
  if (checksRun.length) sections.push("Выполнены проверки:", "", bullets(checksRun.map((item) => item.statement)));
  else sections.push("Автоматические проверки в рамках подготовки описания не запускались.");
  return `${sections.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n").trim()}\n`;
}

function editorialReview(draft, facts) {
  const issues = [];
  const summary = facts.summary || {};
  for (const field of ["problem", "solution", "outcome"]) {
    if (!clean(summary[field])) {
      issues.push({
        id: `E-${field}`, category: "reader_clarity", severity: "must_fix", owner: "analyze",
        location: `summary.${field}`, problem: `Required summary field is empty: ${field}.`, operation: "rewrite",
        replacement: `Provide a concrete ${field}.`, fact_ids: []
      });
    }
  }
  const statements = facts.items.map((item) => clean(item.statement)).filter(Boolean);
  const duplicates = statements.filter((value, index) => statements.indexOf(value) !== index);
  if (duplicates.length) {
    issues.push({
      id: "E-duplicates", category: "conciseness", severity: "must_fix", owner: "analyze",
      location: "facts.items", problem: "Facts contain duplicate statements.", operation: "merge",
      replacement: "Merge duplicate facts before rendering.", fact_ids: facts.items.filter((item) => duplicates.includes(clean(item.statement))).map((item) => item.id)
    });
  }
  const vague = /\bminor changes\b|\bvarious improvements\b|незначительные изменения|различные улучшения/i;
  if (vague.test(draft)) {
    issues.push({
      id: "E-vague", category: "semantic_precision", severity: "must_fix", owner: "analyze",
      location: "draft", problem: "Draft contains a vague unsupported phrase.", operation: "rewrite",
      replacement: "Replace the phrase with a concrete behavior change.", fact_ids: []
    });
  }
  if (draft.length > 16000) {
    issues.push({
      id: "E-length", category: "conciseness", severity: "must_fix", owner: "render",
      location: "draft", problem: "Draft exceeds the 16000-character editorial budget.", operation: "shorten",
      replacement: "Remove low-impact details and repeated rationale.", fact_ids: []
    });
  }
  const failed = new Set(issues.map((issue) => issue.category));
  const dimensions = Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, failed.has(dimension) ? "fail" : "pass"]));
  return {
    schema_version: 1,
    iteration: 1,
    draft_sha256: crypto.createHash("sha256").update(draft).digest("hex"),
    passed: issues.length === 0,
    mode: "deterministic",
    dimensions,
    issues
  };
}

function runSelfTest() {
  const facts = {
    schema_version: 1,
    title: "Feature flag support",
    summary: { problem: "The behavior was always enabled.", solution: "Added a feature flag.", outcome: "The host can disable it." },
    architecture: { before: ["The API had no guard."], after: ["The API checks the flag before continuing."] },
    items: [
      { id: "C1", kind: "change", statement: "Added the feature flag check.", impact: "The rollout is controllable.", evidence: [] },
      { id: "T1", kind: "test_added", statement: "Covered enabled and disabled states.", impact: "", evidence: [] }
    ],
    unknowns: []
  };
  const draft = render(facts);
  const review = editorialReview(draft, facts);
  if (!draft.includes("## Архитектура решения") || !draft.includes("Автоматические проверки") || !review.passed) {
    throw new Error("Self-test failed: deterministic render is invalid.");
  }
  const badFacts = JSON.parse(JSON.stringify(facts));
  badFacts.items.push({ ...badFacts.items[0], id: "C2" });
  if (editorialReview(render(badFacts), badFacts).passed) {
    throw new Error("Self-test failed: duplicate facts passed editorial review.");
  }
  const mechanismFacts = JSON.parse(JSON.stringify(facts));
  mechanismFacts.architecture.after = ["Thresholds are configured through feature flags."];
  mechanismFacts.items = [
    { id: "R1", kind: "rule", statement: "Threshold: 7.", impact: "", evidence: [] },
    { id: "F1", kind: "feature_flag", statement: "Feature flag enables the warning.", impact: "", evidence: [] }
  ];
  const mechanismDraft = render(mechanismFacts, {
    files: [{ path: "src/a.js", test: false, binary: false, generated: false }],
    candidates: [
      ["callback_value", "recalculate", "src/a.js", 10],
      ["callback_value", "switchToManual", "src/a.js", 10]
    ]
  });
  if (mechanismDraft.includes("configured through feature flags") ||
      !mechanismDraft.includes("`recalculate`, `switchToManual`")) {
    throw new Error("Self-test failed: mechanisms or callback values were rendered incorrectly.");
  }
  process.stdout.write("Self-test passed.\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  if (!args.facts || !args.draft || !args.review) {
    throw new Error("Use --facts <facts.json> --draft <draft.md> --review <editorial-review.json>.");
  }
  const facts = readJson(path.resolve(args.facts));
  const draft = render(facts, args.analysisInput ? readJson(path.resolve(args.analysisInput)) : null);
  const review = editorialReview(draft, facts);
  fs.writeFileSync(path.resolve(args.draft), draft, "utf8");
  fs.writeFileSync(path.resolve(args.review), `${JSON.stringify(review, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ draft: path.resolve(args.draft), review: path.resolve(args.review),
    passed: review.passed }, null, 2)}\n`);
  if (!review.passed) process.exitCode = 1;
}

module.exports = { editorialReview, render };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
