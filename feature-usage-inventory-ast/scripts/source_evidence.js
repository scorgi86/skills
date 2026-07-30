#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { stableHash } = require("./fact_projection");

const DEFAULT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".xml"]);
const EXCLUDED = new Set([".git", "node_modules", "dist", "build", "out", "coverage"]);

function shouldTraverseEntry(entry, options) {
  if (options.excludeDirs.has(entry.name)) return false;
  return options.followSymlinks || !entry.isSymbolicLink();
}

function isExcludedFile(file, options) {
  return options.excludeFilePatterns.some((pattern) => pattern.test(file));
}

function createTraversalOptions(request = {}, check = {}) {
  const names = [...EXCLUDED, ...(request.excludeDirs || []), ...(check.excludeDirs || [])].map((value) => String(value));
  const patterns = [...(request.excludeFilePatterns || []), ...(check.excludeFilePatterns || [])].map((value) => value instanceof RegExp ? value : new RegExp(String(value)));
  return {
    excludeDirs: new Set(names),
    excludeFilePatterns: patterns,
    followSymlinks: check.followSymlinks === true || (check.followSymlinks === undefined && request.followSymlinks === true),
  };
}

function listFiles(entry, extensions, seen = new Set(), options = createTraversalOptions()) {
  const resolved = path.resolve(entry);
  let stat;
  try { stat = fs.statSync(resolved); } catch { return []; }
  const real = fs.realpathSync(resolved);
  if (seen.has(real)) return [];
  if (stat.isFile()) return extensions.has(path.extname(resolved).toLowerCase()) && !isExcludedFile(resolved, options) ? [resolved] : [];
  if (!stat.isDirectory()) return [];
  seen.add(real);
  const files = [];
  for (const child of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (options.excludeDirs.has(child.name)) continue;
    const full = path.join(resolved, child.name);
    if ((child.isDirectory() || child.isSymbolicLink()) && shouldTraverseEntry(child, options)) files.push(...listFiles(full, extensions, seen, options));
    else if (child.isFile() && extensions.has(path.extname(child.name).toLowerCase()) && !isExcludedFile(full, options)) files.push(full);
  }
  return files;
}

function compilePattern(pattern) {
  const value = typeof pattern === "string" ? { value: pattern } : pattern;
  if (!value || !value.value) throw new Error("Evidence pattern requires value");
  if (value.regex) return new RegExp(value.value, value.caseSensitive ? "g" : "gi");
  const escaped = value.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, value.caseSensitive ? "g" : "gi");
}

function evidenceGroupIdentity(check, file, patternId) {
  const mode = check.groupBy || "file-pattern";
  if (mode === "file") return { label: file, identity: { file } };
  if (mode === "pattern") return { label: patternId, identity: { patternId } };
  return { label: `${path.basename(file)} :: ${patternId}`, identity: { file, patternId } };
}

