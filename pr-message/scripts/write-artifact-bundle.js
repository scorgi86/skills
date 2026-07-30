#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ALLOWED_ARTIFACTS = {
  "scope.json": "json",
  "facts.json": "json",
  "author-output.json": "json",
  "outline.json": "json",
  "draft.md": "text",
  "editorial-review.json": "json",
  "revision.json": "json",
  "model-usage.json": "json"
};

function parseArgs(argv) {
  const args = { runDir: null, bundle: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir") args.runDir = argv[++i];
    else if (arg === "--bundle") args.bundle = argv[++i];
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizeBundle(bundle) {
  if (!bundle || bundle.schema_version !== 1 || !Array.isArray(bundle.artifacts) || !bundle.artifacts.length) {
    throw new Error("Artifact bundle does not match schema version 1.");
  }
  const seen = new Set();
  return bundle.artifacts.map((artifact) => {
    const expectedFormat = ALLOWED_ARTIFACTS[artifact.path];
    if (!expectedFormat) throw new Error(`Artifact is not allowed: ${artifact.path || "<empty>"}.`);
    if (seen.has(artifact.path)) throw new Error(`Duplicate artifact in bundle: ${artifact.path}.`);
    seen.add(artifact.path);
    if (artifact.format !== expectedFormat) {
      throw new Error(`Artifact ${artifact.path} must use format ${expectedFormat}.`);
    }
    if (expectedFormat === "json" && (!artifact.content || typeof artifact.content !== "object" || Array.isArray(artifact.content))) {
      throw new Error(`Artifact ${artifact.path} must contain a JSON object.`);
    }
    if (expectedFormat === "text" && typeof artifact.content !== "string" &&
        !(Array.isArray(artifact.content) && artifact.content.every((line) => typeof line === "string"))) {
      throw new Error(`Artifact ${artifact.path} must contain text or an array of text lines.`);
    }
    return artifact;
  });
}

function writeArtifactBundle(runDir, bundle) {
  runDir = path.resolve(runDir);
  const artifacts = normalizeBundle(bundle);
  fs.mkdirSync(runDir, { recursive: true });

  const rendered = artifacts.map((artifact) => ({
    path: artifact.path,
    content: artifact.format === "json" ? `${JSON.stringify(artifact.content, null, 2)}\n` :
      Array.isArray(artifact.content) ? `${artifact.content.join("\n")}\n` : artifact.content
  }));
  for (const artifact of rendered) {
    fs.writeFileSync(path.join(runDir, artifact.path), artifact.content, "utf8");
  }
  return { run_directory: runDir, artifacts: rendered.map((artifact) => artifact.path) };
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr-message-bundle-"));
  try {
    const result = writeArtifactBundle(root, {
      schema_version: 1,
      artifacts: [
        { path: "facts.json", format: "json", content: { schema_version: 1, items: [] } },
        { path: "draft.md", format: "text", content: "Title\n" }
      ]
    });
    if (result.artifacts.length !== 2 || !fs.existsSync(path.join(root, "facts.json")) ||
        fs.readFileSync(path.join(root, "draft.md"), "utf8") !== "Title\n") {
      throw new Error("Self-test failed: artifact bundle was not written.");
    }
    let blocked = false;
    try {
      writeArtifactBundle(root, {
        schema_version: 1,
        artifacts: [{ path: "../outside.json", format: "json", content: {} }]
      });
    } catch (error) {
      blocked = error.message.includes("not allowed");
    }
    if (!blocked) throw new Error("Self-test failed: unsafe artifact path was accepted.");
    process.stdout.write("Self-test passed.\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  if (!args.runDir || !args.bundle) {
    throw new Error("Use --run-dir <directory> --bundle <bundle.json> or --self-test.");
  }
  const result = writeArtifactBundle(args.runDir, readJson(path.resolve(args.bundle)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { normalizeBundle, writeArtifactBundle };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
