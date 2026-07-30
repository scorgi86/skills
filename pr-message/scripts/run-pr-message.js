#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { collect } = require("./collect-git-scope");
const { get: getCache, put: putCache, validateAuthorOutput, validateFacts } = require("./analysis-cache");
const { invoke } = require("./invoke-polza-deepseek");
const { FAST_FACTS_VERSION, buildFastFacts } = require("./build-fast-facts");
const { prepare, renderModelInput, resolveAuthorEvidence } = require("./prepare-analysis-input");
const { editorialReview, render } = require("./render-pr-description");
const { lint: editorialLint } = require("./editorial-lint");
const { applyRevision } = require("./apply-editorial-revision");
const { writeArtifactBundle } = require("./write-artifact-bundle");
const { finalize } = require("./finalize-run");
const { REVIEW_DIMENSIONS, normalizeEvidenceLocations, validate } = require("./validate-artifacts");

function parseArgs(argv) {
  const args = {
    repo: null, base: null, runDir: null, artifactDir: null, cacheDir: null, facts: null, authorOutput: null, authorDraft: null,
    usage: null, editorialRevision: null, readerReview: null,
    includeWorktree: null, mode: null, provider: "none", model: "deepseek/deepseek-chat", promptVersion: "7",
    taskId: null, registerIn: null, allowExternal: false, keepTransient: false, selfTest: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--base") args.base = argv[++i];
    else if (arg === "--run-dir") args.runDir = argv[++i];
    else if (arg === "--artifact-dir") args.artifactDir = argv[++i];
    else if (arg === "--cache-dir") args.cacheDir = argv[++i];
    else if (arg === "--facts") args.facts = argv[++i];
    else if (arg === "--author-output") args.authorOutput = argv[++i];
    else if (arg === "--author-draft") args.authorDraft = argv[++i];
    else if (arg === "--usage") args.usage = argv[++i];
    else if (arg === "--editorial-revision") args.editorialRevision = argv[++i];
    else if (arg === "--reader-review") args.readerReview = argv[++i];
    else if (arg === "--include-worktree") args.includeWorktree = true;
    else if (arg === "--exclude-worktree") args.includeWorktree = false;
    else if (arg === "--mode") args.mode = argv[++i];
    else if (arg === "--provider") args.provider = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--prompt-version") args.promptVersion = argv[++i];
    else if (arg === "--task-id") args.taskId = argv[++i];
    else if (arg === "--register-in") args.registerIn = argv[++i];
    else if (arg === "--allow-external") args.allowExternal = true;
    else if (arg === "--keep-transient") args.keepTransient = true;
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.provider === "polza-deepseek") args.mode = "deep";
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cleanup(files) {
  for (const file of files) if (fs.existsSync(file)) fs.unlinkSync(file);
}

function validateAuthorStage(scope, facts, draft, analysisInput) {
  const review = {
    schema_version: 1,
    iteration: 0,
    draft_sha256: crypto.createHash("sha256").update(draft).digest("hex"),
    passed: true,
    mode: "author-evidence",
    dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, "pass"])),
    issues: []
  };
  return validate({ scope, facts, authorOutput: null, outline: null, draft, review, revision: null, analysisInput });
}

