#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CACHE_SCHEMA_VERSION = 2;
const FACT_KINDS = new Set(["change", "flow", "rule", "contract", "feature_flag", "risk", "test_added", "check_run", "context"]);

function parseArgs(argv) {
  const args = {
    mode: null, input: null, cacheDir: null, facts: null, output: null,
    promptVersion: "1", model: "unspecified", selfTest: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode") args.mode = argv[++i];
    else if (arg === "--input") args.input = argv[++i];
    else if (arg === "--cache-dir") args.cacheDir = argv[++i];
    else if (arg === "--facts") args.facts = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--prompt-version") args.promptVersion = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stableKey(input, promptVersion, model) {
  if (!input || input.schema_version !== 1 || !input.source || !input.source.selected_diff_sha256) {
    throw new Error("analysis-input.json does not match schema version 1.");
  }
  const material = {
    cache_schema_version: CACHE_SCHEMA_VERSION,
    analysis_schema_version: input.schema_version,
    preparer_version: input.preparer_version,
    selected_diff_sha256: input.source.selected_diff_sha256,
    prompt_version: String(promptVersion),
    model: String(model)
  };
  return {
    key: crypto.createHash("sha256").update(JSON.stringify(material)).digest("hex"),
    material
  };
}

function entryPath(cacheDir, key) {
  return path.join(path.resolve(cacheDir), `${key}.json`);
}

function validateFacts(facts) {
  if (!facts || facts.schema_version !== 1 || !facts.summary || !Array.isArray(facts.items) ||
      !Array.isArray(facts.unknowns)) {
    throw new Error("facts.json does not match schema version 1.");
  }
  if (typeof facts.title !== "string" || !facts.title.trim() || !facts.architecture ||
      !Array.isArray(facts.architecture.before) || !facts.architecture.before.length ||
      !Array.isArray(facts.architecture.after) || !facts.architecture.after.length) {
    throw new Error("facts.json must contain title and non-empty before/after architecture.");
  }
  for (const item of facts.items) {
    if (!item.id || !FACT_KINDS.has(item.kind) || !item.statement || !Array.isArray(item.evidence)) {
      throw new Error(`facts.json contains an invalid fact: ${item.id || "<empty>"}.`);
    }
  }
}

function validateAuthorOutput(output) {
  if (!output || output.schema_version !== 1 || !output.facts ||
      typeof output.draft !== "string" || !output.draft.trim()) {
    throw new Error("author-output.json does not match schema version 1.");
  }
  validateFacts(output.facts);
}

function get(input, cacheDir, promptVersion, model) {
  const keyData = stableKey(input, promptVersion, model);
  const file = entryPath(cacheDir, keyData.key);
  if (!fs.existsSync(file)) return { hit: false, ...keyData, file };
  const entry = readJson(file);
  if (entry.schema_version !== CACHE_SCHEMA_VERSION || JSON.stringify(entry.key_material) !== JSON.stringify(keyData.material)) {
    return { hit: false, ...keyData, file, reason: "metadata_mismatch" };
  }
  if (entry.author_output) {
    validateAuthorOutput(entry.author_output);
  } else {
    validateFacts(entry.facts);
  }
  const authorOutput = entry.author_output || null;
  return {
    hit: true, ...keyData, file,
    facts: authorOutput ? authorOutput.facts : entry.facts,
    author_output: authorOutput,
    usage: entry.usage || null
  };
}

function put(input, value, cacheDir, promptVersion, model, usage) {
  const authorOutput = value && value.facts && value.draft ? value : null;
  if (authorOutput) validateAuthorOutput(authorOutput);
  else validateFacts(value);
  const keyData = stableKey(input, promptVersion, model);
  fs.mkdirSync(path.resolve(cacheDir), { recursive: true });
  const file = entryPath(cacheDir, keyData.key);
  const entry = {
    schema_version: CACHE_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    key_material: keyData.material,
    usage: usage || null,
    ...(authorOutput ? { author_output: authorOutput } : { facts: value })
  };
  fs.writeFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  return { hit: true, stored: true, ...keyData, file };
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr-message-cache-"));
  try {
    const input = {
      schema_version: 1,
      preparer_version: 1,
      source: { selected_diff_sha256: "abc" }
    };
    const facts = {
      schema_version: 1,
      title: "Cache fixture",
      summary: { problem: "p", solution: "s", outcome: "o" },
      architecture: { before: ["before"], after: ["after"] },
      items: [],
      unknowns: []
    };
    if (get(input, root, "1", "model-a").hit) throw new Error("Self-test failed: empty cache reported a hit.");
    const authorOutput = { schema_version: 1, facts, draft: "# Cache fixture\n" };
    put(input, authorOutput, root, "1", "model-a", { input_tokens: 10 });
    const hit = get(input, root, "1", "model-a");
    if (!hit.hit || hit.facts.summary.problem !== "p" || hit.author_output.draft !== "# Cache fixture\n") {
      throw new Error("Self-test failed: cached author output was not returned.");
    }
    if (get(input, root, "2", "model-a").hit || get(input, root, "1", "model-b").hit) {
      throw new Error("Self-test failed: cache key did not invalidate.");
    }
    process.stdout.write("Self-test passed.\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  if (!args.mode || !args.input || !args.cacheDir) {
    throw new Error("Use --mode get|put --input <analysis-input.json> --cache-dir <directory>.");
  }
  const input = readJson(path.resolve(args.input));
  if (args.mode === "get") {
    const result = get(input, args.cacheDir, args.promptVersion, args.model);
    if (result.hit && args.output) {
      fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(result.facts, null, 2)}\n`, "utf8");
    }
    const printable = { hit: result.hit, key: result.key, file: result.file, usage: result.usage || null };
    process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
    if (!result.hit) process.exitCode = 2;
    return;
  }
  if (args.mode === "put") {
    if (!args.facts) throw new Error("--facts is required for cache put.");
    const result = put(input, readJson(path.resolve(args.facts)), args.cacheDir, args.promptVersion, args.model, null);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  throw new Error(`Unknown cache mode: ${args.mode}`);
}

module.exports = { get, put, stableKey, validateAuthorOutput, validateFacts };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
