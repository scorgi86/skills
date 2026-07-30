#!/usr/bin/env node

const { spawnSync } = require("child_process");
const path = require("path");

const LAYERS = [
  ["ui", /(^|[\\/])(web-apps|apps|view|views|toolbar|dialog|panel|menu|mobile)([\\/]|$)/i],
  ["api-dto", /(^|[\\/])(api|sdk|dto|asc|builder)([\\/]|$)|\b(api|dto|asc_)/i],
  ["model", /(^|[\\/])(model|models|common|drawing|word|cell|slide)([\\/]|$)/i],
  ["serializer-import-export", /serialize|serializer|binary|ooxml|docx|xlsx|pptx|import|export|read|write|fromjson|tojson/i],
  ["renderer-export", /render|renderer|draw|paint|canvas|metafile|pdf|print|graphics/i],
  ["tests-fixtures", /(^|[\\/])(test|tests|spec|fixtures|samples?)([\\/]|$)|\.(test|spec)\./i],
  ["noise-assets", /(^|[\\/])(locale|locales|help|assets|images|css|less|scss|dist|build|vendor|node_modules)([\\/]|$)|\.(css|less|scss|svg|png|jpg|jpeg|gif|map)$/i],
];

function parseArgs(argv) {
  const args = {
    terms: [],
    scopes: [],
    json: false,
    ignoreCase: true,
    regex: false,
    limit: 500,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--term") args.terms.push(argv[++i]);
    else if (arg === "--terms") args.terms.push(...(argv[++i] || "").split(",").map((x) => x.trim()).filter(Boolean));
    else if (arg === "--scope") args.scopes.push(argv[++i]);
    else if (arg === "--json") args.json = true;
    else if (arg === "--case-sensitive") args.ignoreCase = false;
    else if (arg === "--regex") args.regex = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]) || args.limit;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node feature_search_matrix.js --terms gradient,gradFill --scope sdkjs --scope web-apps [--json] [--regex] [--limit 500]");
      process.exit(0);
    } else {
      args.terms.push(arg);
    }
  }

  if (args.scopes.length === 0) args.scopes.push(".");
  return args;
}

function classify(filePath) {
  for (const [layer, re] of LAYERS) {
    if (re.test(filePath)) return layer;
  }
  return "other";
}

function runRg(term, scopes, args) {
  const rgArgs = ["-n", "--with-filename", "--no-heading", "--color", "never"];
  if (args.ignoreCase) rgArgs.push("-i");
  if (!args.regex) rgArgs.push("-F");
  rgArgs.push(term, ...scopes);

  const res = spawnSync("rg", rgArgs, { encoding: "utf8", maxBuffer: 1024 * 1024 * 100, shell: process.platform === "win32" });
  if (res.error) {
    return { error: String(res.error.message || res.error), rows: [] };
  }
  if (res.status !== 0 && res.status !== 1) {
    return { error: res.stderr.trim() || `rg exited with ${res.status}`, rows: [] };
  }

  const rows = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const match = line.match(/^(.*?):(\d+):(.*)$/);
    if (!match) continue;
    const file = match[1];
    rows.push({
      term,
      file,
      line: Number(match[2]),
      layer: classify(file),
      text: match[3].trim(),
    });
    if (rows.length >= args.limit) break;
  }
  return { rows };
}

function summarize(rows) {
  const summary = {};
  for (const row of rows) {
    summary[row.layer] ||= { hits: 0, files: new Set() };
    summary[row.layer].hits += 1;
    summary[row.layer].files.add(row.file);
  }
  return Object.fromEntries(
    Object.entries(summary).map(([layer, value]) => [
      layer,
      { hits: value.hits, files: value.files.size },
    ])
  );
}

function toMarkdown(result) {
  const out = [];
  out.push("# Feature Search Matrix");
  out.push("");
  out.push(`Terms: ${result.terms.map((x) => `\`${x}\``).join(", ")}`);
  out.push(`Scopes: ${result.scopes.map((x) => `\`${x}\``).join(", ")}`);
  out.push("");
  out.push("## Summary By Layer");
  out.push("");
  out.push("| layer | hits | files |");
  out.push("| --- | --- | --- |");
  for (const [layer, item] of Object.entries(result.summary).sort()) {
    out.push(`| ${layer} | ${item.hits} | ${item.files} |`);
  }
  out.push("");
  out.push("## Hits");
  out.push("");
  out.push("| term | layer | file | line | text |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const row of result.rows) {
    const text = row.text.replace(/\|/g, "\\|").slice(0, 220);
    out.push(`| ${row.term} | ${row.layer} | ${row.file} | ${row.line} | ${text} |`);
  }
  if (result.errors.length) {
    out.push("");
    out.push("## Errors");
    for (const error of result.errors) out.push(`- ${error}`);
  }
  return out.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.terms.length) {
    console.error("ERROR: pass --term, --terms, or positional terms");
    process.exit(2);
  }

  const rows = [];
  const errors = [];
  for (const term of args.terms) {
    const result = runRg(term, args.scopes, args);
    if (result.error) errors.push(`${term}: ${result.error}`);
    rows.push(...result.rows);
  }

  const output = {
    terms: args.terms,
    scopes: args.scopes.map((scope) => path.normalize(scope)),
    summary: summarize(rows),
    rows,
    errors,
  };

  if (args.json) console.log(JSON.stringify(output, null, 2));
  else console.log(toMarkdown(output));

  process.exit(errors.length ? 1 : 0);
}

main();
