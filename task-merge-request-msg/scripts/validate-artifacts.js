#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REVIEW_DIMENSIONS = [
  "semantic_precision",
  "terminology_provenance",
  "language_consistency",
  "reader_clarity",
  "relevance",
  "conciseness"
];
const FACT_KINDS = new Set(["change", "flow", "rule", "contract", "feature_flag", "risk", "test_added", "test_updated", "test_removed", "check_run", "context"]);
const READER_QUESTIONS = ["problem", "trigger", "execution_flow", "outcomes_and_exceptions", "key_rules_and_values", "verification_and_risks"];
const TOGGLE_FIELDS = ["key", "binding", "default_state", "enabled_behavior", "disabled_behavior", "scope", "owner"];
const UNKNOWN_TOGGLE_VALUE = /^(?:unknown|n\/?a|not[_ -]?found|неизвестно|не найден[ао]?)$/i;

function parseArgs(argv) {
  const args = { dir: null, output: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function analysisEvidence(input) {
  const files = new Map();
  if (!input || !Array.isArray(input.files)) return files;
  for (const file of input.files) {
    const lines = new Map();
    for (const entry of file.evidence || []) {
      const line = Array.isArray(entry) ? entry[1] : entry.line;
      const text = Array.isArray(entry) ? entry[2] : entry.text;
      if (!lines.has(line)) lines.set(line, []);
      lines.get(line).push(text);
    }
    files.set(file.path, lines);
  }
  return files;
}

function quoteMatches(lines, startLine, quote) {
  const quoteLines = String(quote).split(/\r?\n/);
  const exactMatch = quoteLines.every((quoteLine, index) => {
    const texts = lines.get(Number(startLine) + index) || [];
    return texts.some((text) => text.includes(quoteLine));
  });
  if (exactMatch) return true;

  // Модель может схлопнуть переносы одного выражения. Принимаем только дословную
  // последовательность из соседних строк после нормализации пробелов.
  const normalizedQuote = String(quote).replace(/\s+/g, " ").trim();
  let variants = [""];
  for (let offset = 0; offset < 8; offset++) {
    const texts = lines.get(Number(startLine) + offset) || [];
    if (!texts.length) break;
    variants = variants.flatMap((prefix) => texts.map((text) => `${prefix} ${text}`));
    if (variants.some((text) => text.replace(/\s+/g, " ").trim().includes(normalizedQuote))) return true;
    if (variants.length > 64) variants = variants.slice(0, 64);
  }
  return false;
}

function normalizeEvidenceLocations(facts, analysisInput) {
  const files = analysisEvidence(analysisInput);
  const repairs = [];
  for (const item of facts && facts.items || []) {
    for (const evidence of item.evidence || []) {
      if (!evidence.path || evidence.line === undefined || !evidence.quote) continue;
      const lines = files.get(evidence.path);
      if (!lines) continue;
      if (quoteMatches(lines, evidence.line, evidence.quote)) continue;
      const matches = [];
      for (const line of lines.keys()) if (quoteMatches(lines, line, evidence.quote)) matches.push(line);
      if (matches.length === 1) {
        repairs.push({ fact_id: item.id, path: evidence.path, from: evidence.line, to: matches[0] });
        evidence.line = matches[0];
      }
    }
  }
  return repairs;
}

function validate(data) {
  const errors = [];
  const warnings = [];
  const { scope, facts, authorOutput, outline, draft, review, revision, analysisInput } = data;

  if (!scope || scope.schema_version !== 1 || !Array.isArray(scope.repositories)) {
    errors.push("scope.json does not match schema version 1.");
  } else if (!scope.ready || (scope.questions && scope.questions.length)) {
    errors.push("Scope contains unresolved questions.");
  } else if (!scope.context || !scope.context.artifact_directory) {
    errors.push("Scope does not contain a resolved task-context artifact directory.");
  }

  if (!facts || facts.schema_version !== 1 || !facts.summary || !Array.isArray(facts.items) ||
      typeof facts.title !== "string" || !facts.title.trim() || !facts.architecture ||
      !Array.isArray(facts.architecture.before) || !facts.architecture.before.length ||
      !Array.isArray(facts.architecture.after) || !facts.architecture.after.length) {
    errors.push("facts.json does not match schema version 1.");
  }

  const items = facts && Array.isArray(facts.items) ? facts.items : [];
  if (authorOutput) {
    if (authorOutput.schema_version !== 1 || typeof authorOutput.draft !== "string" || !authorOutput.draft.trim() ||
        JSON.stringify(authorOutput.facts) !== JSON.stringify(facts)) {
      errors.push("author-output.json does not match facts.json or schema version 1.");
    }
  }
  const ids = new Set();
  const evidenceFiles = analysisEvidence(analysisInput);
  const changedFiles = new Set();
  for (const repository of scope && scope.repositories || []) {
    for (const file of [...(repository.branch_files || []), ...(repository.worktree_files || [])]) changedFiles.add(file);
  }
  for (const item of items) {
    if (!item.id || ids.has(item.id)) errors.push(`Missing or duplicate fact id: ${item.id || "<empty>"}.`);
    else ids.add(item.id);
    if (!item.kind || !item.statement) errors.push(`Fact ${item.id || "<empty>"} is incomplete.`);
    if (item.kind && !FACT_KINDS.has(item.kind)) errors.push(`Fact ${item.id || "<empty>"} has unsupported kind: ${item.kind}.`);
    if (item.kind === "feature_flag") {
      if (!item.toggle || typeof item.toggle !== "object") {
        errors.push(`Feature flag fact ${item.id || "<empty>"} has no structured toggle contract.`);
      } else {
        for (const field of TOGGLE_FIELDS) {
          const value = item.toggle[field];
          if (typeof value !== "string" || !value.trim() || UNKNOWN_TOGGLE_VALUE.test(value.trim())) {
            errors.push(`Feature flag fact ${item.id || "<empty>"} has no evidence-backed toggle.${field}.`);
          }
        }
        if (item.toggle.key && item.toggle.binding && item.toggle.key === item.toggle.binding) {
          errors.push(`Feature flag fact ${item.id || "<empty>"} repeats the source key as its external binding.`);
        }
        if (analysisInput && item.toggle.key) {
          const featureFlagCandidates = (analysisInput.candidates || []).filter((candidate) => {
            const type = Array.isArray(candidate) ? candidate[0] : candidate.type;
            const value = Array.isArray(candidate) ? candidate[1] : candidate.value;
            return type === "feature_flag" && value === item.toggle.key;
          });
          if (!featureFlagCandidates.length) {
            errors.push(`Feature flag fact ${item.id || "<empty>"} uses a key absent from feature_flag evidence.`);
          }
          const bindingCandidates = (analysisInput.candidates || []).filter((candidate) => {
            const type = Array.isArray(candidate) ? candidate[0] : candidate.type;
            const value = Array.isArray(candidate) ? candidate[1] : candidate.value;
            return type === "toggle_binding" && value === item.toggle.binding;
          });
          if (!bindingCandidates.length) {
            errors.push(`Feature flag fact ${item.id || "<empty>"} uses a binding absent from toggle_binding evidence.`);
          }
          const evidenceText = (item.evidence || []).map((evidence) => evidence && evidence.quote || "").join("\n");
          if (item.toggle.binding && !evidenceText.includes(item.toggle.binding)) {
            errors.push(`Feature flag fact ${item.id || "<empty>"} has no cited evidence for binding: ${item.toggle.binding}.`);
          }
        }
        if (typeof draft === "string") {
          for (const field of ["key", "binding"]) {
            const value = item.toggle[field];
            if (typeof value === "string" && value.trim() && !draft.includes(value)) {
              errors.push(`Draft does not name feature flag ${field}: ${value}.`);
            }
          }
        }
      }
    }
    if (!Array.isArray(item.evidence)) {
      errors.push(`Fact ${item.id || "<empty>"} has no evidence array.`);
      continue;
    }
    if (!item.evidence.length && item.kind !== "context" && item.kind !== "check_run") {
      errors.push(`Fact ${item.id || "<empty>"} has no source evidence.`);
    }
    for (const evidence of item.evidence) {
      if (!evidence || !evidence.path) {
        errors.push(`Fact ${item.id || "<empty>"} contains evidence without a path.`);
        continue;
      }
      if (changedFiles.size && !changedFiles.has(evidence.path)) {
        errors.push(`Fact ${item.id || "<empty>"} references unchanged file: ${evidence.path}.`);
      }
      if (!analysisInput) continue;
      const fileLines = evidenceFiles.get(evidence.path);
      if (!fileLines) {
        errors.push(`Fact ${item.id || "<empty>"} references file absent from analysis input: ${evidence.path}.`);
        continue;
      }
      const candidates = analysisInput.candidates || [];
      if (evidence.symbol && !candidates.some((candidate) => {
        const type = Array.isArray(candidate) ? candidate[0] : candidate.type;
        const value = Array.isArray(candidate) ? candidate[1] : candidate.value;
        const candidatePath = Array.isArray(candidate) ? candidate[2] : candidate.path;
        return type === "symbol" && value === evidence.symbol && candidatePath === evidence.path;
      })) {
        errors.push(`Fact ${item.id || "<empty>"} references unsupported symbol: ${evidence.symbol}.`);
      }
      if (evidence.line !== undefined && evidence.quote) {
        if (!quoteMatches(fileLines, evidence.line, evidence.quote)) {
          errors.push(`Fact ${item.id || "<empty>"} has an unsupported quote at ${evidence.path}:${evidence.line}.`);
        }
      } else if (item.kind === "rule" || item.kind === "contract") {
        errors.push(`Fact ${item.id || "<empty>"} must cite line and quote for ${item.kind} evidence.`);
      }
    }
  }

  const testKindByChange = { added: "test_added", updated: "test_updated", removed: "test_removed" };
  for (const file of analysisInput && analysisInput.files || []) {
    if (!file.test) continue;
    const expectedKind = testKindByChange[file.change || "updated"];
    if (!items.some((item) => item.kind === expectedKind &&
        (item.evidence || []).some((evidence) => evidence.path === file.path))) {
      errors.push(`Changed test file is missing from the ${expectedKind} inventory: ${file.path}.`);
    }
  }

  if (outline) {
    if (outline.schema_version !== 1 || !Array.isArray(outline.sections)) {
      errors.push("outline.json does not match schema version 1.");
    } else {
      const assigned = new Set();
      let detailSections = 0;
      for (const section of outline.sections) {
        if (!section.required) detailSections++;
        for (const id of section.fact_ids || []) {
          if (!ids.has(id)) errors.push(`Outline references unknown fact id: ${id}.`);
          if (assigned.has(id)) errors.push(`Fact id is assigned to multiple sections: ${id}.`);
          assigned.add(id);
        }
      }
      if (detailSections > 2) warnings.push("Expanded route uses more than two optional detail sections.");
    }
  }

  if (typeof draft !== "string" || !draft.trim()) errors.push("draft.md is empty.");
  const draftHash = typeof draft === "string" ? crypto.createHash("sha256").update(draft).digest("hex") : null;
  if (!review || review.schema_version !== 1 || !review.dimensions || !Array.isArray(review.issues)) {
    errors.push("editorial-review.json does not match schema version 1.");
  } else {
    if (review.draft_sha256 !== draftHash) errors.push("Editorial review does not match the current draft hash.");
    for (const dimension of REVIEW_DIMENSIONS) {
      if (review.dimensions[dimension] !== "pass") errors.push(`Editorial dimension failed: ${dimension}.`);
    }
    if (!review.passed) errors.push("Editorial review has not passed.");
    if (review.issues.some((issue) => issue.severity === "must_fix")) {
      errors.push("Editorial review still contains must_fix issues.");
    }
    if (review.mode === "reader") {
      if (!review.reader_test_passed || !review.reader_answers || !review.rule_coverage) {
        errors.push("Reader review has not passed the comprehension test.");
      } else {
        for (const question of READER_QUESTIONS) {
          const answer = review.reader_answers[question];
          const keyRulesAbsent = question === "key_rules_and_values" &&
            !items.some((item) => ["rule", "contract", "feature_flag"].includes(item.kind));
          const acceptableStatus = answer && (answer.status === "clear" ||
            (answer.status === "not_applicable" && keyRulesAbsent));
          const evidenceSupported = answer && (answer.status === "not_applicable" ||
            (answer.draft_evidence && draft.includes(answer.draft_evidence)));
          if (!acceptableStatus || !answer.answer || !evidenceSupported) {
            errors.push(`Reader review has no clear supported answer: ${question}.`);
          }
        }
        const reviewable = items.filter((item) => ["rule", "contract", "feature_flag"].includes(item.kind));
        const expected = new Map(reviewable.map((item) => [item.id, item]));
        const covered = new Set();
        for (const entry of review.rule_coverage.covered || []) {
          const anchor = entry && (entry.anchor || entry.draft_evidence);
          const occurrences = typeof anchor === "string" && anchor ? draft.split(anchor).length - 1 : 0;
          if (!expected.has(entry.fact_id) || covered.has(entry.fact_id) || occurrences !== 1) {
            errors.push(`Reader review has invalid covered rule fact: ${entry.fact_id || "<empty>"}.`);
          } else covered.add(entry.fact_id);
        }
        for (const entry of review.rule_coverage.omitted || []) {
          const fact = expected.get(entry.fact_id);
          if (!fact || covered.has(entry.fact_id) || !entry.reason) {
            errors.push(`Reader review has invalid omitted rule fact: ${entry.fact_id || "<empty>"}.`);
          } else if (fact.kind === "feature_flag") {
            errors.push(`Reader review omitted a feature flag fact: ${fact.id}.`);
          } else if (fact.kind === "rule" && /\d|(?:score|threshold|limit|formula|порог|формул)/i.test(fact.statement)) {
            errors.push(`Reader review omitted a numeric or formula rule: ${fact.id}.`);
          } else covered.add(entry.fact_id);
        }
        for (const id of expected.keys()) if (!covered.has(id)) errors.push(`Reader review did not classify rule fact: ${id}.`);
      }
    }
  }
  if (revision) {
    if (revision.schema_version !== 3 || !["pass", "revise"].includes(revision.decision) ||
        !Array.isArray(revision.iterations) || typeof revision.reviewed_draft_sha256 !== "string" ||
        !revision.final_dimensions || !Array.isArray(revision.remaining_issues) ||
        !Array.isArray(revision.identified_issues) || !revision.rule_coverage) {
      errors.push("revision.json does not match schema version 3.");
    } else {
      if (revision.decision === "pass") {
        if (!revision.reader_answers || revision.revised_draft || revision.identified_issues.length) {
          errors.push("Audit-only revision contains issues, a redundant draft, or no reader answers.");
        }
        if (authorOutput) {
          const authoredDraft = authorOutput.draft.endsWith("\n") ? authorOutput.draft : `${authorOutput.draft}\n`;
          if (authoredDraft !== draft) errors.push("Audit-only revision changed the authored draft.");
        }
      } else {
        if (typeof revision.revised_draft !== "string" || !revision.revised_draft.trim() ||
            !revision.reader_answers_before || !revision.reader_answers_after || !revision.identified_issues.length) {
          errors.push("Reader revision is incomplete.");
        } else {
          const normalizedRevisionDraft = revision.revised_draft.endsWith("\n") ? revision.revised_draft : `${revision.revised_draft}\n`;
          if (normalizedRevisionDraft !== draft) errors.push("revision.json does not produce the current draft.");
        }
      }
      for (const dimension of REVIEW_DIMENSIONS) {
        if (revision.final_dimensions[dimension] !== "pass") errors.push(`Revision dimension failed: ${dimension}.`);
      }
      if (revision.remaining_issues.length) errors.push("revision.json still contains unresolved issues.");
      if (authorOutput) {
        const authoredDraft = authorOutput.draft.endsWith("\n") ? authorOutput.draft : `${authorOutput.draft}\n`;
        const authoredHash = crypto.createHash("sha256").update(authoredDraft).digest("hex");
        if (revision.reviewed_draft_sha256 !== authoredHash) {
          errors.push("Reader review does not match author-output.json draft hash.");
        }
      }
    }
  }
  if (items.some((item) => ["test_added", "test_updated", "test_removed"].includes(item.kind)) &&
      !items.some((item) => item.kind === "check_run")) {
    warnings.push("Tests were changed, but no executed check is recorded. Ensure the draft does not claim they ran.");
  }

  return {
    schema_version: 1,
    passed: errors.length === 0,
    errors,
    warnings,
    checks: {
      artifacts_valid: !errors.some((error) => error.includes("schema version") || error.includes("Scope")),
      editorial_review_passed: !!review && review.passed === true && review.draft_sha256 === draftHash,
      claims_supported: !!review && !!review.dimensions && review.dimensions.semantic_precision === "pass" &&
        review.dimensions.terminology_provenance === "pass" &&
        !errors.some((error) => error.includes("evidence") || error.includes("unsupported") || error.includes("unchanged file")),
      facts_not_repeated: !errors.some((error) => error.includes("multiple sections")) &&
        !!review && !!review.dimensions && review.dimensions.conciseness === "pass",
      verification_honest: !!review && !!review.dimensions && review.dimensions.semantic_precision === "pass" &&
        review.dimensions.relevance === "pass",
      detail_budget_respected: !warnings.some((warning) => warning.includes("detail sections")),
      reader_comprehension_passed: !!review && (review.mode !== "reader" || review.reader_test_passed === true)
    }
  };
}

function loadRunDirectory(dir) {
  const scope = readJson(path.join(dir, "scope.json"));
  const facts = readJson(path.join(dir, "facts.json"));
  const authorOutputPath = path.join(dir, "author-output.json");
  const outlinePath = path.join(dir, "outline.json");
  const revisionPath = path.join(dir, "revision.json");
  const draft = fs.readFileSync(path.join(dir, "draft.md"), "utf8");
  const review = readJson(path.join(dir, "editorial-review.json"));
  const analysisInputPath = path.join(dir, "analysis-input.json");
  return {
    scope,
    facts,
    authorOutput: fs.existsSync(authorOutputPath) ? readJson(authorOutputPath) : null,
    outline: fs.existsSync(outlinePath) ? readJson(outlinePath) : null,
    draft,
    review,
    revision: fs.existsSync(revisionPath) ? readJson(revisionPath) : null,
    analysisInput: fs.existsSync(analysisInputPath) ? readJson(analysisInputPath) : null
  };
}

function runSelfTest() {
  const draft = "Title\n\nSummary";
  const result = validate({
    scope: {
      schema_version: 1,
      repositories: [{}],
      context: { artifact_directory: "C:/context/task/pr-message/branch" },
      questions: [],
      ready: true
    },
    facts: {
      schema_version: 1,
      title: "Validation fixture",
      summary: { problem: "p", solution: "s", outcome: "o" },
      architecture: { before: ["before"], after: ["after"] },
      items: [{
        id: "C1", kind: "change", statement: "change", impact: "impact",
        evidence: [{ path: "src/a.js", symbol: "run", line: 10, quote: "prototype.run" }]
      }],
      unknowns: []
    },
    outline: {
      schema_version: 1,
      route: "expanded",
      sections: [{ name: "Key changes", required: true, fact_ids: ["C1"] }]
    },
    draft,
    review: {
      schema_version: 1,
      iteration: 1,
      draft_sha256: crypto.createHash("sha256").update(draft).digest("hex"),
      passed: true,
      dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, "pass"])),
      issues: []
    },
    revision: null,
    analysisInput: {
      schema_version: 1,
      candidates: [["symbol", "run", "src/a.js", 10]],
      files: [{ path: "src/a.js", evidence: [["+", 10, "Api.prototype.run = function() {};"]] }]
    }
  });
  if (!result.passed) throw new Error(`Self-test failed: ${result.errors.join("; ")}`);
  const readerDraft = "# Reader fixture\n\nProblem and trigger.\n\nFlow and outcomes.\n\nVerification and risks.\n";
  const readerAnswers = Object.fromEntries(READER_QUESTIONS.map((question) => [question, {
    status: "clear", answer: `Clear ${question}.`,
    draft_evidence: question === "verification_and_risks" ? "Verification and risks." :
      question === "outcomes_and_exceptions" || question === "execution_flow" ? "Flow and outcomes." : "Problem and trigger."
  }]));
  const readerReview = {
    schema_version: 1, iteration: 2,
    draft_sha256: crypto.createHash("sha256").update(readerDraft).digest("hex"),
    passed: true, mode: "reader", reader_test_passed: true, reader_answers: readerAnswers,
    rule_coverage: { covered: [], omitted: [] },
    dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, "pass"])), issues: []
  };
  const brokenReaderReview = JSON.parse(JSON.stringify(readerReview));
  brokenReaderReview.reader_answers.trigger.status = "ambiguous";
  const brokenReaderResult = validate({
    scope: { schema_version: 1, repositories: [], context: { artifact_directory: "C:/context/task" }, questions: [], ready: true },
    facts: { schema_version: 1, title: "Reader", summary: { problem: "p", solution: "s", outcome: "o" },
      architecture: { before: ["b"], after: ["a"] }, items: [], unknowns: [] },
    draft: readerDraft, review: brokenReaderReview, revision: null, outline: null, authorOutput: null, analysisInput: null
  });
  if (brokenReaderResult.passed || !brokenReaderResult.errors.some((error) => error.includes("trigger"))) {
    throw new Error("Self-test failed: unclear reader answer passed validation.");
  }
  const missingToggleResult = validate({
    scope: { schema_version: 1, repositories: [], context: { artifact_directory: "C:/context/task" }, questions: [], ready: true },
    facts: {
      schema_version: 1, title: "Toggle", summary: { problem: "p", solution: "s", outcome: "o" },
      architecture: { before: ["b"], after: ["a"] },
      items: [{ id: "F1", kind: "feature_flag", statement: "Feature flag featureA", evidence: [{ path: "src/a.js" }] }],
      unknowns: []
    },
    draft,
    review: {
      schema_version: 1, iteration: 1,
      draft_sha256: crypto.createHash("sha256").update(draft).digest("hex"),
      passed: true, dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, "pass"])), issues: []
    },
    revision: null, outline: null, authorOutput: null, analysisInput: null
  });
  if (missingToggleResult.passed ||
      !missingToggleResult.errors.some((error) => error.includes("structured toggle contract"))) {
    throw new Error("Self-test failed: feature flag without toggle contract passed validation.");
  }
  const missingTestInventoryResult = validate({
    scope: { schema_version: 1, repositories: [], context: { artifact_directory: "C:/context/task" }, questions: [], ready: true },
    facts: { schema_version: 1, title: "Tests", summary: { problem: "p", solution: "s", outcome: "o" },
      architecture: { before: ["b"], after: ["a"] }, items: [], unknowns: [] },
    draft,
    review: {
      schema_version: 1, iteration: 1, draft_sha256: crypto.createHash("sha256").update(draft).digest("hex"),
      passed: true, dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, "pass"])), issues: []
    },
    revision: null, outline: null, authorOutput: null,
    analysisInput: { files: [{ path: "src/a.test.js", test: true, change: "updated", evidence: [] }] }
  });
  if (missingTestInventoryResult.passed ||
      !missingTestInventoryResult.errors.some((error) => error.includes("test_updated inventory"))) {
    throw new Error("Self-test failed: changed test file without inventory fact passed validation.");
  }
  const repairFacts = {
    items: [{ id: "R1", evidence: [{ path: "src/a.js", line: 9, quote: "prototype.run" }] }]
  };
  const repairs = normalizeEvidenceLocations(repairFacts, {
    files: [{ path: "src/a.js", evidence: [["+", 10, "Api.prototype.run = function() {};"]] }]
  });
  if (repairs.length !== 1 || repairFacts.items[0].evidence[0].line !== 10) {
    throw new Error("Self-test failed: unique evidence location was not repaired.");
  }
  const multilineFacts = {
    items: [{ id: "R2", evidence: [{ path: "src/a.js", line: 10, quote: "first\nsecond" }] }]
  };
  const multilineRepairs = normalizeEvidenceLocations(multilineFacts, {
    files: [{ path: "src/a.js", evidence: [["+", 10, "first"], ["+", 11, "second"]] }]
  });
  if (multilineRepairs.length !== 0 || multilineFacts.items[0].evidence[0].line !== 10) {
    throw new Error("Self-test failed: valid multiline evidence was changed.");
  }
  const splitExpression = new Map([
    [20, ["const score = components.formulas +"]],
    [21, ["  components.dependencies;"]]
  ]);
  if (!quoteMatches(splitExpression, 20, "const score = components.formulas + components.dependencies;")) {
    throw new Error("Self-test failed: collapsed multiline expression was rejected.");
  }
  if (quoteMatches(splitExpression, 20, "const score = components.formulas + components.volume;")) {
    throw new Error("Self-test failed: unsupported collapsed expression was accepted.");
  }
  process.stdout.write("Self-test passed.\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  if (!args.dir) throw new Error("Use --dir <run-directory> or --self-test.");
  const result = validate(loadRunDirectory(path.resolve(args.dir)));
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) fs.writeFileSync(path.resolve(args.output), json, "utf8");
  else process.stdout.write(json);
  if (!result.passed) process.exitCode = 1;
}

module.exports = { REVIEW_DIMENSIONS, loadRunDirectory, normalizeEvidenceLocations, validate };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
