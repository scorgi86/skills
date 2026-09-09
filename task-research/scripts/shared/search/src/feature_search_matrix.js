"use strict";
const path = require("path");

const { spawnSync } = require("child_process");

function classify() { return "unclassified"; }

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

module.exports = { runRg, summarize, toMarkdown };

function runMatrix(args) {
    const rows = [];
    const errors = [];
    for (const term of args.terms){
        const result = runRg(term, args.scopes, args);
        if (result.error) errors.push(`${term}: ${result.error}`);
        rows.push(...result.rows);
    }
    const output = {
        terms: args.terms,
        scopes: args.scopes.map((scope)=>path.normalize(scope)),
        summary: summarize(rows),
        rows,
        errors
    };
    return output;
}
module.exports.runMatrix = runMatrix;