async function run(args) {
  if (!args.repo || !args.base || !args.runDir || !args.artifactDir) {
    throw new Error("Use --repo, --base, --run-dir and --artifact-dir.");
  }
  const startedAt = Date.now();
  const runDir = path.resolve(args.runDir);
  const artifactDir = path.resolve(args.artifactDir);
  const cacheDir = path.resolve(args.cacheDir || path.join(artifactDir, ".analysis-cache"));
  if (!["fast", "semantic", "deep"].includes(args.mode)) throw new Error("--mode must be fast, semantic or deep.");
  const cacheModel = args.mode === "fast" ? `local/fast-facts-v${FAST_FACTS_VERSION}` :
    args.mode === "semantic" ? "codex/semantic-author-v5" : `${args.model}/author-v5`;
  fs.mkdirSync(runDir, { recursive: true });

  const collected = collect({ repo: args.repo, base: args.base, includeWorktree: args.includeWorktree });
  const scope = collected.scope;
  scope.context = {
    task_id: args.taskId || null,
    task_context_path: artifactDir,
    artifact_directory: artifactDir,
    register_in: args.registerIn ? path.resolve(args.registerIn) : null,
    source: "user"
  };
  const scopePath = path.join(runDir, "scope.json");
  const diffPath = path.join(runDir, "selected.diff");
  writeJson(scopePath, scope);
  fs.writeFileSync(diffPath, collected.selectedDiffText, "utf8");
  if (!scope.ready) {
    return { status: "scope_blocked", questions: scope.questions, run_directory: runDir };
  }

  const analysisInput = prepare(scope, collected.selectedDiffText, args.mode === "semantic" ? 35000 : undefined);
  const analysisInputPath = path.join(runDir, "analysis-input.json");
  const promptPath = path.join(runDir, "analysis-prompt.txt");
  fs.writeFileSync(analysisInputPath, `${JSON.stringify(analysisInput)}\n`, "utf8");
  fs.writeFileSync(promptPath, renderModelInput(analysisInput), "utf8");

  let facts = null;
  let authorOutput = null;
  let authoredDraft = null;
  let usage = null;
  let sourceUsage = null;
  let modelInvoked = false;
  let cacheStatus = "miss";
  let pendingCache = false;
  let deepRecommended = false;
  let deepReasons = [];
  const cached = getCache(analysisInput, cacheDir, args.promptVersion, cacheModel);
  if (cached.hit) {
    facts = cached.facts;
    authorOutput = cached.author_output || null;
    authoredDraft = authorOutput ? authorOutput.draft : null;
    sourceUsage = cached.usage;
    cacheStatus = "hit";
  } else if (args.authorOutput) {
    authorOutput = readJson(path.resolve(args.authorOutput));
    resolveAuthorEvidence(authorOutput, analysisInput);
    validateAuthorOutput(authorOutput);
    facts = authorOutput.facts;
    authoredDraft = authorOutput.draft;
    pendingCache = true;
    cacheStatus = "file_uncached";
  } else if (args.facts) {
    facts = readJson(path.resolve(args.facts));
    validateFacts(facts);
    if (args.authorDraft) {
      authoredDraft = fs.readFileSync(path.resolve(args.authorDraft), "utf8");
      authorOutput = { schema_version: 1, facts, draft: authoredDraft };
      resolveAuthorEvidence(authorOutput, analysisInput);
      facts = authorOutput.facts;
      validateAuthorOutput(authorOutput);
    }
    if (args.usage) {
      const suppliedUsage = readJson(path.resolve(args.usage));
      sourceUsage = suppliedUsage.usage || suppliedUsage;
    }
    pendingCache = true;
    cacheStatus = "file_uncached";
  } else if (args.mode === "fast") {
    const local = buildFastFacts(analysisInput, scope);
    facts = local.facts;
    validateFacts(facts);
    deepRecommended = local.deep_recommended;
    deepReasons = local.deep_reasons;
    pendingCache = true;
    cacheStatus = "fast_uncached";
  } else if (args.mode === "deep") {
    const invoked = await invoke({
      allowExternal: args.allowExternal,
      endpoint: "https://polza.ai/api/v1/responses",
      model: args.model,
      maxOutputTokens: 8000
    }, renderModelInput(analysisInput), analysisInput);
    authorOutput = invoked.author_output;
    resolveAuthorEvidence(authorOutput, analysisInput);
    facts = authorOutput.facts;
    authoredDraft = authorOutput.draft;
    usage = invoked.usage;
    sourceUsage = usage;
    modelInvoked = true;
    pendingCache = true;
    cacheStatus = "model_uncached";
  }

  if (!facts) {
    return {
      status: "analysis_required", mode: args.mode, cache: cacheStatus, analysis_prompt: promptPath,
      analysis_input: analysisInputPath, author_output: path.join(runDir, "author-output.json"), run_directory: runDir
    };
  }

  const evidenceRepairs = normalizeEvidenceLocations(facts, analysisInput);
  if (args.mode !== "fast" && !authoredDraft) {
    return {
      status: "authoring_required", mode: args.mode, cache: cacheStatus,
      analysis_prompt: promptPath, facts: args.facts ? path.resolve(args.facts) : path.join(runDir, "facts.json"),
      author_output: path.join(runDir, "author-output.json"), run_directory: runDir
    };
  }
  const initialDraft = args.mode === "fast" ? render(facts, analysisInput) :
    (authoredDraft.endsWith("\n") ? authoredDraft : `${authoredDraft}\n`);
  if (args.mode !== "fast" && pendingCache) {
    const authorValidation = validateAuthorStage(scope, facts, initialDraft, analysisInput);
    if (!authorValidation.passed) {
      return {
        status: "author_validation_failed", mode: args.mode, cache: cacheStatus,
        validation: authorValidation, run_directory: runDir
      };
    }
    putCache(analysisInput, authorOutput, cacheDir, args.promptVersion, cacheModel, sourceUsage);
    cacheStatus = args.authorOutput || args.facts ? "stored_author_from_file" : "stored_author_from_model";
    pendingCache = false;
  }
  let draft = initialDraft;
  let review = args.mode === "fast" ? editorialReview(draft, facts) : editorialLint(draft, facts);
  let revision = null;
  if (args.mode !== "fast") {
    const suppliedReview = args.readerReview || args.editorialRevision;
    let revisionPath = suppliedReview ? path.resolve(suppliedReview) : path.join(artifactDir, "revision.json");
    let applied = null;
    if (fs.existsSync(revisionPath)) {
      revision = readJson(revisionPath);
      try {
        applied = applyRevision(initialDraft, facts, revision);
      } catch (error) {
        if (suppliedReview) throw error;
        revision = null;
      }
    }
    if (!applied) {
      const editorialInputPath = path.join(runDir, "reader-input.json");
      const compactFacts = {
        schema_version: 1,
        title: facts.title,
        claims: facts.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          claim: item.statement,
          ...(item.kind === "feature_flag" ? { toggle: item.toggle || null } : {})
        }))
      };
      writeJson(editorialInputPath, {
        schema_version: 3,
        reviewed_draft_sha256: crypto.createHash("sha256").update(initialDraft).digest("hex"),
        draft: initialDraft,
        claim_catalog: compactFacts,
        mechanical: { passed: review.passed, issue_ids: review.issues.map((issue) => issue.id) },
        revision_schema: 3
      });
      writeArtifactBundle(runDir, { schema_version: 1, artifacts: [
        { path: "scope.json", format: "json", content: scope },
        { path: "facts.json", format: "json", content: facts },
        ...(authorOutput ? [{ path: "author-output.json", format: "json", content: authorOutput }] : []),
        { path: "draft.md", format: "text", content: initialDraft },
        { path: "editorial-review.json", format: "json", content: review }
      ] });
      return {
        status: "reader_review_required", mode: args.mode, cache: cacheStatus,
        reader_input: editorialInputPath,
        reader_contract: path.join(__dirname, "..", "references", "reader-contract.md"),
        revision_output: path.join(runDir, "revision.json"),
        run_directory: runDir
      };
    }
    draft = applied.draft;
    review = applied.review;
  }
  const artifacts = [
    { path: "scope.json", format: "json", content: scope },
    { path: "facts.json", format: "json", content: facts },
    { path: "draft.md", format: "text", content: draft },
    { path: "editorial-review.json", format: "json", content: review }
  ];
  if (authorOutput) artifacts.push({ path: "author-output.json", format: "json", content: authorOutput });
  if (revision) artifacts.push({ path: "revision.json", format: "json", content: revision });
  if (sourceUsage) {
    artifacts.push({
      path: "model-usage.json", format: "json",
      content: { schema_version: 1, model: args.model, cache: cacheStatus, model_invoked: modelInvoked, usage: sourceUsage }
    });
  } else {
    const staleUsage = path.join(runDir, "model-usage.json");
    if (fs.existsSync(staleUsage)) fs.unlinkSync(staleUsage);
  }
  writeArtifactBundle(runDir, { schema_version: 1, artifacts });
  const finalized = finalize(runDir, artifactDir);
  if (!finalized.passed) {
    return { status: "validation_failed", cache: cacheStatus, validation: finalized.validation, run_directory: runDir };
  }
  if (pendingCache) {
    putCache(analysisInput, args.mode === "fast" ? facts : authorOutput, cacheDir, args.promptVersion, cacheModel, sourceUsage);
    cacheStatus = (args.facts || args.authorOutput) ? "stored_from_file" : args.mode === "fast" ? "stored_from_fast" : "stored_from_model";
  }
  if (!args.keepTransient) cleanup([diffPath, analysisInputPath, promptPath, path.join(runDir, "reader-input.json")]);
  return {
    status: "complete", mode: args.mode, cache: cacheStatus, model_invoked: modelInvoked, duration_ms: Date.now() - startedAt,
    usage: modelInvoked ? usage : null, cached_usage: cacheStatus === "hit" ? sourceUsage : null,
    deep_recommended: deepRecommended, deep_reasons: deepReasons,
    evidence_repairs: evidenceRepairs, description: path.join(artifactDir, "pr-description.md"), run_directory: runDir
  };
}

