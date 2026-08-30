#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { REVIEW_DIMENSIONS } = require("./validate-artifacts");
const { lint } = require("./editorial-lint");
const QUALITY_CONTRACT = require("../references/quality-contract.json");

const READER_QUESTIONS = QUALITY_CONTRACT.reader_questions;
const ANSWER_STATUSES = new Set(QUALITY_CONTRACT.reader_answer_statuses);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function validateReaderAnswers(answers, draft, requireClear, label, facts) {
  if (!answers || typeof answers !== "object") throw new Error(`${label} reader answers are missing.`);
  for (const question of READER_QUESTIONS) {
    const answer = answers[question];
    if (!answer || !ANSWER_STATUSES.has(answer.status) || typeof answer.answer !== "string" || !answer.answer.trim() ||
        typeof answer.draft_evidence !== "string" ||
        (!["missing", "not_applicable"].includes(answer.status) && !answer.draft_evidence.trim())) {
      throw new Error(`${label} reader answer is incomplete: ${question}.`);
    }
    const keyRulesAbsent = question === "key_rules_and_values" && facts &&
      !facts.items.some((item) => ["rule", "contract", "feature_flag"].includes(item.kind));
    if (answer.status === "not_applicable" && !keyRulesAbsent) {
      throw new Error(`${label} reader answer incorrectly marks key rules as not applicable.`);
    }
    if (requireClear && answer.status !== "clear" && !(answer.status === "not_applicable" && keyRulesAbsent)) {
      throw new Error(`Post-revision reader answer is not clear: ${question}.`);
    }
    if (!["missing", "not_applicable"].includes(answer.status) && !draft.includes(answer.draft_evidence)) {
      throw new Error(`${label} reader evidence is absent from the reviewed draft: ${question}.`);
    }
  }
}

function validateRuleCoverage(coverage, draft, facts) {
  if (!coverage || !Array.isArray(coverage.covered) || !Array.isArray(coverage.omitted)) {
    throw new Error("revision.json has no rule coverage audit.");
  }
  const reviewable = facts.items.filter((item) => ["rule", "contract", "feature_flag"].includes(item.kind));
  const byId = new Map(reviewable.map((item) => [item.id, item]));
  const seen = new Set();
  for (const item of coverage.covered) {
    const anchor = item && (item.anchor || item.draft_evidence);
    const occurrences = typeof anchor === "string" && anchor ? draft.split(anchor).length - 1 : 0;
    if (!item || !byId.has(item.fact_id) || seen.has(item.fact_id) ||
        typeof anchor !== "string" || !anchor.trim() || occurrences !== 1) {
      throw new Error(`Invalid covered rule fact: ${item && item.fact_id || "<empty>"}.`);
    }
    seen.add(item.fact_id);
  }
  for (const item of coverage.omitted) {
    const fact = item && byId.get(item.fact_id);
    if (!fact || seen.has(item.fact_id) || typeof item.reason !== "string" || !item.reason.trim()) {
      throw new Error(`Invalid omitted rule fact: ${item && item.fact_id || "<empty>"}.`);
    }
    if (fact.kind === "rule" && /\d|(?:score|threshold|limit|formula|порог|формул)/i.test(fact.statement)) {
      throw new Error(`Numeric or formula rule cannot be omitted: ${fact.id}.`);
    }
    seen.add(item.fact_id);
  }
  const missing = reviewable.filter((item) => !seen.has(item.id));
  if (missing.length) throw new Error(`Rule coverage is incomplete: ${missing.map((item) => item.id).join(", ")}.`);
}

