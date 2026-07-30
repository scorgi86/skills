#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_EXCLUDES = [
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])(vendor|vendors|third_party|bower_components|jspm_packages)([\\/]|$)/i,
  /(^|[\\/])(\.cache|\.next|\.turbo|\.parcel-cache|cache)([\\/]|$)/i,
  /(^|[\\/])\.webpack-cache([\\/]|$)/i,
  /(^|[\\/])(tmp|temp|dist|build|out|coverage|generated|gen)([\\/]|$)/i,
  /(^|[\\/])resources[\\/]help([\\/]|$)/i,
  /(^|[\\/])help([\\/]|$)/i,
  /(^|[\\/])search[\\/]indexes\\.js$/i,
  /(^|[\\/])webpack-data\\.js$/i,
  /(^|[\\/])locales?([\\/]|$)/i,
  /\.(map|min\.js|min\.css|bundle\.js|chunk\.js)$/i
];

const ALWAYS_SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".zip", ".rar", ".7z", ".gz", ".pdf", ".docx", ".xlsx", ".pptx", ".pack"]);

const LAYERS = [
  ["ui", /(^|[\\/])(web-apps|apps|view|views|toolbar|dialog|panel|menu|mobile)([\\/]|$)/i],
  ["api", /(^|[\\/])(api|sdk|dto|controller|command|common)([\\/]|$)|\b(api|dto|asc_)/i],
  ["model", /(^|[\\/])(model|models|format|drawings|common|word|cell|slide)([\\/]|$)/i],
  ["serialization", /serialize|serializer|binary|ooxml|docx|xlsx|pptx|fromjson|tojson|read|write/i],
  ["render-output", /render|renderer|draw|paint|canvas|graphics|metafile|pdf|print|export/i],
  ["tests-fixtures", /(^|[\\/])(test|tests|spec|fixtures|samples?)([\\/]|$)|\.(test|spec)\./i],
  ["noise", /(^|[\\/])(locale|locales|help|assets|images|css|less|scss|dist|build|vendor|vendors|third_party|node_modules|coverage|generated|gen|cache|\.cache|\.next|\.turbo|\.parcel-cache|\.webpack-cache)([\\/]|$)|\.(css|less|scss|svg|png|jpg|jpeg|gif|map)$/i]
];

function splitTerms(value) {
  return String(value || "").split(",").map((x) => x.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const args = { groups: [], scopes: [], json: false, ignoreCase: true, regex: false, includeNoise: false, limit: 1000, out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--term") args.groups.push({ group: "seed", terms: [argv[++i]] });
    else if (arg === "--terms" || arg === "--seed") args.groups.push({ group: "seed", terms: splitTerms(argv[++i]) });
    else if (arg === "--owner") args.groups.push({ group: "owner", terms: splitTerms(argv[++i]) });
    else if (arg === "--recipient") args.groups.push({ group: "recipient", terms: splitTerms(argv[++i]) });
    else if (arg === "--analog") args.groups.push({ group: "analog", terms: splitTerms(argv[++i]) });
    else if (arg === "--group") {
      const raw = argv[++i] || "";
      const idx = raw.indexOf(":");
      args.groups.push({ group: idx >= 0 ? raw.slice(0, idx) : "custom", terms: splitTerms(idx >= 0 ? raw.slice(idx + 1) : raw) });
    } else if (arg === "--scope") args.scopes.push(argv[++i]);
    else if (arg === "--json") args.json = true;
    else if (arg === "--case-sensitive") args.ignoreCase = false;
    else if (arg === "--regex") args.regex = true;
    else if (arg === "--include-noise") args.includeNoise = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]) || args.limit;
    else if (arg === "--out") args.out = argv[++i] || "";
    else if (arg === "--follow-links" || arg === "--no-follow-links") {
      // File-system traversal is native in this script; kept for CLI compatibility.
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      args.groups.push({ group: "seed", terms: [arg] });
    }
  }
  if (args.scopes.length === 0) args.scopes.push(".");
  args.groups = args.groups.map((g) => ({ group: g.group || "seed", terms: (g.terms || []).filter(Boolean) })).filter((g) => g.terms.length);
  return args;
}

function usage() {
  console.log(`Usage:
  node inventory_search.js --seed innerShdw,CInnerShdw --owner CSpPr,EffectLst --scope sdkjs --scope web-apps

Options:
  --seed a,b          direct target terms
  --owner a,b         owner/container terms
  --recipient a,b     recipient/object-family terms
  --analog a,b        analogous mechanism terms
  --group name:a,b    custom group
  --scope path        repeatable search scope
  --include-noise     search excluded noise zones too; report these results separately as generated/vendor/cache evidence
  --regex             treat terms as regex
  path search         file and directory names are searched automatically
  --json              emit JSON
  --out file          write output to file as UTF-8
`);
}

function isExcluded(filePath, includeNoise) {
  if (includeNoise) return false;
  return DEFAULT_EXCLUDES.some((re) => re.test(filePath));
}

function isProbablyBinary(buffer) {
  const max = Math.min(buffer.length, 4096);
  for (let i = 0; i < max; i += 1) if (buffer[i] === 0) return true;
  return false;
}

function listFiles(scope, includeNoise, seen = new Set()) {
  const out = [];
  let stat;
  try { stat = fs.statSync(scope); } catch { return out; }
  let real;
  try { real = fs.realpathSync(scope); } catch { real = path.resolve(scope); }
  if (seen.has(real)) return out;
  if (stat.isDirectory()) seen.add(real);
  if (stat.isFile()) return isExcluded(scope, includeNoise) ? out : [scope];
  if (!stat.isDirectory()) return out;
  let entries;
  try { entries = fs.readdirSync(scope, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(scope, entry.name);
    if (isExcluded(full, includeNoise)) continue;
    if (entry.isDirectory() || entry.isSymbolicLink()) out.push(...listFiles(full, includeNoise, seen));
    else if (entry.isFile()) {
      if (ALWAYS_SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      out.push(full);
    }
  }
  return out;
}

function classify(filePath) {
  for (const [layer, re] of LAYERS) if (re.test(filePath)) return layer;
  return "other";
}

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.groups.length) {
    console.error("ERROR: pass at least one term group");
    usage();
    process.exit(2);
  }
  const files = [];
  for (const scope of args.scopes) files.push(...listFiles(scope, args.includeNoise));
  const rows = [];
  const errors = [];
  for (const group of args.groups) {
    for (const term of group.terms) {
      rows.push(...searchPathTerm(files, group.group, term, args, Math.max(args.limit - rows.length, 0)));
      rows.push(...searchTerm(files, group.group, term, args, Math.max(args.limit - rows.length, 0)));
    }
  }
  const output = { scopes: args.scopes.map((scope) => path.normalize(scope)), groups: args.groups, includeNoise: args.includeNoise, filesScanned: files.length, summary: summarize(rows), rows, errors };
  const rendered = args.json ? JSON.stringify(output, null, 2) : toMarkdown(output);
  if (args.out) fs.writeFileSync(args.out, rendered, "utf8"); else console.log(rendered);
}

main();