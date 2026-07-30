#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { REVIEW_DIMENSIONS } = require("./validate-artifacts");
const { editorialReview } = require("./render-pr-description");
const QUALITY_CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "references", "quality-contract.json"), "utf8"));

function sectionBody(draft, heading) {
  const marker = `## ${heading}`;
  const start = draft.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const next = draft.indexOf("\n## ", bodyStart);
  return draft.slice(bodyStart, next < 0 ? draft.length : next).trim();
}

function bulletLines(value) {
  return value.split(/\r?\n/).filter((line) => /^-\s+/.test(line));
}

function addIssue(issues, issue) {
  if (!issues.some((item) => item.id === issue.id)) issues.push(issue);
}

function lint(draft, facts) {
  const base = editorialReview(draft, facts);
  const issues = base.issues.slice();
  for (const heading of QUALITY_CONTRACT.required_sections) {
    const marker = heading === "Как было" || heading === "Как стало" ? `### ${heading}` : `## ${heading}`;
    if (!draft.includes(marker)) addIssue(issues, {
      id: `L-section-${heading}`, category: "reader_clarity", severity: "must_fix", owner: "render",
      location: heading, problem: `Missing required section: ${heading}.`, operation: "insert",
      replacement: `Add section ${heading}.`, fact_ids: []
    });
  }

  const rationale = bulletLines(sectionBody(draft, "Почему изменено"));
  if (rationale.length > QUALITY_CONTRACT.rationale_bullets.max) addIssue(issues, {
    id: "L-rationale-length", category: "conciseness", severity: "must_fix", owner: "render",
    location: "Почему изменено", problem: `Rationale has ${rationale.length} bullets; group them into at most ${QUALITY_CONTRACT.rationale_bullets.max} causes.`,
    operation: "merge", replacement: "Group rationale by behavior, reliability, controllability, compatibility, and verification.", fact_ids: []
  });

  const title = (draft.match(/^#\s+(.+)$/m) || [])[1] || "";
  const contextFirst = sectionBody(draft, "Контекст задачи").split(/\r?\n/).find((line) => line.trim()) || "";
  if (title && contextFirst.replace(/\s+/g, " ").trim() === title.replace(/\s+/g, " ").trim()) addIssue(issues, {
    id: "L-context-title", category: "reader_clarity", severity: "must_fix", owner: "render",
    location: "Контекст задачи", problem: "Context repeats the title instead of stating the problem.",
    operation: "rewrite", replacement: "State the previous limitation and its user or system impact.", fact_ids: []
  });

  const allBullets = bulletLines(draft).map((line) => line.replace(/^-\s+/, "").trim());
  const duplicates = allBullets.filter((value, index) => allBullets.indexOf(value) !== index);
  if (duplicates.length) addIssue(issues, {
    id: "L-cross-section-duplicates", category: "conciseness", severity: "must_fix", owner: "render",
    location: "draft", problem: "The same bullet is repeated across sections.", operation: "delete",
    replacement: "Keep each fact in one primary section and replace architecture duplicates with flow-level wording.", fact_ids: []
  });

  const failed = new Set(issues.map((issue) => issue.category));
  return {
    schema_version: 1,
    iteration: 1,
    draft_sha256: crypto.createHash("sha256").update(draft).digest("hex"),
    passed: issues.length === 0,
    mode: "deterministic",
    dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, failed.has(dimension) ? "fail" : "pass"])),
    issues
  };
}

function runSelfTest() {
  const facts = { schema_version: 1, title: "Title", summary: { problem: "p", solution: "s", outcome: "o" },
    architecture: { before: ["before"], after: ["after"] }, items: [], unknowns: [] };
  const draft = "# Title\n\n## Контекст задачи\n\nTitle\n\n## Архитектура решения\n\n### Как было\n\n- before\n\n### Как стало\n\n- after\n\n## Что изменено\n\n- c\n\n## Почему изменено\n\n- 1\n- 2\n- 3\n- 4\n- 5\n- 6\n\n## Как работает\n\n- flow\n\n## Что проверено\n\nNot run.\n";
  const result = lint(draft, facts);
  if (result.passed || !result.issues.some((item) => item.id === "L-rationale-length") ||
      !result.issues.some((item) => item.id === "L-context-title")) throw new Error("Self-test failed: editorial defects were missed.");
  process.stdout.write("Self-test passed.\n");
}

function main() {
  if (process.argv.includes("--self-test")) return runSelfTest();
  const draftIndex = process.argv.indexOf("--draft");
  const factsIndex = process.argv.indexOf("--facts");
  if (draftIndex < 0 || factsIndex < 0) throw new Error("Use --draft <draft.md> --facts <facts.json>.");
  const result = lint(fs.readFileSync(path.resolve(process.argv[draftIndex + 1]), "utf8"),
    JSON.parse(fs.readFileSync(path.resolve(process.argv[factsIndex + 1]), "utf8")));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 2;
}

module.exports = { lint };

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
