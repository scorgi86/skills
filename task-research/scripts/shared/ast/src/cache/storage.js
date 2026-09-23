const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const string = value => typeof value === "string";
const strings = value => Array.isArray(value) && value.every(string);
const optional = (value, keys, check) => keys.every(key => !(key in value) || check(value[key]));
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const position = value => object(value) && Number.isInteger(value.offset) && value.offset >= 0
  && Number.isInteger(value.line) && value.line >= 1 && Number.isInteger(value.column) && value.column >= 1;

function validEvidence(value, file) {
  return object(value) && value.file === file && string(value.snippet) && string(value.extractor)
    && ["exact", "candidate", "resolved", "name-inferred"].includes(value.confidence)
    && value.status === "не проверено"
    && (value.range === null || (object(value.range) && position(value.range.start) && position(value.range.end)
      && value.range.end.offset >= value.range.start.offset));
}

function validCallableProof(value, analyzerVersion) {
  const legacy = analyzerVersion === "5";
  const current = ["6", "7", "8"].includes(analyzerVersion);
  if (!object(value) || !only(value, legacy ? ["owner", "method", "argumentKeys"] : current ? ["owner", "method", "argumentDomains"] : ["owner", "method"]) || !string(value.owner) || !string(value.method)) return false;
  if (legacy && "argumentKeys" in value) return Array.isArray(value.argumentKeys) && value.argumentKeys.every(key => object(key) && only(key, ["index", "key"]) && Number.isInteger(key.index) && key.index >= 0 && string(key.key));
  if (current && "argumentDomains" in value) return Array.isArray(value.argumentDomains) && value.argumentDomains.every(domain => object(domain) && only(domain, ["index", "discriminatorKey", "values"])
    && Number.isInteger(domain.index) && domain.index >= 0 && string(domain.discriminatorKey) && strings(domain.values)
    && domain.values.length > 0 && domain.values.every((value, index) => index === 0 || domain.values[index - 1] < value));
  return true;
}

function validOccurrence(value, file) {
  return object(value) && only(value, ["value", "kind", "file", "range", "sourceHash", "confidence", "evidence"])
    && string(value.value) && value.value.length > 0 && ["identifier", "property", "string"].includes(value.kind)
    && value.file === file && string(value.sourceHash) && value.confidence === "exact"
    && object(value.range) && position(value.range.start) && position(value.range.end)
    && Array.isArray(value.evidence) && value.evidence.length === 1 && validEvidence(value.evidence[0], file);
}

function validParticipant(value,file){return object(value)&&only(value,["role","value","kind","file","range","sourceHash"])
  &&string(value.role)&&string(value.value)&&value.value.length>0&&["identifier","property","string"].includes(value.kind)
  &&value.file===file&&string(value.sourceHash)&&object(value.range)&&position(value.range.start)&&position(value.range.end);}

function validItem(value, file, symbol, analyzerVersion) {
  if (!object(value) || !Array.isArray(value.evidence) || !value.evidence.every(item => validEvidence(item, file))) return false;
  const required = symbol ? ["kind", "qualifiedName", "name"] : ["relation", "ownerQualifiedName", "targetQualifiedName", "sourceSymbol"];
  if (!required.every(key => string(value[key]))) return false;
  return optional(value, ["owner", "method", "scope", "source", "target", "inferredType", "candidateType", "field"], string)
    && optional(value, ["params", "candidateTypes", "resolvedVia"], strings)
    && optional(value, ["dynamic"], item => typeof item === "boolean")
    && optional(value, ["analysisSourceHash"], string)
    && (!symbol && analyzerVersion === "8" ? Array.isArray(value.participants) && value.participants.every(participant => validParticipant(participant,file))
      : optional(value, ["participants"], item => Array.isArray(item) && item.every(participant => validParticipant(participant,file))))
    && optional(value, ["callableProof"], item => validCallableProof(item, analyzerVersion))
    && optional(value, ["ownerProof"], item => object(item) && only(item, ["kind", "ownerType", "method", "returnType"])
      && item.kind === "exact-method-return" && string(item.ownerType) && string(item.returnType)
      && ["clone", "createDuplicate"].includes(item.method));
}

function validMethodSummary(value, file) {
  const proof = item => object(item) && only(item, ["type", "proof", "selector"])
    && string(item.type) && object(item.proof) && item.proof.file === file && string(item.proof.snippet)
    && string(item.proof.confidence) && string(item.proof.sourceHash)
    && object(item.proof.range) && position(item.proof.range.start) && position(item.proof.range.end)
    && optional(item, ["selector"], selector => object(selector) && only(selector, ["parameterIndex", "discriminatorKey", "caseValue"])
      && Number.isInteger(selector.parameterIndex) && selector.parameterIndex >= 0 && string(selector.discriminatorKey) && string(selector.caseValue));
  return object(value) && only(value, ["owner", "method", "returnType", "possibleReturnTypes", "evidence", "analysisSourceHash"])
    && string(value.owner) && string(value.method) && optional(value, ["returnType"], string)
    && Array.isArray(value.possibleReturnTypes) && value.possibleReturnTypes.every(proof)
    && string(value.analysisSourceHash)
    && Array.isArray(value.evidence) && value.evidence.length > 0
    && value.evidence.every(item => validEvidence(item, file));
}

function validTypeAlias(value, file) {
  const proof = value && value.proof;
  return object(value) && only(value, ["aliasQualifiedName", "targetQualifiedName", "proof"])
    && string(value.aliasQualifiedName) && string(value.targetQualifiedName)
    && object(proof) && only(proof, ["file", "range", "snippet", "confidence", "sourceHash"])
    && proof.file === file && string(proof.snippet) && proof.confidence === "exact" && string(proof.sourceHash)
    && object(proof.range) && position(proof.range.start) && position(proof.range.end);
}

function validEntry(entry, identity) {
  if (!object(entry) || !isDeepStrictEqual(entry.identity, identity)) return false;
  const result = entry.result;
  return object(result) && result.file === identity.file && isDeepStrictEqual(result.parser, identity.parser)
    && result.status === "candidate" && Array.isArray(result.errors) && result.errors.length === 0
    && Array.isArray(result.warnings) && result.warnings.every(item => object(item) && string(item.message))
    && Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0
    && Array.isArray(result.symbols) && result.symbols.every(item => validItem(item, identity.file, true, identity.analyzerVersion))
    && Array.isArray(result.relations) && result.relations.every(item => validItem(item, identity.file, false, identity.analyzerVersion))
    && Array.isArray(result.methodSummaries) && result.methodSummaries.every(item => validMethodSummary(item, identity.file))
    && Array.isArray(result.typeAliases) && result.typeAliases.every(item => validTypeAlias(item, identity.file))
    && (!["7","8"].includes(identity.analyzerVersion) || Array.isArray(result.occurrences) && result.occurrences.every(item => validOccurrence(item, identity.file)));
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
