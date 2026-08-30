#!/usr/bin/env node
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const args = { repo: process.cwd(), base: null, output: null, diffOutput: null, includeWorktree: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--base") args.base = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--diff-output") args.diffOutput = argv[++i];
    else if (arg === "--include-worktree") args.includeWorktree = true;
    else if (arg === "--exclude-worktree") args.includeWorktree = false;
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function git(repo, args, allowFailure = false) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim());
  }
  return (result.stdout || "").trim();
}

function gitNoIndex(repo, args) {
  const result = spawnSync("git", ["diff", "--no-index", ...args], {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error((result.stderr || result.stdout || "git diff --no-index failed").trim());
  }
  return (result.stdout || "").trim();
}

function lines(value) {
  return value ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

function unique(values) {
  return Array.from(new Set(values)).sort();
}

function summarizeNumstat(value) {
  const summary = { files: 0, insertions: 0, deletions: 0, binary_files: 0 };
  for (const line of lines(value)) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    summary.files++;
    if (/^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      summary.insertions += Number(parts[0]);
      summary.deletions += Number(parts[1]);
    } else {
      summary.binary_files++;
    }
  }
  return summary;
}

function addStats(left, right) {
  return {
    files: left.files + right.files,
    insertions: left.insertions + right.insertions,
    deletions: left.deletions + right.deletions,
    binary_files: left.binary_files + right.binary_files
  };
}

function collectUntracked(repo, files) {
  const numstat = [];
  const patches = [];
  for (const file of files) {
    numstat.push(gitNoIndex(repo, ["--numstat", "--", "NUL", file]));
    patches.push(gitNoIndex(repo, ["--binary", "--", "NUL", file]));
  }
  return {
    stats: summarizeNumstat(numstat.filter(Boolean).join("\n")),
    diff: patches.filter(Boolean).join("\n")
  };
}

function getComplexityHints(diff, stats) {
  const changedLines = diff.split(/\r?\n/).filter((line) =>
    (/^[+-]/.test(line) && !/^\+\+\+|^---/.test(line))
  ).map((line) => line.slice(1)).join("\n");
  const signals = {
    algorithm_or_control_flow: /\b(if|else|for|while|switch|case|try|catch|finally)\b|\b(reduce|sort|calculate|score|threshold)\b|=>/.test(changedLines),
    state_transition: /\b(state|status|mode|phase|enabled|disabled)\b|\bthis\.[A-Za-z_$][\w$]*\s*=|\.set[A-Z][\w$]*\s*\(/.test(changedLines),
    api_contract: /\b(callback|event|handler|listener|interface|contract)\b|sendEvent\s*\(|module\.exports|exports\.|prototype\.[A-Za-z_$]|^\s*(export|public)\b/m.test(changedLines),
    insufficient_context: Boolean(diff && !/^@@/m.test(diff)) || Boolean(stats && stats.binary_files),
    large_diff: Boolean(stats && (stats.files > 20 || stats.insertions + stats.deletions > 500))
  };
  const reasons = Object.keys(signals).filter((name) => signals[name]);
  return {
    signals,
    reasons,
    source_context_required: signals.algorithm_or_control_flow || signals.state_transition ||
      signals.api_contract || signals.insufficient_context,
    suggested_route: reasons.length ? "expanded" : "simple"
  };
}

function collect(options) {
  const repo = path.resolve(options.repo);
  const topLevel = git(repo, ["rev-parse", "--show-toplevel"]);
  const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(repo, ["rev-parse", "HEAD"]);
  const statusLines = lines(git(repo, ["status", "--short"]));
  const trackedWorktreeFiles = lines(git(repo, ["diff", "--name-only", "HEAD"]));
  const untrackedFiles = unique(lines(git(repo, ["ls-files", "--others", "--exclude-standard"])));
  const worktreeFiles = unique([...trackedWorktreeFiles, ...untrackedFiles]);
  const untracked = collectUntracked(repo, untrackedFiles);
  let base = options.base;
  let baseSource = base ? "user" : "unknown";

  if (!base) {
    base = git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], true);
    if (base) baseSource = "remote_head";
  }

  const questions = [];
  let branchFiles = [];
  let commitSubjects = [];
  let diffRange = null;
  if (base) {
    const validBase = git(repo, ["rev-parse", "--verify", base], true);
    if (!validBase) {
      questions.push(`Base reference '${base}' is not available locally.`);
      base = null;
      baseSource = "unknown";
    } else {
      diffRange = `${base}...HEAD`;
      branchFiles = unique(lines(git(repo, ["diff", "--name-only", diffRange])));
      commitSubjects = lines(git(repo, ["log", "--no-merges", "--format=%s", `${base}..HEAD`]));
    }
  }
  if (!base) questions.push("Select the PR target/base branch.");

  const branchSet = new Set(branchFiles);
  const overlapFiles = worktreeFiles.filter((file) => branchSet.has(file));
  if (options.includeWorktree === null && overlapFiles.length) {
    questions.push("Confirm whether overlapping uncommitted changes belong to the PR scope.");
  }

  const branchStats = diffRange ? summarizeNumstat(git(repo, ["diff", "--numstat", diffRange])) : null;
  const worktreeStats = addStats(summarizeNumstat(git(repo, ["diff", "--numstat", "HEAD"])), untracked.stats);
  const selectedStats = base && options.includeWorktree === true ?
    addStats(summarizeNumstat(git(repo, ["diff", "--numstat", base])), untracked.stats) : branchStats;
  let selectedDiff = "";
  if (base) {
    const selectedRange = options.includeWorktree === true ? base : diffRange;
    selectedDiff = git(repo, ["diff", "--no-ext-diff", "--unified=5", selectedRange, "--"]);
    if (options.includeWorktree === true && untracked.diff) {
      selectedDiff = [selectedDiff, untracked.diff].filter(Boolean).join("\n");
    }
  }
  const selectedDiffText = selectedDiff ? `${selectedDiff}\n` : "";
  const selectedDiffMetadata = {
    sha256: crypto.createHash("sha256").update(selectedDiffText).digest("hex"),
    bytes: Buffer.byteLength(selectedDiffText, "utf8"),
    hunks: (selectedDiffText.match(/^@@/gm) || []).length,
    encoding: "utf8"
  };
  const analysisHints = getComplexityHints(selectedDiffText, selectedStats);

  const scope = {
    schema_version: 1,
    repositories: [{
      name: path.basename(topLevel),
      path: topLevel,
      branch,
      head,
      base,
      base_source: baseSource,
      diff_range: diffRange,
      commit_subjects: commitSubjects,
      include_worktree: options.includeWorktree === true,
      branch_files: branchFiles,
      worktree_files: worktreeFiles,
      overlap_files: overlapFiles,
      status_lines: statusLines,
      diff_stats: {
        branch: branchStats,
        worktree: worktreeStats,
        selected: selectedStats
      },
      selected_diff: selectedDiffMetadata,
      analysis_hints: analysisHints
    }],
    questions,
    ready: questions.length === 0
  };
  return { scope, selectedDiffText };
}

function runSelfTest() {
  const stats = summarizeNumstat("10\t2\tsrc/a.js\n-\t-\tasset.bin");
  if (stats.files !== 2 || stats.insertions !== 10 || stats.deletions !== 2 || stats.binary_files !== 1) {
    throw new Error("Self-test failed: numstat summary is invalid.");
  }
  const simple = getComplexityHints("diff --git a/a.md b/a.md\n@@ -1 +1 @@\n-old\n+new\n",
    { files: 1, insertions: 1, deletions: 1, binary_files: 0 });
  if (simple.source_context_required || simple.suggested_route !== "simple") {
    throw new Error("Self-test failed: simple diff was escalated.");
  }
  const complex = getComplexityHints(
    "diff --git a/a.js b/a.js\n@@ -1 +1 @@\n-old\n+if (this.mode) callback();\n",
    { files: 1, insertions: 1, deletions: 1, binary_files: 0 }
  );
  if (!complex.signals.algorithm_or_control_flow || !complex.signals.state_transition ||
      !complex.signals.api_contract || !complex.source_context_required || complex.suggested_route !== "expanded") {
    throw new Error("Self-test failed: complex diff was not escalated.");
  }
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pr-message-scope-"));
  try {
    git(repo, ["init"]);
    fs.writeFileSync(path.join(repo, ".gitignore"), "ignored.txt\n", "utf8");
    fs.writeFileSync(path.join(repo, "tracked.txt"), "tracked\n", "utf8");
    git(repo, ["add", ".gitignore", "tracked.txt"]);
    git(repo, ["-c", "user.name=Self Test", "-c", "user.email=self-test@example.invalid", "commit", "-m", "initial"]);
    fs.writeFileSync(path.join(repo, "untracked.txt"), "new file\n", "utf8");
    fs.writeFileSync(path.join(repo, "untracked.bin"), Buffer.from([0, 255, 1, 254]));
    fs.writeFileSync(path.join(repo, "ignored.txt"), "ignored\n", "utf8");

    const collected = collect({ repo, base: "HEAD", includeWorktree: true });
    const repository = collected.scope.repositories[0];
    if (!repository.worktree_files.includes("untracked.txt") || !repository.worktree_files.includes("untracked.bin") ||
        repository.worktree_files.includes("ignored.txt")) {
      throw new Error("Self-test failed: untracked file selection is invalid.");
    }
    if (repository.diff_stats.selected.files !== 2 || repository.diff_stats.selected.insertions !== 1 ||
        repository.diff_stats.selected.binary_files !== 1) {
      throw new Error("Self-test failed: untracked file stats are invalid.");
    }
    if (!/new file mode/.test(collected.selectedDiffText) || !/\+\+\+ b\/untracked\.txt/.test(collected.selectedDiffText) ||
        !/GIT binary patch/.test(collected.selectedDiffText)) {
      throw new Error("Self-test failed: untracked file patch is missing.");
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
  process.stdout.write("Self-test passed.\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return runSelfTest();
  const result = collect(options);
  const json = `${JSON.stringify(result.scope, null, 2)}\n`;
  if (options.output) {
    const output = path.resolve(options.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, json, "utf8");
  }
  else process.stdout.write(json);
  const diffOutput = options.diffOutput || (options.output ?
    path.join(path.dirname(path.resolve(options.output)), "selected.diff") : null);
  if (diffOutput) {
    const resolvedDiffOutput = path.resolve(diffOutput);
    fs.mkdirSync(path.dirname(resolvedDiffOutput), { recursive: true });
    fs.writeFileSync(resolvedDiffOutput, result.selectedDiffText, "utf8");
  }
}

module.exports = { collect, getComplexityHints, summarizeNumstat };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
