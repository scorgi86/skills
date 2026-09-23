"use strict";
const crypto = require("node:crypto");

const hashId = value => `boundary-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;

function discoverBoundaries(ast, config, sourceSnapshots) {
  const reasons = [];
  const producers = config?.roles?.producerRepos || [], consumers = config?.roles?.consumerRepos || [];
  if (!producers.length) reasons.push("producer repository role is missing");
  if (!consumers.length) reasons.push("consumer repository role is missing");
  if (ast?.status === "partial" || Number(ast?.stats?.failed || 0) > 0) reasons.push("AST boundary scan is incomplete");
  const byRepo = new Map();
  for (const repo of [...producers, ...consumers]) {
    const query = (ast?.results || []).find(row => row.id === `stage0-boundary-${repo}`);
    if (!query) { reasons.push(`${repo}: boundary occurrence query is missing`); continue; }
    if (query.coverage?.detailSelectionLimited || query.coverage?.detailsSuppressed || query.coverage?.detailEvidenceSuppressed) reasons.push(`${repo}: boundary occurrence results are truncated`);
    const rows = [];
    for (const occurrence of query.details || []) {
      const snapshot = sourceSnapshots.get(occurrence.file);
      if (!snapshot || snapshot.sourceHash !== occurrence.sourceHash) { reasons.push(`${repo}:${occurrence.file}: occurrence source is stale or unreadable`); continue; }
      if (occurrence.confidence === "exact" && occurrence.range?.start?.line && (config.terms || []).includes(occurrence.value)) rows.push(occurrence);
    }
    byRepo.set(repo, rows);
  }
  if (reasons.length) return { status: "partial", reasons: [...new Set(reasons)], boundaries: [] };
  const boundaries = [];
  for (const term of config.terms || []) {
    for (const producerRepo of producers) {
      const producer = (byRepo.get(producerRepo) || []).filter(row => row.value === term).sort((a,b)=>a.file.localeCompare(b.file)||a.range.start.offset-b.range.start.offset)[0];
      if (!producer) continue;
      const matchingConsumers = consumers.filter(repo => (byRepo.get(repo) || []).some(row => row.value === term)).sort();
      if (!matchingConsumers.length) continue;
      const id = hashId([producerRepo, term, matchingConsumers]);
      const snapshot = sourceSnapshots.get(producer.file), line = producer.range.start.line;
      boundaries.push({ id, producerRepo, kind: "paired-source-term", symbol: term, relation: "candidate cross-repository search term",
        anchor: { file: producer.file, line }, confirmation: { status: "source-confirmed", file: producer.file, line, endLine: producer.range.end.line, sourceFragment: snapshot.lines[line - 1] || "", sourceHash: producer.sourceHash },
        evidenceRefs: [id], ownershipRefs: [], searchTerms: [term], consumerRepos: matchingConsumers, status: "candidate" });
    }
  }
  return { status: boundaries.length ? "complete" : "exhausted", reasons: [], boundaries };
}

function mergeBoundaries(existing, generated) {
  const result = new Map((existing || []).map(row => [row.id, row]));
  for (const row of generated || []) {
    if (result.has(row.id) && JSON.stringify(result.get(row.id)) !== JSON.stringify(row)) throw new Error(`${row.id}: conflicting boundary candidate`);
    result.set(row.id, row);
  }
  return [...result.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
}

module.exports = { discoverBoundaries, mergeBoundaries };
