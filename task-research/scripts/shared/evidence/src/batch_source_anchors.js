"use strict";
const { SourceSnapshotStore } = require("./source_snapshot.js");
const { sourceFile } = require("./canonicalization/source_confirmation.js");
const { validateSourceAnchor } = require("./canonicalization/source_anchor.js");

function failure(code, message, index, id) {
  return Object.assign(new Error(message), { code, index, id });
}

function batchSourceAnchors(request, dependencies = {}) {
  if (!request || Number(request.stage) !== 6 || !request.repositoryScope || !Array.isArray(request.canonicalEvidence)) {
    throw failure("request", "Require Stage 6, repositoryScope and canonicalEvidence array");
  }
  const snapshots = new SourceSnapshotStore(dependencies);
  const seen = new Set();
  let count = 0;
  const canonicalEvidence = request.canonicalEvidence.map((row, index) => {
    const id = row?.id;
    if (typeof id !== "string" || !id || seen.has(id)) throw failure("evidence-id", "Evidence IDs must be nonempty and unique", index, id);
    seen.add(id);
    if (row.status !== "source-confirmed") return row;
    const hasHash = Object.hasOwn(row, "sourceHash"), hasFragment = Object.hasOwn(row, "sourceFragment");
    if (hasHash !== hasFragment) throw failure("partial-anchor", "sourceHash and sourceFragment must be both present or both absent", index, id);
    if (hasHash) return row;
    const resolved = sourceFile(row, { repositoryScope: request.repositoryScope });
    if (!resolved) throw failure("repository-attribution", "Source must be inside its declared repository", index, id);
    const snapshot = snapshots.get(resolved.file);
    if (!snapshot) throw failure("source-file", "Source file could not be read", index, id);
    const lines = [...snapshot.lines];
    if (snapshot.text === "") lines.length = 0;
    else if (/\r?\n$/.test(snapshot.text)) lines.pop();
    if (!Number.isInteger(row.line) || !Number.isInteger(row.endLine) || row.line < 1 || row.endLine < row.line || row.endLine > lines.length) {
      throw failure("source-anchor", "Require existing inclusive 1-based line/endLine range", index, id);
    }
    const filled = { ...row, sourceHash: snapshot.sourceHash, sourceFragment: lines.slice(row.line - 1, row.endLine).join("\n") };
    const validation = validateSourceAnchor(filled, snapshot);
    if (!validation.ok) throw failure(validation.code, validation.message, index, id);
    count++;
    return filled;
  });
  return { request: { ...request, canonicalEvidence }, count };
}

module.exports = { batchSourceAnchors };
