#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function usage() {
  console.log("Usage: node validate_skill.js [skill-dir] [--json]");
}

function parseArgs(argv) {
  const args = { skillDir: path.resolve(__dirname, ".."), json: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--json") {
      args.json = true;
    } else {
      args.skillDir = path.resolve(arg);
    }
  }
  return args;
}

function parseScalar(value, allLines, index) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'")) {
    return {
      ok: trimmed.length >= 2 && trimmed.endsWith("'"),
      value: trimmed.slice(1, -1).replace(/''/g, "'"),
      next: index + 1,
      style: "single-quoted",
    };
  }
  if (trimmed.startsWith('"')) {
    return {
      ok: trimmed.length >= 2 && trimmed.endsWith('"'),
      value: trimmed.slice(1, -1),
      next: index + 1,
      style: "double-quoted",
    };
  }
  if (/^[>|][+-]?$/.test(trimmed)) {
    const block = [];
    let next = index + 1;
    while (next < allLines.length && /^(  |\t)/.test(allLines[next])) {
      block.push(allLines[next].replace(/^(  |\t)/, ""));
      next += 1;
    }
    return { ok: block.length > 0, value: block.join("\n"), next, style: "block" };
  }
  return {
    ok: !/:\s/.test(trimmed),
    value: trimmed,
    next: index + 1,
    style: "plain",
  };
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { data: {}, errors: ["SKILL.md must start with YAML frontmatter fenced by ---"], warnings: [] };
  }

  const lines = match[1].split(/\r?\n/);
  const data = {};
  const errors = [];
  const warnings = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!keyMatch) {
      errors.push(`Cannot parse frontmatter line ${i + 1}: ${line}`);
      i += 1;
      continue;
    }

    const key = keyMatch[1];
    const value = keyMatch[2] || "";
    const scalar = parseScalar(value, lines, i);
    if (!scalar.ok) {
      errors.push(`Invalid YAML scalar for "${key}" at frontmatter line ${i + 1}`);
    }
    if (scalar.style === "plain" && /:\s/.test(value.trim())) {
      errors.push(`Unquoted "${key}" contains ": " and can break compact YAML parsers`);
    }
    data[key] = scalar.value;
    i = scalar.next;
  }

  for (const key of Object.keys(data)) {
    if (key !== "name" && key !== "description") {
      warnings.push(`Unexpected frontmatter key "${key}"; Codex skills normally use only name and description`);
    }
  }

  return { data, errors, warnings };
}

function findReferencedFiles(raw) {
  const refs = new Set();
  const re = /`?(references\/[A-Za-z0-9_.\/-]+)`?/g;
  let match;
  while ((match = re.exec(raw))) {
    refs.add(match[1].replace(/\//g, path.sep));
  }
  return [...refs];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillFile = path.join(args.skillDir, "SKILL.md");
  const result = { ok: true, errors: [], warnings: [], skillDir: args.skillDir };

  if (!fs.existsSync(skillFile)) {
    result.errors.push(`Missing ${skillFile}`);
  } else {
    const buf = fs.readFileSync(skillFile);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      result.errors.push("SKILL.md has UTF-8 BOM");
    }

    const raw = buf.toString("utf8");
    const parsed = parseFrontmatter(raw);
    result.errors.push(...parsed.errors);
    result.warnings.push(...parsed.warnings);

    if (!parsed.data.name) {
      result.errors.push("Missing required frontmatter field: name");
    }
    if (!parsed.data.description) {
      result.errors.push("Missing required frontmatter field: description");
    }
    if (parsed.data.name && parsed.data.name !== path.basename(args.skillDir)) {
      result.warnings.push(`Skill name "${parsed.data.name}" differs from folder "${path.basename(args.skillDir)}"`);
    }

    for (const ref of findReferencedFiles(raw)) {
      const full = path.join(args.skillDir, ref);
      if (!fs.existsSync(full)) {
        result.errors.push(`Referenced file does not exist: ${ref}`);
      }
    }
  }

  result.ok = result.errors.length === 0;

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.ok ? "OK: skill validation passed" : "FAILED: skill validation failed");
    for (const error of result.errors) console.log(`ERROR: ${error}`);
    for (const warning of result.warnings) console.log(`WARN: ${warning}`);
  }

  process.exit(result.ok ? 0 : 1);
}

main();