function applyRevision(initialDraft, facts, revision) {
  if (!revision || revision.schema_version !== 3 || revision.reviewed_draft_sha256 !== sha256(initialDraft) ||
      !["pass", "revise"].includes(revision.decision) || !revision.final_dimensions ||
      !Array.isArray(revision.iterations) || !Array.isArray(revision.identified_issues) || !revision.rule_coverage) {
    throw new Error("revision.json does not match the current draft or schema version 3.");
  }
  let finalDraft;
  let finalAnswers;
  if (revision.decision === "pass") {
    if (revision.identified_issues.length || !revision.reader_answers || revision.revised_draft) {
      throw new Error("Audit-only reader pass contains issues or a redundant revised draft.");
    }
    finalDraft = initialDraft;
    finalAnswers = revision.reader_answers;
    validateReaderAnswers(finalAnswers, finalDraft, true, "Reader", facts);
  } else {
    if (typeof revision.revised_draft !== "string" || !revision.revised_draft.trim() ||
        !revision.identified_issues.length) {
      throw new Error("Reader revision requires issues and a complete revised draft.");
    }
    validateReaderAnswers(revision.reader_answers_before, initialDraft, false, "Pre-revision", facts);
    validateReaderAnswers(revision.reader_answers_after, revision.revised_draft, true, "Post-revision", facts);
    finalDraft = revision.revised_draft.endsWith("\n") ? revision.revised_draft : `${revision.revised_draft}\n`;
    finalAnswers = revision.reader_answers_after;
  }
  validateRuleCoverage(revision.rule_coverage, finalDraft, facts);
  for (const dimension of REVIEW_DIMENSIONS) {
    if (revision.final_dimensions[dimension] !== "pass") throw new Error(`Revision has not passed ${dimension}.`);
  }
  if (Array.isArray(revision.remaining_issues) && revision.remaining_issues.length) {
    throw new Error("Revision still contains unresolved editorial issues.");
  }
  const mechanical = lint(finalDraft, facts);
  if (!mechanical.passed) throw new Error(`Revised draft failed editorial lint: ${mechanical.issues.map((item) => item.id).join(", ")}.`);
  return {
    draft: finalDraft,
    review: {
      schema_version: 1,
      iteration: revision.iterations.length + 1,
      draft_sha256: sha256(finalDraft),
      passed: true,
      mode: "reader",
      reader_test_passed: true,
      reader_answers: finalAnswers,
      rule_coverage: revision.rule_coverage,
      dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, "pass"])),
      issues: []
    }
  };
}

