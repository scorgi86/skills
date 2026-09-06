"use strict";

const path = require("node:path");

const fs = require("node:fs");

const MAX_SKILL_NAME_LENGTH = 64;

const ALLOWED_PROPERTIES = new Set(["name", "description", "license", "allowed-tools", "metadata"]);

function parseScalar(raw, continuation) {
  const value = raw.trim();
  if (value === "" && continuation.length > 0) return { value: {} };
  if (/^[>|][+-]?$/.test(value)) return { value: continuation.map((line) => line.replace(/^\s+/, "")).join("\n") };
  if (value.startsWith("'") && value.endsWith("'")) return { value: value.slice(1, -1).replace(/''/g, "'") };
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return { value: JSON.parse(value) }; } catch { return { error: "Invalid double-quoted YAML scalar" }; }
  }
  if (/^(true|false)$/i.test(value)) return { value: value.toLowerCase() === "true" };
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return { value: Number(value) };
  if (value.startsWith("[") || value.startsWith("{")) {
    try { return { value: JSON.parse(value) }; } catch { return { value }; }
  }
  return { value };
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { error: "Invalid frontmatter format" };
  const lines = match[1].split(/\r?\n/);
  const data = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) return { error: `Unexpected indented frontmatter line ${index + 1}` };
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!keyMatch) return { error: `Invalid YAML in frontmatter at line ${index + 1}` };
    const continuation = [];
    while (index + 1 < lines.length && (/^\s/.test(lines[index + 1]) || !lines[index + 1].trim())) continuation.push(lines[++index]);
    const scalar = parseScalar(keyMatch[2] || "", continuation);
    if (scalar.error) return { error: scalar.error };
    data[keyMatch[1]] = scalar.value;
  }
  return { data };
}

function validateSkill(skillPath) {
  const root = path.resolve(skillPath);
  const skillFile = path.join(root, "SKILL.md");
  if (!fs.existsSync(skillFile)) return { valid: false, message: "SKILL.md not found" };
  const content = fs.readFileSync(skillFile, "utf8");
  if (!content.startsWith("---")) return { valid: false, message: "No YAML frontmatter found" };
  const parsed = parseFrontmatter(content);
  if (parsed.error) return { valid: false, message: parsed.error };
  const frontmatter = parsed.data;
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return { valid: false, message: "Frontmatter must be a YAML dictionary" };

  const unexpected = Object.keys(frontmatter).filter((key) => !ALLOWED_PROPERTIES.has(key));
  if (unexpected.length > 0) return { valid: false, message: `Unexpected key(s) in SKILL.md frontmatter: ${unexpected.sort().join(", ")}. Allowed properties are: ${[...ALLOWED_PROPERTIES].sort().join(", ")}` };
  if (!("name" in frontmatter)) return { valid: false, message: "Missing 'name' in frontmatter" };
  if (!("description" in frontmatter)) return { valid: false, message: "Missing 'description' in frontmatter" };

  if (typeof frontmatter.name !== "string") return { valid: false, message: `Name must be a string, got ${typeof frontmatter.name}` };
  const name = frontmatter.name.trim();
  if (name && !/^[a-z0-9-]+$/.test(name)) return { valid: false, message: `Name '${name}' should be hyphen-case (lowercase letters, digits, and hyphens only)` };
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) return { valid: false, message: `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens` };
  if (name.length > MAX_SKILL_NAME_LENGTH) return { valid: false, message: `Name is too long (${name.length} characters). Maximum is ${MAX_SKILL_NAME_LENGTH} characters.` };

  if (typeof frontmatter.description !== "string") return { valid: false, message: `Description must be a string, got ${typeof frontmatter.description}` };
  const description = frontmatter.description.trim();
  if (description.includes("<") || description.includes(">")) return { valid: false, message: "Description cannot contain angle brackets (< or >)" };
  if (description.length > 1024) return { valid: false, message: `Description is too long (${description.length} characters). Maximum is 1024 characters.` };
  return { valid: true, message: "Skill is valid!" };
}

module.exports = { parseFrontmatter, validateSkill };
