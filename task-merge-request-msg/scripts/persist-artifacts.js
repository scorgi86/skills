#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function persist(runDir, destination) {
  const validation = readJson(path.join(runDir, "validation.json"));
  if (!validation.passed) throw new Error("Cannot persist an unvalidated PR description.");
  const review = readJson(path.join(runDir, "editorial-review.json"));
  if (!review.passed || review.issues.some((issue) => issue.severity === "must_fix")) {
    throw new Error("Cannot persist a PR description that failed editorial review.");
  }

  const scope = readJson(path.join(runDir, "scope.json"));
  if (!scope.context || !scope.context.artifact_directory) {
    throw new Error("scope.json does not contain context.artifact_directory.");
  }

  const expectedDestination = path.resolve(scope.context.artifact_directory);
  if (path.resolve(destination).toLowerCase() !== expectedDestination.toLowerCase()) {
    throw new Error("Destination does not match scope.context.artifact_directory.");
  }

  fs.mkdirSync(destination, { recursive: true });
  const mappings = [
    ["draft.md", "pr-description.md"],
    ["scope.json", "scope.json"],
    ["facts.json", "facts.json"],
    ["author-output.json", "author-output.json"],
    ["outline.json", "outline.json"],
    ["editorial-review.json", "editorial-review.json"],
    ["revision.json", "revision.json"],
    ["model-usage.json", "model-usage.json"],
    ["validation.json", "validation.json"]
  ];
  const artifacts = [];

  for (const [sourceName, destinationName] of mappings) {
    const source = path.join(runDir, sourceName);
    if (!fs.existsSync(source)) {
      if (sourceName === "author-output.json" || sourceName === "outline.json" ||
          sourceName === "revision.json" || sourceName === "model-usage.json") {
        const stale = path.join(destination, destinationName);
        if (fs.existsSync(stale)) fs.unlinkSync(stale);
        continue;
      }
      throw new Error(`Required artifact is missing: ${sourceName}`);
    }
    fs.copyFileSync(source, path.join(destination, destinationName));
    artifacts.push(destinationName);
  }

  const manifest = {
    schema_version: 1,
    persisted_at: new Date().toISOString(),
    source: {
      repositories: scope.repositories,
      task_id: scope.context.task_id || null
    },
    artifacts
  };
  fs.writeFileSync(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { destination, artifacts: artifacts.concat("manifest.json") };
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr-message-persist-"));
  const runDir = path.join(root, "run");
  const destination = path.join(root, "destination");
  fs.mkdirSync(runDir);
  fs.mkdirSync(destination);
  const writeJson = (name, value) => fs.writeFileSync(path.join(runDir, name), `${JSON.stringify(value)}\n`, "utf8");
  writeJson("validation.json", { passed: true });
  writeJson("editorial-review.json", { passed: true, issues: [] });
  writeJson("scope.json", { context: { artifact_directory: destination }, repositories: [] });
  writeJson("facts.json", { schema_version: 1 });
  fs.writeFileSync(path.join(runDir, "draft.md"), "Draft\n", "utf8");
  fs.writeFileSync(path.join(destination, "revision.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(destination, "model-usage.json"), "{}\n", "utf8");
  try {
    const result = persist(runDir, destination);
    if (!result.artifacts.includes("pr-description.md") ||
        fs.existsSync(path.join(destination, "revision.json")) ||
        fs.existsSync(path.join(destination, "model-usage.json"))) {
      throw new Error("Self-test failed: required or stale optional artifacts are invalid.");
    }
    process.stdout.write("Self-test passed.\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  if (!args.runDir || !args.destination) {
    throw new Error("Use --run-dir <directory> --destination <directory> or --self-test.");
  }
  const result = persist(path.resolve(args.runDir), path.resolve(args.destination));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { persist };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
