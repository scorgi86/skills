const crypto = require("node:crypto");
const fs = require("node:fs");
const { decodeHumanFields, humanGroupName } = require("./human_report_codec");

function text(value) {
  return String(value === undefined || value === null ? "" : value);
}

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20)}`;
}

function anchorOf(container, value) {
  if (!value) return { file: "", line: null, endLine: null };
  if (value.fileId !== undefined && container.anchorFiles) {
    const root = container.anchorFiles.root || "";
    const relative = container.anchorFiles.paths && container.anchorFiles.paths[value.fileId] || "";
    return { file: root ? require("node:path").resolve(root, relative) : relative, line: value.line || null, endLine: value.endLine || null };
  }
  const range = value.range || {};
  return {
    file: text(value.file),
    line: value.line || range.start && range.start.line || null,
    endLine: value.endLine || range.end && range.end.line || null,
  };
}

function sourceWithFreshness(anchor, facts, fileHashes) {
  let fileHash = null;
  if (anchor.file) {
    if (!fileHashes.has(anchor.file)) {
      fileHashes.set(anchor.file, fs.existsSync(anchor.file) && fs.statSync(anchor.file).isFile()
        ? crypto.createHash("sha256").update(fs.readFileSync(anchor.file)).digest("hex")
        : null);
    }
    fileHash = fileHashes.get(anchor.file);
  }
  return { ...anchor, fileHash, gitHead: facts.runtime && facts.runtime.source && facts.runtime.source.gitHead || null };
}

function buildStage2Records(input) {
  const facts = decodeHumanFields(input);
  const astResults = facts.ast && (facts.ast.results || facts.ast.queries) || [];
  const sourceChecks = facts.sourceEvidence && (facts.sourceEvidence.checks || facts.sourceEvidence) || [];
  const evidence = [];
  const findings = [];
  const fileHashes = new Map();

  for (const result of astResults) {
    const groups = result.semanticGroups || result.groups || [];
    for (const group of groups) {
      const anchor = anchorOf(facts, group.firstAnchor || group.example);
      const identity = {
        kind: "ast-group",
        query: text(result.id || result.command),
        group: text(group.key),
        owner: text(group.owner),
        relation: text(group.relation),
        field: text(group.field),
        target: text(group.target),
        file: anchor.file,
        line: anchor.line,
      };
      const evidenceId = stableId("ev", identity);
      const findingId = stableId("fn", identity);
      evidence.push({
        schemaVersion: "1.0.0",
        id: evidenceId,
        kind: "ast-group",
        status: "candidate",
        query: identity.query,
        owner: identity.owner,
        relation: identity.relation,
        field: identity.field,
        target: identity.target,
        source: sourceWithFreshness(anchor, facts, fileHashes),
        items: Number(group.items) || 0,
        evidenceCount: Number(group.evidence) || 0,
        groupDigest: text(result.groupDigest),
      });
      findings.push({
        schemaVersion: "1.0.0",
        id: findingId,
        title: humanGroupName(group),
        status: "candidate",
        owner: identity.owner,
        relation: identity.relation,
        field: identity.field,
        target: identity.target,
        source: sourceWithFreshness(anchor, facts, fileHashes),
        query: identity.query,
        evidenceRefs: [evidenceId],
        openChecks: ["source confirmation required before promotion"],
      });
    }
  }

  for (const check of sourceChecks) {
    for (const match of check.matches || []) {
      const anchor = anchorOf(facts, match);
      const identity = { kind: "source-match", check: text(check.id || check.label), file: anchor.file, line: anchor.line, snippet: text(match.snippet) };
      evidence.push({
        schemaVersion: "1.0.0",
        id: stableId("ev", identity),
        kind: "source-match",
        status: "source-match",
        check: identity.check,
        pattern: text(match.patternId || match.pattern),
        source: sourceWithFreshness(anchor, facts, fileHashes),
        snippet: identity.snippet,
        snippetHash: crypto.createHash("sha256").update(identity.snippet).digest("hex"),
      });
    }
  }

  const sourceEvidenceByAnchor = new Map();
  for (const item of evidence.filter((item) => item.kind === "source-match")) {
    const key = `${item.source.file}:${item.source.line || ""}`;
    if (!sourceEvidenceByAnchor.has(key)) sourceEvidenceByAnchor.set(key, []);
    sourceEvidenceByAnchor.get(key).push(item.id);
  }
  for (const finding of findings) {
    const key = `${finding.source.file}:${finding.source.line || ""}`;
    for (const reference of sourceEvidenceByAnchor.get(key) || []) if (!finding.evidenceRefs.includes(reference)) finding.evidenceRefs.push(reference);
  }

  findings.sort((a, b) => `${a.title}:${a.relation}:${a.source.file}:${a.source.line}`.localeCompare(`${b.title}:${b.relation}:${b.source.file}:${b.source.line}`));
  evidence.sort((a, b) => `${a.kind}:${a.source.file}:${a.source.line}:${a.id}`.localeCompare(`${b.kind}:${b.source.file}:${b.source.line}:${b.id}`));
  return { schemaVersion: "1.0.0", stage: 2, findings, evidence };
}

module.exports = { anchorOf, buildStage2Records, stableId };