async function runSelfTest() {
  const source = fs.readFileSync(__filename, "utf8");
  const required = ["collect({", "getCache(", "buildFastFacts(", "renderModelInput(", "resolveAuthorEvidence(",
    "validateAuthorStage(", "reader-contract.md", "editorialReview(", "finalize("];
  if (!required.every((value) => source.includes(value))) {
    throw new Error("Self-test failed: orchestrator stages are incomplete.");
  }
  if (parseArgs([]).mode !== null || parseArgs(["--mode", "semantic"]).mode !== "semantic" ||
      parseArgs(["--provider", "polza-deepseek"]).mode !== "deep") {
    throw new Error("Self-test failed: mode selection is not explicit or provider alias is broken.");
  }
  const readerContract = fs.readFileSync(path.join(__dirname, "..", "references", "reader-contract.md"), "utf8");
  const contractRequirements = ["all six questions", "rule_coverage.covered", "numeric rules", "decision: pass",
    "decision: revise", "semantic precision", "reader clarity", "tests were executed"];
  if (!contractRequirements.every((value) => readerContract.includes(value))) {
    throw new Error("Self-test failed: compact reader contract is incomplete.");
  }
  process.stdout.write("Self-test passed.\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  const result = await run(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (["scope_blocked", "author_validation_failed", "validation_failed"].includes(result.status)) process.exitCode = 1;
  if (["analysis_required", "authoring_required", "reader_review_required"].includes(result.status)) process.exitCode = 2;
}

module.exports = { run };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
