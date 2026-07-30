#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { resolveCompactAnchor } = require("./summary_compaction");

function selectedAnchors(summary) {
  const anchors = [];
  for (const query of summary.ast && summary.ast.queries || []) {
    for (const group of query.groups || []) {
      if (group.firstAnchor) anchors.push({ anchor: group.firstAnchor, source: `ast:${query.id}:${group.key}` });
    }
  }
  for (const check of summary.sourceEvidence || []) {
    for (const group of check.groups || []) {
      if (group.firstAnchor) anchors.push({ anchor: group.firstAnchor, source: `source:${check.id}:${group.key}` });
    }
  }
  return anchors;
}

function resolveAnchor(summary, value) {
  const anchor = value && value.anchor;
  if (!anchor) return null;
  if (anchor.fileId !== undefined) {
    const resolved = resolveCompactAnchor(summary, anchor);
    return resolved ? { ...resolved, source: value.source } : null;
  }
  const line = anchor.line ?? (anchor.range && anchor.range.start && anchor.range.start.line);
  const endLine = anchor.endLine ?? (anchor.range && anchor.range.end && anchor.range.end.line) ?? line;
  return anchor.file && Number.isFinite(line) ? { file: path.resolve(anchor.file), line, endLine, source: value.source } : null;
}

function mergeRanges(anchors, contextBefore, contextAfter) {
  const ranges = anchors.map((anchor) => ({
    file: anchor.file,
    startLine: Math.max(1, anchor.line - contextBefore),
    endLine: Math.max(anchor.line, anchor.endLine || anchor.line) + contextAfter,
    sources: new Set([anchor.source]),
  })).sort((left, right) => left.file.localeCompare(right.file) || left.startLine - right.startLine || left.endLine - right.endLine);
  const merged = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && previous.file === range.file && range.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, range.endLine);
      for (const source of range.sources) previous.sources.add(source);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function truncateLine(value, maxChars) {
  const text = String(value);
  return text.length <= maxChars ? { text, clipped: false } : { text: `${text.slice(0, Math.max(0, maxChars - 1))}…`, clipped: true };
}

function buildSourceSlices(summary, options = {}) {
  const contextBefore = Math.max(0, options.contextBefore === undefined ? 1 : Number(options.contextBefore) || 0);
  const contextAfter = Math.max(0, options.contextAfter === undefined ? 1 : Number(options.contextAfter) || 0);
  const maxLines = Math.max(1, Number(options.maxLines) || 120);
  const maxSlices = Math.max(1, Number(options.maxSlices) || 40);
  const maxLineChars = Math.max(40, Number(options.maxLineChars) || 400);
  const resolved = selectedAnchors(summary).map((value) => resolveAnchor(summary, value)).filter(Boolean);
  const ranges = mergeRanges(resolved, contextBefore, contextAfter);
  const slices = [];
  let returnedLines = 0;
  let clippedLines = 0;
  let rangeTruncated = false;

  for (const range of ranges) {
    if (slices.length >= maxSlices || returnedLines >= maxLines) break;
    let lines;
    try { lines = fs.readFileSync(range.file, "utf8").split(/\r?\n/); } catch { continue; }
    const startLine = Math.min(range.startLine, lines.length);
    const availableEnd = Math.min(range.endLine, lines.length);
    const endLine = Math.min(availableEnd, startLine + (maxLines - returnedLines) - 1);
    if (endLine < startLine) continue;
    if (endLine < availableEnd) rangeTruncated = true;
    const selected = [];
    for (let line = startLine; line <= endLine; line += 1) {
      const compact = truncateLine(lines[line - 1], maxLineChars);
      if (compact.clipped) clippedLines += 1;
      selected.push({ line, text: compact.text });
    }
    returnedLines += selected.length;
    slices.push({ file: range.file, startLine, endLine, sources: [...range.sources].sort(), lines: selected });
  }

  return {
    schemaVersion: "1.0.0",
    status: "source-slices",
    coverage: {
      anchorsSelected: resolved.length,
      rangesAfterMerge: ranges.length,
      slicesReturned: slices.length,
      linesReturned: returnedLines,
      clippedLines,
      truncated: rangeTruncated || slices.length < ranges.length,
      limits: { contextBefore, contextAfter, maxLines, maxSlices, maxLineChars },
    },
    slices,
  };
}

function parseArgs(argv) {
  const options = {};
  const names = new Set(["--input", "--output", "--context-before", "--context-after", "--max-lines", "--max-slices", "--max-line-chars"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!names.has(arg)) throw new Error(`Unknown option: ${arg}`);
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = argv[++index];
  }
  if (!options.input) throw new Error("Provide --input <summary.json>");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const summary = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
    const output = buildSourceSlices(summary, options);
    const text = `${JSON.stringify(output)}\n`;
    if (options.output) fs.writeFileSync(path.resolve(options.output), text);
    process.stdout.write(text);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { buildSourceSlices, mergeRanges, parseArgs, resolveAnchor, selectedAnchors };
