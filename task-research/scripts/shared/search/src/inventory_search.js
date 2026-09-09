"use strict";

const fs = require("fs");

const path = require("path");

const ALWAYS_SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".zip", ".rar", ".7z", ".gz", ".pdf", ".docx", ".xlsx", ".pptx", ".pack"]);

function splitTerms(value) {
  return String(value || "").split(",").map((x) => x.trim()).filter(Boolean);
}

function isExcluded(filePath, includeNoise, excludePatterns = []) {
  if (includeNoise) return false;
  return excludePatterns.some((re) => re.test(filePath));
}

function isProbablyBinary(buffer) {
  const max = Math.min(buffer.length, 4096);
  for (let i = 0; i < max; i += 1) if (buffer[i] === 0) return true;
  return false;
}

function listFiles(scope, includeNoise, seen = new Set(), excludePatterns = []) {
  const out = [];
  let stat;
  try { stat = fs.statSync(scope); } catch { return out; }
  let real;
  try { real = fs.realpathSync(scope); } catch { real = path.resolve(scope); }
  if (seen.has(real)) return out;
  if (stat.isDirectory()) seen.add(real);
  if (stat.isFile()) return isExcluded(scope, includeNoise, excludePatterns) ? out : [scope];
  if (!stat.isDirectory()) return out;
  let entries;
  try { entries = fs.readdirSync(scope, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(scope, entry.name);
    if (isExcluded(full, includeNoise, excludePatterns)) continue;
    if (entry.isDirectory() || entry.isSymbolicLink()) out.push(...listFiles(full, includeNoise, seen, excludePatterns));
    else if (entry.isFile()) {
      if (ALWAYS_SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      out.push(full);
    }
  }
  return out;
}

function classify() { return "unclassified"; }

function evidenceType(group, layer, text) {
  if (layer === "noise") return "noise";
  if (group === "analog") return "analog-evidence";
  if (/read|write|serialize|fromjson|tojson|binary|export|import/i.test(text)) return "persistence-path";
  if (/draw|render|paint|graphics|canvas|print/i.test(text)) return "output-path";
  if (/class|function|prototype|interface|type|enum|const|let|var|this\./i.test(text)) return "direct-or-structural";
  return "candidate";
}

function makeMatcher(term, args) {
  if (args.regex) {
    const flags = args.ignoreCase ? "i" : "";
    return (line) => new RegExp(term, flags).test(line);
  }
  const needle = args.ignoreCase ? term.toLowerCase() : term;
  return (line) => (args.ignoreCase ? line.toLowerCase() : line).includes(needle);
}

function searchTerm(files, group, term, args, remaining) {
  const rows = [];
  const match = makeMatcher(term, args);
  for (const file of files) {
    if (rows.length >= remaining) break;
    let buffer;
    try { buffer = fs.readFileSync(file); } catch { continue; }
    if (isProbablyBinary(buffer)) continue;
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!match(lines[i])) continue;
      const layer = classify(file);
      rows.push({ group, term, file, line: i + 1, layer, evidence: evidenceType(group, layer, lines[i]), text: lines[i].trim(), searchType: "content" });
      if (rows.length >= remaining) break;
    }
  }
  return rows;
}

function searchPathTerm(files, group, term, args, remaining) {
  const rows = [];
  const match = makeMatcher(term, args);
  for (const file of files) {
    if (rows.length >= remaining) break;
    if (!match(file)) continue;
    const layer = classify(file);
    rows.push({ group, term, file, line: 0, layer, evidence: layer === "noise" ? "noise" : "file-name", text: path.basename(file), searchType: "file-name" });
  }
  return rows;
}

function summarize(rows) {
  const summary = {};
  for (const row of rows) {
    const key = `${row.group}/${row.layer}`;
    summary[key] ||= { group: row.group, layer: row.layer, hits: 0, files: new Set() };
    summary[key].hits += 1;
    summary[key].files.add(row.file);
  }
  return Object.values(summary).map((item) => ({ group: item.group, layer: item.layer, hits: item.hits, files: item.files.size }));
}

function mdEscape(value) { return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " "); }

function toMarkdown(result) {
  const out = [];
  out.push("# Inventory Search", "");
  out.push(`Scopes: ${result.scopes.map((x) => `\`${x}\``).join(", ")}`);
  out.push(`Noise filters: ${result.includeNoise ? "disabled" : "enabled"}`, "");
  out.push("## Terms", "", "| group | terms |", "| --- | --- |");
  for (const group of result.groups) out.push(`| ${mdEscape(group.group)} | ${group.terms.map((x) => `\`${mdEscape(x)}\``).join(", ")} |`);
  out.push("", "## Summary", "", "| group | layer | hits | files |", "| --- | --- | --- | --- |");
  for (const item of result.summary) out.push(`| ${item.group} | ${item.layer} | ${item.hits} | ${item.files} |`);
  out.push("", "## Hits", "", "| group | term | search type | layer | evidence | file | line | text |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of result.rows) out.push(`| ${mdEscape(row.group)} | ${mdEscape(row.term)} | ${row.searchType || "content"} | ${row.layer} | ${row.evidence} | ${mdEscape(row.file)} | ${row.line || "path"} | ${mdEscape(row.text).slice(0, 220)} |`);
  if (result.errors.length) out.push("", "## Errors", ...result.errors.map((x) => `- ${x}`));
  return out.join("\n");
}

module.exports = { splitTerms, listFiles, searchPathTerm, searchTerm, summarize, toMarkdown };

function runSearch(args) {
    const files = [];
    for (const scope of args.scopes)files.push(...listFiles(scope, args.includeNoise, new Set(), args.excludePatterns));
    const rows = [];
    const errors = [];
    for (const group of args.groups){
        for (const term of group.terms){
            rows.push(...searchPathTerm(files, group.group, term, args, Math.max(args.limit - rows.length, 0)));
            rows.push(...searchTerm(files, group.group, term, args, Math.max(args.limit - rows.length, 0)));
        }
    }
    const output = {
        scopes: args.scopes.map((scope)=>path.normalize(scope)),
        groups: args.groups,
        includeNoise: args.includeNoise,
        filesScanned: files.length,
        summary: summarize(rows),
        rows,
        errors
    };
    return output;
}
module.exports.runSearch = runSearch;
