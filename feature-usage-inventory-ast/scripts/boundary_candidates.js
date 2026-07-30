"use strict";

function unique(values = []) { return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))]; }

function sourceAnchor(sourceEvidence, references = []) {
  for (const reference of references) {
    const check = (sourceEvidence && sourceEvidence.checks || []).find((item) => item.id === reference);
    const group = check && (check.groups || []).find((item) => item.firstAnchor);
    if (group && group.firstAnchor) return group.firstAnchor;
    const match = check && check.matches && check.matches[0];
    if (match) return { file: match.file, line: match.line };
  }
  return null;
}

function normalizeBoundaryCandidates(request = {}, ownership = {}, sourceEvidence = {}) {
  const entries = Array.isArray(request.boundaries) ? request.boundaries : [];
  const ownershipIds = new Set((ownership.groups || []).map((item) => item.id));
  const ids = new Set();
  return entries.map((entry, index) => {
    const id = String(entry.id || `boundary-${index + 1}`);
    if (ids.has(id)) throw new Error(`Duplicate boundary candidate id: ${id}`);
    ids.add(id);
    const evidenceRefs = unique(entry.evidenceRefs);
    const ownershipRefs = unique(entry.ownershipRefs);
    const anchor = entry.anchor || sourceAnchor(sourceEvidence, evidenceRefs);
    const searchTerms = unique([entry.symbol, ...(entry.searchTerms || [])]);
    const consumerRepos = unique(entry.consumerRepos || entry.consumerScope);
    if (!entry.producerRepo || !entry.kind || !entry.symbol || !entry.relation) throw new Error(`${id}: producerRepo, kind, symbol and relation are required`);
    if (!anchor || !anchor.file || !Number(anchor.line)) throw new Error(`${id}: concrete source anchor is required`);
    if (!evidenceRefs.length) throw new Error(`${id}: evidenceRefs are required`);
    if (!searchTerms.length) throw new Error(`${id}: searchTerms are required`);
    if (!consumerRepos.length) throw new Error(`${id}: consumerRepos are required`);
    for (const ownershipId of ownershipRefs) if (!ownershipIds.has(ownershipId)) throw new Error(`${id}: ownership reference ${ownershipId} is missing`);
    return { id, producerRepo: String(entry.producerRepo), kind: String(entry.kind), symbol: String(entry.symbol), relation: String(entry.relation), anchor: { file: String(anchor.file), line: Number(anchor.line) }, evidenceRefs, ownershipRefs, searchTerms, consumerRepos, status: "candidate" };
  });
}

module.exports = { normalizeBoundaryCandidates, sourceAnchor, unique };