function runSelfTest() {
  const facts = { schema_version: 1, title: "T", summary: { problem: "p", solution: "s", outcome: "o" },
    architecture: { before: ["b"], after: ["a"] }, items: [], unknowns: [] };
  const initial = "initial\n";
  const revised = "# T\n\n## Контекст задачи\n\np\n\n## Архитектура решения\n\n### Как было\n\n- b\n\n### Как стало\n\n- a\n\n## Что изменено\n\n- c\n\n## Почему изменено\n\n- reason\n\n## Как работает\n\n- flow\n\n## Что проверено\n\nNot run.\n";
  const beforeAnswers = Object.fromEntries(READER_QUESTIONS.map((question) => [question,
    { status: "ambiguous", answer: "The initial draft is ambiguous.", draft_evidence: "initial" }]));
  beforeAnswers.problem = { status: "missing", answer: "The problem is not stated.", draft_evidence: "" };
  const evidenceByQuestion = {
    problem: "p", trigger: "flow", execution_flow: "- b", outcomes_and_exceptions: "- a",
    key_rules_and_values: "flow",
    verification_and_risks: "Not run."
  };
  const afterAnswers = Object.fromEntries(READER_QUESTIONS.map((question) => [question,
    { status: "clear", answer: `Clear ${question}.`, draft_evidence: evidenceByQuestion[question] }]));
  afterAnswers.key_rules_and_values = {
    status: "not_applicable", answer: "The fixture has no rules, contracts or feature flags.", draft_evidence: ""
  };
  const revision = { schema_version: 3, decision: "revise", reviewed_draft_sha256: sha256(initial), revised_draft: revised,
    reader_answers_before: beforeAnswers, reader_answers_after: afterAnswers,
    identified_issues: [{ id: "E1", category: "reader_clarity", problem: "Initial draft is incomplete." }],
    rule_coverage: { covered: [], omitted: [] },
    final_dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, "pass"])),
    remaining_issues: [], iterations: [{ iteration: 1 }] };
  const result = applyRevision(initial, facts, revision);
  if (!result.review.passed || result.review.draft_sha256 !== sha256(result.draft)) throw new Error("Self-test failed: revision was not applied.");
  let staleBlocked = false;
  try { applyRevision("changed\n", facts, revision); } catch (error) { staleBlocked = error.message.includes("current draft"); }
  if (!staleBlocked) throw new Error("Self-test failed: stale revision was accepted.");
  const missingTrigger = JSON.parse(JSON.stringify(revision));
  missingTrigger.reader_answers_after.trigger.status = "ambiguous";
  let unclearBlocked = false;
  try { applyRevision(initial, facts, missingTrigger); } catch (error) { unclearBlocked = error.message.includes("not clear"); }
  if (!unclearBlocked) throw new Error("Self-test failed: an unclear reader answer was accepted.");
  const numericRuleFacts = JSON.parse(JSON.stringify(facts));
  numericRuleFacts.items = [{ id: "R1", kind: "rule", statement: "Threshold is 7.", impact: "", evidence: [] }];
  const omittedRule = JSON.parse(JSON.stringify(revision));
  omittedRule.reader_answers_after.key_rules_and_values = {
    status: "clear", answer: "The threshold is stated.", draft_evidence: "flow"
  };
  omittedRule.rule_coverage = { covered: [], omitted: [{ fact_id: "R1", reason: "Too detailed." }] };
  let omittedBlocked = false;
  try { applyRevision(initial, numericRuleFacts, omittedRule); } catch (error) { omittedBlocked = error.message.includes("cannot be omitted"); }
  if (!omittedBlocked) throw new Error("Self-test failed: a numeric rule was omitted.");
  validateRuleCoverage({ covered: [{ fact_id: "R1", anchor: "Threshold 7" }], omitted: [] },
    "The configured Threshold 7 enables the warning.", numericRuleFacts);
  let ambiguousAnchorBlocked = false;
  try {
    validateRuleCoverage({ covered: [{ fact_id: "R1", anchor: "Threshold 7" }], omitted: [] },
      "Threshold 7 is configured. Threshold 7 is enforced.", numericRuleFacts);
  } catch (error) { ambiguousAnchorBlocked = error.message.includes("Invalid covered rule fact"); }
  if (!ambiguousAnchorBlocked) throw new Error("Self-test failed: an ambiguous rule anchor was accepted.");
  const auditOnly = {
    schema_version: 3, decision: "pass", reviewed_draft_sha256: sha256(revised),
    reader_answers: afterAnswers, identified_issues: [], rule_coverage: { covered: [], omitted: [] },
    final_dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, "pass"])),
    remaining_issues: [], iterations: [{ iteration: 1 }]
  };
  const auditResult = applyRevision(revised, facts, auditOnly);
  if (auditResult.draft !== revised || auditResult.review.draft_sha256 !== sha256(revised)) {
    throw new Error("Self-test failed: audit-only reader pass changed the authored draft.");
  }
  process.stdout.write("Self-test passed.\n");
}

function main() {
  if (process.argv.includes("--self-test")) return runSelfTest();
  const value = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
  const draftPath = value("--draft");
  const factsPath = value("--facts");
  const revisionPath = value("--revision");
  if (!draftPath || !factsPath || !revisionPath) throw new Error("Use --draft, --facts and --revision.");
  const result = applyRevision(fs.readFileSync(path.resolve(draftPath), "utf8"),
    JSON.parse(fs.readFileSync(path.resolve(factsPath), "utf8")),
    JSON.parse(fs.readFileSync(path.resolve(revisionPath), "utf8")));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { READER_QUESTIONS, applyRevision, sha256, validateReaderAnswers, validateRuleCoverage };

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
