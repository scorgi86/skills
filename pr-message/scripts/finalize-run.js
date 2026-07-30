#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { REVIEW_DIMENSIONS, loadRunDirectory, validate } = require("./validate-artifacts");
const { persist } = require("./persist-artifacts");

function parseArgs(argv) {
  const args = { runDir: null, destination: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir") args.runDir = argv[++i];
    else if (arg === "--destination") args.destination = argv[++i];
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function finalize(runDir, destination) {
  runDir = path.resolve(runDir);
  const data = loadRunDirectory(runDir);
  const validation = validate(data);
  writeJson(path.join(runDir, "validation.json"), validation);
  if (!validation.passed) {
    return { passed: false, validation, persistence: null };
  }

  const resolvedDestination = path.resolve(destination || data.scope.context.artifact_directory);
  const persistence = persist(runDir, resolvedDestination);
  return { passed: true, validation, persistence };
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr-message-finalize-"));
  const runDir = path.join(root, "run");
  const destination = path.join(root, "persisted");
  fs.mkdirSync(runDir);
  const draft = "Title\n\nSummary\n";
  const review = {
    schema_version: 1,
    iteration: 1,
    draft_sha256: crypto.createHash("sha256").update(draft).digest("hex"),
    passed: true,
    dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, "pass"])),
    issues: []
  };

  writeJson(path.join(runDir, "scope.json"), {
    schema_version: 1,
    repositories: [{}],
    context: { artifact_directory: destination },
    questions: [],
    ready: true
  });
  writeJson(path.join(runDir, "facts.json"), {
    schema_version: 1,
    title: "Finalize fixture",
    summary: { problem: "p", solution: "s", outcome: "o" },
    architecture: { before: ["before"], after: ["after"] },
    items: [{
      id: "C1", kind: "change", statement: "change", impact: "impact",
      evidence: [{ path: "src/a.js" }]
    }],
    unknowns: []
  });
  fs.writeFileSync(path.join(runDir, "draft.md"), draft, "utf8");
  writeJson(path.join(runDir, "editorial-review.json"), review);

  try {
    const success = finalize(runDir);
    if (!success.passed || !fs.existsSync(path.join(destination, "pr-description.md"))) {
      throw new Error("Self-test failed: valid run was not persisted.");
    }

    review.passed = false;
    review.dimensions.language_consistency = "fail";
    review.issues = [{ severity: "must_fix" }];
    writeJson(path.join(runDir, "editorial-review.json"), review);
    const blocked = finalize(runDir);
    if (blocked.passed || blocked.persistence !== null) {
      throw new Error("Self-test failed: invalid run was persisted.");
    }
    process.stdout.write("Self-test passed.\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  if (!args.runDir) throw new Error("Use --run-dir <directory> [--destination <directory>] or --self-test.");
  const result = finalize(args.runDir, args.destination);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

module.exports = { finalize };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
