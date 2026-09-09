const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const string = value => typeof value === "string";
const strings = value => Array.isArray(value) && value.every(string);
const optional = (value, keys, check) => keys.every(key => !(key in value) || check(value[key]));
const position = value => object(value) && Number.isInteger(value.offset) && value.offset >= 0
  && Number.isInteger(value.line) && value.line >= 1 && Number.isInteger(value.column) && value.column >= 1;

function validEvidence(value, file) {
  return object(value) && value.file === file && string(value.snippet) && string(value.extractor)
    && ["exact", "candidate", "resolved", "name-inferred"].includes(value.confidence)
    && value.status === "не проверено"
    && (value.range === null || (object(value.range) && position(value.range.start) && position(value.range.end)
      && value.range.end.offset >= value.range.start.offset));
}

function validItem(value, file, symbol) {
  if (!object(value) || !Array.isArray(value.evidence) || !value.evidence.every(item => validEvidence(item, file))) return false;
  const required = symbol ? ["kind", "qualifiedName", "name"] : ["relation", "ownerQualifiedName", "targetQualifiedName", "sourceSymbol"];
  if (!required.every(key => string(value[key]))) return false;
  return optional(value, ["owner", "method", "scope", "source", "target", "inferredType", "candidateType", "field"], string)
    && optional(value, ["params", "candidateTypes", "resolvedVia"], strings)
    && optional(value, ["dynamic"], item => typeof item === "boolean");
}

function validEntry(entry, identity) {
  if (!object(entry) || !isDeepStrictEqual(entry.identity, identity)) return false;
  const result = entry.result;
  return object(result) && result.file === identity.file && isDeepStrictEqual(result.parser, identity.parser)
    && result.status === "candidate" && Array.isArray(result.errors) && result.errors.length === 0
    && Array.isArray(result.warnings) && result.warnings.every(item => object(item) && string(item.message))
    && Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0
    && Array.isArray(result.symbols) && result.symbols.every(item => validItem(item, identity.file, true))
    && Array.isArray(result.relations) && result.relations.every(item => validItem(item, identity.file, false));
}

function readEntry(directory, identity) {
  let serialized;
  try {
    serialized = fs.readFileSync(path.join(directory, `${identity.key}.json`), "utf8");
  } catch (error) {
    return error.code === "ENOENT" ? { status: "miss" } : { status: "failed", error };
  }
  try {
    const entry = JSON.parse(serialized);
    if (!validEntry(entry, identity)) throw new Error("Invalid AST cache entry");
    return { status: "hit", result: entry.result };
  } catch (error) {
    return { status: "failed", error };
  }
}

function writeEntry(directory, identity, result) {
  const target = path.join(directory, `${identity.key}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  let owned = false;
  try {
    fs.mkdirSync(directory, { recursive: true });
    // Exclusive creation establishes ownership before writing or cleaning up.
    const fd = fs.openSync(temporary, "wx");
    owned = true;
    try {
      fs.writeFileSync(fd, JSON.stringify({ identity, result }));
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, target);
    return { status: "written" };
  } catch (error) {
    return { status: "failed", error };
  } finally {
    if (owned) {
      try { fs.unlinkSync(temporary); } catch { /* Best effort; never remove another writer's entry. */ }
    }
  }
}
module.exports = { readEntry, writeEntry };