function selectRoundRobin(groups, limit) {
  const queues = groups.map((group) => [...group.candidates]);
  const selected = [];
  const seen = new Set();
  while (selected.length < limit && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      while (queue.length) {
        const candidate = queue.shift();
        const identity = `${candidate.file}\u001f${candidate.line}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        selected.push(candidate);
        break;
      }
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function selectEvidenceGroups(groups, limit, requiredKeys = []) {
  const selected = [];
  const used = new Set();
  const add = (group) => {
    if (!group || used.has(group.key) || selected.length >= limit) return;
    used.add(group.key);
    selected.push(group);
  };
  for (const key of requiredKeys) add(groups.find((group) => group.key === key));
  const buckets = new Map();
  for (const group of groups) {
    if (used.has(group.key)) continue;
    const bucket = group.identity.patternId || group.identity.file || group.label;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(group);
  }
  const queues = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, values]) => values);
  while (selected.length < limit && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      add(queue.shift());
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function runEvidenceChecks(request) {
  if (!request || !Array.isArray(request.checks)) throw new Error("Evidence request requires checks array");
  const contentCache = new Map();
  return {
    schemaVersion: "1.1.0",
    checks: request.checks.map((check, index) => {
      const entries = check.files || (check.file ? [check.file] : check.scope ? [check.scope] : []);
      if (!entries.length) throw new Error(`Check ${check.id || index + 1} requires explicit file, files, or scope`);
      const extensions = new Set((check.extensions || [...DEFAULT_EXTENSIONS]).map((extension) => extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`));
      const traversal = createTraversalOptions(request, check);
      const files = [...new Set(entries.flatMap((entry) => listFiles(entry, extensions, new Set(), traversal)))];
      const maxFiles = Math.max(1, Number(check.maxFiles || request.maxFiles) || 200);
      if (files.length > maxFiles && !check.allowWideScope) throw new Error(`Evidence scope blocked for ${check.id || index + 1}: ${files.length} files exceeds ${maxFiles}`);
      const maxMatches = Math.max(1, Number(check.maxMatches || request.maxMatches) || 20);
      const maxSnippetChars = Math.max(20, Number(check.maxSnippetChars || request.maxSnippetChars) || 240);
      const patternSpecs = check.patterns || (check.pattern ? [check.pattern] : []);
      const patterns = patternSpecs.map((spec, patternIndex) => ({
        regex: compilePattern(spec),
        id: typeof spec === "object" && spec.id ? String(spec.id) : `pattern-${patternIndex + 1}`,
      }));
      if (!patterns.length) throw new Error(`Check ${check.id || index + 1} requires pattern or patterns`);

      const groupsByKey = new Map();
      const retainAllMatches = check.retainAllMatches === true || (check.retainAllMatches === undefined && request.retainAllMatches === true);
      const fullMatches = [];
      let totalMatches = 0;
      for (const file of files) {
        const cached = check.mode === "file-name" ? null : contentCache.get(file) || (() => {
          const content = fs.readFileSync(file, "utf8");
          const value = { content, lines: content.split(/\r?\n/) };
          contentCache.set(file, value);
          return value;
        })();
        const lines = check.mode === "file-name" ? [file] : cached.lines;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex];
          const matchedPatterns = patterns.filter(({ regex }) => { regex.lastIndex = 0; return regex.test(line); });
          if (!matchedPatterns.length) continue;
          totalMatches += 1;
          const snippet = line.replace(/\s+/g, " ").trim();
          for (const pattern of matchedPatterns) {
            const descriptor = evidenceGroupIdentity(check, file, pattern.id);
            const key = `se-${stableHash(descriptor.identity, 12)}`;
            if (!groupsByKey.has(key)) groupsByKey.set(key, { key, label: descriptor.label, identity: descriptor.identity, totalMatches: 0, candidates: [] });
            const group = groupsByKey.get(key);
            group.totalMatches += 1;
            group.candidates.push({
              file,
              line: check.mode === "file-name" ? null : lineIndex + 1,
              snippet: snippet.length > maxSnippetChars ? `${snippet.slice(0, maxSnippetChars - 1)}…` : snippet,
              groupKey: key,
            });
            if (retainAllMatches) fullMatches.push({ file, line: check.mode === "file-name" ? null : lineIndex + 1, snippet: snippet.length > maxSnippetChars ? `${snippet.slice(0, maxSnippetChars - 1)}…` : snippet, groupKey: key, patternId: pattern.id });
          }
        }
      }

      const allGroups = [...groupsByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
      const maxGroups = Math.max(1, Number(check.maxGroups || request.maxGroups) || 50);
      const selectedGroups = selectEvidenceGroups(allGroups, maxGroups, check.requiredGroupKeys || []);
      const matches = selectRoundRobin(selectedGroups, maxMatches);
      const returnedByGroup = new Map();
      for (const match of matches) returnedByGroup.set(match.groupKey, (returnedByGroup.get(match.groupKey) || 0) + 1);
      const groups = selectedGroups.map((group) => {
        const returned = returnedByGroup.get(group.key) || 0;
        const first = group.candidates[0];
        return {
          key: group.key,
          label: group.label,
          identity: group.identity,
          totalMatches: group.totalMatches,
          returned,
          truncated: returned < group.totalMatches,
          firstAnchor: first ? { file: first.file, line: first.line } : null,
        };
      });
      const result = {
        id: check.id || `check-${index + 1}`,
        spec: {
          entries: entries.map((entry) => path.resolve(entry)),
          patterns: patternSpecs.map((item) => typeof item === "string" ? { value: item } : { id: item.id || null, value: item.value, regex: Boolean(item.regex), caseSensitive: Boolean(item.caseSensitive) }),
          excludeDirs: [...traversal.excludeDirs].sort(),
          excludeFilePatterns: traversal.excludeFilePatterns.map((item) => item.source),
          followSymlinks: traversal.followSymlinks,
        },
        status: totalMatches ? "candidate" : "candidate-empty",
        filesScanned: files.length,
        totalMatches,
        returned: matches.length,
        truncated: matches.length < totalMatches,
        matches,
        groupDigest: stableHash(allGroups.map((group) => group.key)),
        groupsTotal: allGroups.length,
        groupsReturned: groups.length,
        groupsTruncated: groups.length < allGroups.length,
        groups,
      };
      if (retainAllMatches) result.fullMatches = fullMatches;
      return result;
    }),
  };
}

function parseArgs(argv) {
  const requestIndex = argv.indexOf("--request");
  const outputIndex = argv.indexOf("--output");
  if (requestIndex < 0 || !argv[requestIndex + 1]) throw new Error("Provide --request <json-file>");
  return { request: argv[requestIndex + 1], output: outputIndex >= 0 ? argv[outputIndex + 1] : null };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const output = runEvidenceChecks(JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8")));
    const text = `${JSON.stringify(output)}\n`;
    if (options.output) fs.writeFileSync(path.resolve(options.output), text);
    process.stdout.write(text);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { compilePattern, createTraversalOptions, evidenceGroupIdentity, isExcludedFile, listFiles, parseArgs, runEvidenceChecks, selectEvidenceGroups, selectRoundRobin, shouldTraverseEntry };
