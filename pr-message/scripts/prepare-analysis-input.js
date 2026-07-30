#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCHEMA_VERSION = 1;
const PREPARER_VERSION = 7;
const DEFAULT_MAX_BYTES = 90000;

function parseArgs(argv) {
  const args = { scope: null, diff: null, output: null, modelOutput: null, maxBytes: DEFAULT_MAX_BYTES, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope") args.scope = argv[++i];
    else if (arg === "--diff") args.diff = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--model-output") args.modelOutput = argv[++i];
    else if (arg === "--max-bytes") args.maxBytes = Number(argv[++i]);
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function renderModelInput(input) {
  const lines = [
    `SOURCE|${input.source.repository}|${input.source.base}|${input.source.branch}|${input.source.selected_diff_sha256}`,
    "OUTPUT|author-output.json schema_version=1 with facts and a complete reviewer-oriented draft; each fact must cite only evidence_ids from this package; tests in code are not executed checks",
    "AUTHOR|Explain the problem, trigger, before/after execution flow, outcomes, exceptions, key algorithms/contracts/configuration values and ownership, reviewer risks and verification. For every feature_flag candidate, add a feature_flag fact with toggle.key, toggle.binding, toggle.default_state, toggle.enabled_behavior, toggle.disabled_behavior, toggle.scope and toggle.owner; name both key and binding in the draft. Never infer a binding from the source key. If any required toggle field is absent from evidence, record a blocking unknown and do not present the draft as ready. Inventory all test_added, test_updated and test_removed candidates in the draft, grouped separately from executed checks. Avoid implementation shorthand that has no observable meaning. In Semantic/Deep facts omit impact; put rationale in the draft."
  ];
  const candidateTags = new Map();
  for (const item of input.candidates) {
    const key = `${item[2]}\0${item[3]}`;
    if (!candidateTags.has(key)) candidateTags.set(key, []);
    candidateTags.get(key).push(`${item[0]}:${item[1]}`);
  }
  let evidenceIndex = 0;
  for (const file of input.files) {
    lines.push(`FILE|${file.path}|test=${file.test}|change=${file.change}|binary=${file.binary}|generated=${file.generated}|omitted=${file.omitted_lines}`);
    for (const entry of file.evidence) {
      const id = `E${++evidenceIndex}`;
      const tags = candidateTags.get(`${file.path}\0${entry[1]}`) || [];
      lines.push(`${id}|${entry[0]}${entry[1]}|${tags.length ? `{${tags.join(";")}}|` : ""}${entry[2]}`);
    }
  }
  if (input.truncation.truncated) lines.push("TRUNCATED|Some low-priority evidence was omitted by the byte budget.");
  return `${lines.join("\n")}\n`;
}

function buildEvidenceCatalog(input) {
  const catalog = new Map();
  let evidenceIndex = 0;
  for (const file of input.files || []) {
    for (const entry of file.evidence || []) {
      catalog.set(`E${++evidenceIndex}`, {
        repository: input.source.repository,
        path: file.path,
        line: entry[1],
        quote: entry[2]
      });
    }
  }
  return catalog;
}

function resolveAuthorEvidence(output, input) {
  if (!output || !output.facts || !Array.isArray(output.facts.items)) return output;
  const catalog = buildEvidenceCatalog(input);
  for (const item of output.facts.items) {
    if (Array.isArray(item.evidence)) {
      delete item.evidence_ids;
      continue;
    }
    if (!Array.isArray(item.evidence_ids) || !item.evidence_ids.length) {
      throw new Error(`Author fact has no evidence or evidence_ids: ${item.id || "<empty>"}.`);
    }
    item.evidence = item.evidence_ids.map((id) => {
      const evidence = catalog.get(id);
      if (!evidence) throw new Error(`Author fact references unknown evidence id: ${id}.`);
      return { ...evidence };
    });
    delete item.evidence_ids;
  }
  return output;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function uniqueObjects(values, key) {
  const seen = new Set();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function classifyFile(filePath, patch) {
  return {
    test: /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/i.test(filePath),
    change: /new file mode/m.test(patch) ? "added" : /deleted file mode/m.test(patch) ? "removed" : "updated",
    generated: /(^|\/)(dist|build|coverage|vendor)(\/|$)|\.min\.[^.]+$|(^|\/)(package-lock|yarn\.lock|pnpm-lock)/i.test(filePath),
    binary: /GIT binary patch|Binary files .* differ/.test(patch)
  };
}

function sanitize(text) {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
      /\b(api[_-]?key|access[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*["'][^"']+/i.test(text)) {
    return "[REDACTED: potential secret]";
  }
  return text;
}

function isUsefulTestLine(text) {
  return /\b(describe|it|test|expect|beforeEach|afterEach|mockImplementation|mockReturnValue|toBe|toEqual|toContain|toHaveBeenCalled)\b|^\s*\/\//.test(text);
}

function parseDiff(diff) {
  const sections = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const files = [];
  for (const section of sections) {
    const pathMatch = section.match(/^\+\+\+ b\/(.+)$/m);
    const headerMatch = section.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const filePath = pathMatch ? pathMatch[1] : headerMatch ? headerMatch[2] : null;
    if (!filePath) continue;
    const classification = classifyFile(filePath, section);
    const file = {
      path: filePath,
      test: classification.test,
      change: classification.change,
      generated: classification.generated,
      binary: classification.binary,
      evidence: [],
      omitted_lines: 0
    };
    if (classification.binary || classification.generated) {
      files.push(file);
      continue;
    }

    let oldLine = 0;
    let newLine = 0;
    let inHunk = false;
    for (const line of section.split(/\r?\n/)) {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        inHunk = true;
        continue;
      }
      if (!inHunk || line.startsWith("\\ No newline")) continue;
      if (line.startsWith("+") && !line.startsWith("+++")) {
        const text = sanitize(line.slice(1));
        if (!classification.test || isUsefulTestLine(text)) {
          file.evidence.push({ type: "add", line: newLine, text });
        } else file.omitted_lines++;
        newLine++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        const text = sanitize(line.slice(1));
        if (!classification.test || isUsefulTestLine(text)) {
          file.evidence.push({ type: "delete", line: oldLine, text });
        } else file.omitted_lines++;
        oldLine++;
      } else if (line.startsWith(" ")) {
        oldLine++;
        newLine++;
      }
    }
    files.push(file);
  }
  return files;
}

function candidate(type, value, file, entry) {
  return { type, value, path: file.path, line: entry.line, quote: entry.text.trim() };
}

function extractCandidates(files) {
  const candidates = [];
  for (const file of files) {
    for (const entry of file.evidence) {
      const text = entry.text;
      for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*(?:FEATURE|FLAG|TOGGLE)[A-Z0-9_]*)\s*=\s*["']([^"']+)["']/g)) {
        candidates.push(candidate("feature_flag", match[2], file, entry));
        candidates.push(candidate("toggle_binding", match[1], file, entry));
      }
      const testMatch = text.match(/\b(?:describe|it|test)\(\s*["']([^"']+)["']/);
      if (file.test && testMatch) {
        const testType = file.change === "added" ? "test_added" :
          file.change === "removed" || entry.type === "delete" ? "test_removed" : "test_updated";
        candidates.push(candidate(testType, testMatch[1], file, entry));
      }
      if (entry.type !== "add") continue;
      const symbolPatterns = [
        /\.prototype\.([A-Za-z_$][\w$]*)\s*=/g,
        /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=\s*(?:\{|function\b|class\b)/g,
        /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
        /\bclass\s+([A-Za-z_$][\w$]*)\b/g
      ];
      for (const pattern of symbolPatterns) {
        for (const match of text.matchAll(pattern)) candidates.push(candidate("symbol", match[1], file, entry));
      }
      for (const match of text.matchAll(/\bisEnabled\(\s*["']([^"']+)["']/g)) {
        candidates.push(candidate("feature_flag", match[1], file, entry));
      }
      for (const match of text.matchAll(/\b(?:sendEvent|trigger)\(\s*["']([^"']+)["']/g)) {
        candidates.push(candidate("event", match[1], file, entry));
      }
      for (const match of text.matchAll(/\b(?:choice|action|result)\s*===?\s*["']([^"']+)["']/g)) {
        candidates.push(candidate("callback_value", match[1], file, entry));
      }
      if (/\bcallback\b/i.test(text)) {
        for (const match of text.matchAll(/["']([^"']+)["']/g)) {
          candidates.push(candidate("callback_value", match[1], file, entry));
        }
      }
      if (/\b(threshold|limit|timeout|weight|score|mode)[A-Za-z0-9_$]*\s*[:=]/i.test(text)) {
        candidates.push(candidate("rule", text.trim(), file, entry));
      }
    }
  }
  return uniqueObjects(candidates, (item) => `${item.type}\0${item.value}\0${item.path}\0${item.line}`);
}

function compactOutputBytes(result) {
  const projected = {
    ...result,
    candidates: (result.candidates || []).map((item) => Array.isArray(item) ? item : [item.type, item.value, item.path, item.line]),
    files: (result.files || []).map((file) => ({
      ...file,
      evidence: (file.evidence || []).map((entry) => Array.isArray(entry) ? entry :
        [entry.type === "add" ? "+" : "-", entry.line, entry.text])
    }))
  };
  return Buffer.byteLength(JSON.stringify(projected), "utf8");
}

function compactToBudget(result, maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes < 10000) throw new Error("--max-bytes must be at least 10000.");
  let bytes = compactOutputBytes(result);
  if (bytes <= maxBytes) return;
  const candidateLines = new Map();
  for (const item of result.candidates || []) {
    if (!candidateLines.has(item.path)) candidateLines.set(item.path, []);
    candidateLines.get(item.path).push(item.line);
  }
  const removable = [];
  for (const file of result.files) {
    for (let i = 0; i < file.evidence.length; i++) {
      const entry = file.evidence[i];
      const distances = (candidateLines.get(file.path) || []).map((line) => Math.abs(line - entry.line));
      const candidateDistance = distances.length ? Math.min(...distances) : Number.POSITIVE_INFINITY;
      let priority = file.test ? 4 : entry.type === "delete" ? 3 : 2;
      if (candidateDistance === 0) priority = 0;
      else if (candidateDistance <= (file.test ? 1 : 4)) priority = 1;
      const compactEntry = [entry.type === "add" ? "+" : "-", entry.line, entry.text];
      removable.push({ file, index: i, priority, bytes: Buffer.byteLength(JSON.stringify(compactEntry), "utf8") + 1 });
    }
  }
  removable.sort((a, b) => b.priority - a.priority || b.index - a.index);
  const removed = new Map();
  for (const item of removable) {
    if (bytes <= maxBytes) break;
    if (!removed.has(item.file)) removed.set(item.file, new Set());
    removed.get(item.file).add(item.index);
    bytes -= item.bytes;
  }
  for (const [file, indexes] of removed) {
    file.evidence = file.evidence.filter((entry, index) => !indexes.has(index));
    file.omitted_lines += indexes.size;
  }
  result.truncation.truncated = true;
  result.truncation.output_bytes = compactOutputBytes(result);
}

function prepare(scope, diff, maxBytes = DEFAULT_MAX_BYTES) {
  if (!scope || scope.schema_version !== 1 || !Array.isArray(scope.repositories) || scope.repositories.length !== 1) {
    throw new Error("Scope must contain exactly one schema-version-1 repository.");
  }
  const repository = scope.repositories[0];
  const actualHash = sha256(diff);
  if (!repository.selected_diff || repository.selected_diff.sha256 !== actualHash) {
    throw new Error("selected.diff hash does not match scope.json.");
  }
  const files = parseDiff(diff);
  const result = {
    schema_version: SCHEMA_VERSION,
    preparer_version: PREPARER_VERSION,
    source: {
      repository: repository.name,
      branch: repository.branch,
      base: repository.base,
      head: repository.head,
      include_worktree: repository.include_worktree,
      selected_diff_sha256: actualHash,
      suggested_route: repository.analysis_hints && repository.analysis_hints.suggested_route
    },
    instructions: {
      output: "author-output.json schema version 1 with facts and a complete draft",
      evidence: "Use only paths, symbols, lines and quotes present in this package.",
      verification: "Classify changed test code as test_added, test_updated or test_removed; use check_run only for explicitly supplied executed checks."
    },
    candidates: extractCandidates(files),
    files,
    truncation: { max_bytes: maxBytes, truncated: false, output_bytes: 0 }
  };
  compactToBudget(result, maxBytes);
  const retainedLocations = new Set();
  for (const file of result.files) {
    for (const entry of file.evidence) retainedLocations.add(`${file.path}\0${entry.line}`);
  }
  result.candidates = result.candidates.filter((item) => retainedLocations.has(`${item.path}\0${item.line}`));
  result.candidates = result.candidates.map((item) => [item.type, item.value, item.path, item.line]);
  for (const file of result.files) {
    file.evidence = file.evidence.map((entry) => [entry.type === "add" ? "+" : "-", entry.line, entry.text]);
  }
  result.truncation.output_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  return result;
}

function runSelfTest() {
  const diff = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1 +1,5 @@",
    "-old();",
    "+const FEATURE_A_TOGGLE = \"featureA\";",
    "+Workbook.heavyRecalcOpenConfig = {};",
    "+Api.prototype.run = function() {",
    "+  Features.isEnabled(\"featureA\");",
    "+  sendEvent(\"eventA\");",
    "+  // callback returns \"recalculate\" or \"manual\".",
    "+};",
    "diff --git a/src/a.test.js b/src/a.test.js",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/a.test.js",
    "@@ -0,0 +1,2 @@",
    "+it(\"runs\", () => expect(true).toBe(true));",
    "+const noise = 1;",
    ""
  ].join("\n");
  const scope = {
    schema_version: 1,
    repositories: [{
      name: "fixture", branch: "feature", base: "main", head: "abc", include_worktree: true,
      selected_diff: { sha256: sha256(diff) }, analysis_hints: { suggested_route: "expanded" }
    }]
  };
  const result = prepare(scope, diff, 20000);
  const values = result.candidates.map((item) => `${item[0]}:${item[1]}`);
  if (!values.includes("symbol:Workbook.heavyRecalcOpenConfig") || !values.includes("symbol:run") ||
      !values.includes("feature_flag:featureA") || !values.includes("toggle_binding:FEATURE_A_TOGGLE") ||
      !values.includes("event:eventA") || !values.includes("callback_value:recalculate") ||
      !values.includes("callback_value:manual") || !values.includes("test_added:runs")) {
    throw new Error("Self-test failed: expected candidates were not extracted.");
  }
  if (result.files[1].evidence.some((item) => item[2].includes("noise")) || result.files[1].omitted_lines !== 1) {
    throw new Error("Self-test failed: test diff was not compacted.");
  }
  const modelInput = renderModelInput(result);
  if (!modelInput.includes("E1|") || !modelInput.includes("{symbol:Workbook.heavyRecalcOpenConfig}") ||
      modelInput.includes("CANDIDATE|")) {
    throw new Error("Self-test failed: evidence IDs or fused candidate tags are invalid.");
  }
  const compactAuthor = { facts: { items: [{ id: "C1", evidence_ids: ["E1"] }] } };
  resolveAuthorEvidence(compactAuthor, result);
  if (compactAuthor.facts.items[0].evidence[0].path !== "src/a.js" || compactAuthor.facts.items[0].evidence_ids) {
    throw new Error("Self-test failed: evidence ID was not expanded.");
  }
  const legacyEvidence = { path: "src/a.js", line: 10, quote: "legacy" };
  const legacyAuthor = { facts: { items: [{ id: "C0", evidence: [legacyEvidence], evidence_ids: ["E1"] }] } };
  resolveAuthorEvidence(legacyAuthor, result);
  if (legacyAuthor.facts.items[0].evidence[0] !== legacyEvidence || legacyAuthor.facts.items[0].evidence_ids) {
    throw new Error("Self-test failed: legacy full evidence compatibility is broken.");
  }
  let unknownEvidenceBlocked = false;
  try { resolveAuthorEvidence({ facts: { items: [{ id: "C2", evidence_ids: ["E999"] }] } }, result); }
  catch (error) { unknownEvidenceBlocked = error.message.includes("unknown evidence id"); }
  if (!unknownEvidenceBlocked) throw new Error("Self-test failed: unknown evidence ID was accepted.");
  let mismatchBlocked = false;
  try {
    prepare({ schema_version: 1, repositories: [{ selected_diff: { sha256: "bad" } }] }, diff, 20000);
  } catch (error) {
    mismatchBlocked = error.message.includes("hash");
  }
  if (!mismatchBlocked) throw new Error("Self-test failed: mismatched diff hash was accepted.");
  process.stdout.write("Self-test passed.\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  if (!args.scope || !args.diff || !args.output) {
    throw new Error("Use --scope <scope.json> --diff <selected.diff> --output <analysis-input.json>.");
  }
  const scope = JSON.parse(fs.readFileSync(path.resolve(args.scope), "utf8"));
  const diff = fs.readFileSync(path.resolve(args.diff), "utf8");
  const result = prepare(scope, diff, args.maxBytes);
  fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(result)}\n`, "utf8");
  const modelInput = renderModelInput(result);
  if (args.modelOutput) fs.writeFileSync(path.resolve(args.modelOutput), modelInput, "utf8");
  process.stdout.write(`${JSON.stringify({ output: path.resolve(args.output), bytes: result.truncation.output_bytes,
    model_output: args.modelOutput ? path.resolve(args.modelOutput) : null,
    model_bytes: Buffer.byteLength(modelInput, "utf8"), truncated: result.truncation.truncated }, null, 2)}\n`);
}

module.exports = { buildEvidenceCatalog, extractCandidates, parseDiff, prepare, renderModelInput, resolveAuthorEvidence, sanitize };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
