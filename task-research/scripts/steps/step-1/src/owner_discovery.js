"use strict";
const crypto = require("node:crypto");
const path = require("node:path");
const { buildOwnershipGraph } = require("../../../shared/ownership/src/ownership_graph.js");
const { validateSourceAnchor } = require("../../../shared/evidence/src/canonicalization/source_anchor.js");
const { sourceFile } = require("../../../shared/evidence/src/canonicalization/source_confirmation.js");

const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const shortId = value => hash(value).slice(0, 16);
const storageRelation = relation => relation?.startsWith("collection-") ? "contains" : "stores";
const createOwnerNode = overrides => ({ role: "owner", order: null, ...overrides });

function exactStorageConfirmation(step, repository, sourceSnapshots, id) {
  const factory = step.relation === "call-result-to-field";
  if (step.ownerCandidate || step.ownerConfidence !== "exact" || step.dynamic || !(step.relation === "field-write" || step.relation?.startsWith("collection-") || factory)) return null;
  if (factory && (step.targetConfidence !== "exact" || !step.targetProof || !step.assignmentSourceHash)) return null;
  const evidence = (step.evidence || []).find(row => ["exact", "resolved"].includes(row?.confidence));
  const start = Number(evidence?.range?.start?.line), end = Number(evidence?.range?.end?.line);
  if (!evidence?.file || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
  const resolved = sourceFile({ repository: repository.id, file: evidence.file }, { repositoryScope: { repositories: [repository] } });
  if (!resolved) return null;
  const file = resolved.file;
  const snapshot = sourceSnapshots.get(file);
  if (!snapshot) return null;
  if ((factory || step.ownerProofEvidence) && snapshot.sourceHash !== step.assignmentSourceHash) return null;
  const lines = [...snapshot.lines];
  if (/\r?\n$/.test(snapshot.text)) lines.pop();
  if (end > lines.length) return null;
  const sourceFragment = lines.slice(start - 1, end).join("\n");
  if (!sourceFragment) return null;
  const confirmation = { method: "ast-exact-storage", status: "source-confirmed", file, line: start, endLine: end, sourceFragment, sourceHash: snapshot.sourceHash, evidenceRefs: [id] };
  if (!validateSourceAnchor(confirmation, snapshot).ok) return null;
  if (step.ownerProofEvidence) {
    const proof = step.ownerProofEvidence, proofFile = path.resolve(proof.file || ""), proofSnapshot = sourceSnapshots.get(proofFile);
    const proofStart = proof.range?.start?.line, proofEnd = proof.range?.end?.line;
    if (!proofSnapshot || proofSnapshot.sourceHash !== proof.sourceHash || !Number.isInteger(proofStart) || !Number.isInteger(proofEnd)) return null;
    const proofLines = [...proofSnapshot.lines]; if (/\r?\n$/.test(proofSnapshot.text)) proofLines.pop();
    const proofFragment = proofLines.slice(proofStart - 1, proofEnd).join("\n");
    const proofConfirmation = { method: "ast-owner-return", status: "source-confirmed", file: proofFile, line: proofStart, endLine: proofEnd, sourceFragment: proofFragment, sourceHash: proofSnapshot.sourceHash };
    if (!validateSourceAnchor(proofConfirmation, proofSnapshot).ok) return null;
    const assignmentId = `${id}:assignment`, returnId = `${id}:owner-return`;
    return { ...confirmation, evidenceRefs: [assignmentId, returnId], evidenceCandidates: [
      { id: assignmentId, repository: repository.id, file, line: start, endLine: end, sourceFragment, sourceHash: snapshot.sourceHash, usageKind: "field-write", status: "source-confirmed", confirmation: { ...confirmation, evidenceRefs: [assignmentId] } },
      { id: returnId, repository: repository.id, file: proofFile, line: proofStart, endLine: proofEnd, sourceFragment: proofFragment, sourceHash: proofSnapshot.sourceHash, usageKind: "ast-definition", status: "source-confirmed", confirmation: { ...proofConfirmation, evidenceRefs: [returnId] } }
    ] };
  }
  if (!factory) return confirmation;
  const proof = step.targetProof, proofFile = path.resolve(proof.file || ""), proofSnapshot = sourceSnapshots.get(proofFile);
  const proofStart = proof.range?.start?.line, proofEnd = proof.range?.end?.line;
  if (!proofSnapshot || proofSnapshot.sourceHash !== proof.sourceHash || !Number.isInteger(proofStart) || !Number.isInteger(proofEnd)) return null;
  const proofLines = [...proofSnapshot.lines]; if (/\r?\n$/.test(proofSnapshot.text)) proofLines.pop();
  const proofFragment = proofLines.slice(proofStart - 1, proofEnd).join("\n");
  const proofConfirmation = { method: "ast-factory-return", status: "source-confirmed", file: proofFile, line: proofStart, endLine: proofEnd, sourceFragment: proofFragment, sourceHash: proofSnapshot.sourceHash };
  if (!validateSourceAnchor(proofConfirmation, proofSnapshot).ok) return null;
  const assignmentId = `${id}:assignment`, returnId = `${id}:return-branch`;
  return { ...confirmation, evidenceRefs: [assignmentId, returnId], evidenceCandidates: [
    { id: assignmentId, repository: repository.id, file, line: start, endLine: end, sourceFragment, sourceHash: snapshot.sourceHash, usageKind: "field-write", status: "source-confirmed", confirmation: { ...confirmation, evidenceRefs: [assignmentId] } },
    { id: returnId, repository: repository.id, file: proofFile, line: proofStart, endLine: proofEnd, sourceFragment: proofFragment, sourceHash: proofSnapshot.sourceHash, usageKind: "ast-definition", status: "source-confirmed", confirmation: { ...proofConfirmation, evidenceRefs: [returnId] } }
  ] };
}

function discoverOwnerCandidates(ast, request, previous, sourceSnapshots) {
  const roots = request.repositoryScope?.repositories || [];
  const nodes = new Map(), edges = new Map(), groups = new Map(), unresolved = [], evidenceCandidates = [];
  const deltaMode = request.ownerDiscovery?.mode === "delta";
  const frontier = request.ownershipFrontier || [];
  const maxOrder = request.ownershipGraphMaxOrder;
  const exhaustedSeeds = [], advancedSeeds = [], limitReachedSeeds = [];
  const ownerChains = ast.ownerChains || [];
  for (const result of ownerChains) {
    const priorSeed = deltaMode && frontier.find(row => row.repository === result.repository && row.entity === result.seed);
    const seedId = priorSeed?.nodeId || `owner-node-${shortId([result.repository, result.seed])}`;
    const seedOrder = priorSeed?.order || 0;
    if (!deltaMode) nodes.set(seedId, createOwnerNode({ id: seedId, entity: result.seed, repository: result.repository, role: "seed", order: 0 }));
    if (result.truncated) unresolved.push({ reason: "truncated", seed: result.seed });
    for (const row of result.unresolved || []) unresolved.push({ reason: row.ownerCandidate ? "owner-type-candidate" : "unknown-or-dynamic", seed: result.seed, repository: result.repository, ...row });
    for (const pathRow of result.chains || []) {
      if (pathRow.status === "not-found" && !result.truncated) exhaustedSeeds.push({ repository: result.repository, seed: result.seed });
      else if (pathRow.status !== "leaf") unresolved.push({ reason: pathRow.status, seed: result.seed });
      let childId = seedId;
      for (const step of pathRow.chain.slice(1)) {
        const order = seedOrder + step.level;
        if (deltaMode && order > maxOrder) { limitReachedSeeds.push(result.seed); break; }
        const evidence = step.evidence?.[0];
        const file = evidence?.file && path.resolve(evidence.file), line = evidence?.range?.start?.line;
        const repo = roots.find(item => file && (() => { const relative = path.relative(item.root, file); return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); })());
        if (!repo || result.repository && repo.id !== result.repository || !Number.isInteger(line) || line < 1) { unresolved.push({ reason: "missing-source-anchor", seed: result.seed, owner: step.owner }); break; }
        const ownerId = `owner-node-${shortId([repo.id, step.owner])}`;
        nodes.set(ownerId, createOwnerNode({ id: ownerId, entity: step.owner, ...(deltaMode ? { order } : {}) }));
        const relation = storageRelation(step.relation);
        const identity = [repo.id, file, line, step.owner, step.field, step.type, relation];
        const id = `owner-${shortId(identity)}`, anchor = { file, line };
        let evidenceRefs = [id];
        const confirmation = exactStorageConfirmation(step, repo, sourceSnapshots, id);
        if (!confirmation && step.ownerProofEvidence) {
          unresolved.push({ reason: "stale-or-missing-owner-proof", seed: result.seed, repository: repo.id, owner: step.owner, field: step.field });
        } else if (!confirmation && step.targetConfidence === "exact-possible") {
          unresolved.push({ reason: "factory-return-not-narrowed", seed: result.seed, repository: repo.id, owner: step.owner, field: step.field });
        } else if (!confirmation && step.targetConfidence === "exact") {
          const assignment = sourceSnapshots.get(file);
          const proof = step.targetProof || {}, proofSnapshot = proof.file && sourceSnapshots.get(path.resolve(proof.file));
          unresolved.push({ reason: !assignment || assignment.sourceHash !== step.assignmentSourceHash ? "stale-or-missing-assignment-proof" : "stale-or-missing-return-proof", seed: result.seed, repository: repo.id, owner: step.owner, field: step.field });
        }
        if (confirmation?.evidenceCandidates) evidenceCandidates.push(...confirmation.evidenceCandidates);
        if (confirmation?.evidenceRefs) evidenceRefs = confirmation.evidenceRefs;
        edges.set(id, { id, from: ownerId, to: childId, relation, propertyOrMethod: step.field || "", status: confirmation ? "confirmed" : "candidate", anchors: [anchor], evidenceRefs });
        advancedSeeds.push({ repository: result.repository, seed: result.seed });
        groups.set(id, { id, order, role: "owner", object: `${step.owner}.${step.field}`, relation, repository: repo.id, status: confirmation ? "confirmed" : "candidate", anchor, evidenceRefs, ...(confirmation ? { confirmation, sourceFragment: confirmation.sourceFragment } : {}) });
        childId = ownerId;
      }
    }
  }
  if (ast.stats?.failed) unresolved.push({ reason: "ast-parse-failed", count: ast.stats.failed });
  let graph = null;
  if (!deltaMode) {
  while (true) {
    graph = buildOwnershipGraph({ nodes: [...nodes.values()], edges: [...edges.values()], maxOrder: 10 });
    const byId = new Map(graph.nodes.map(node => [node.id, node]));
    const conflicts = graph.edges.filter(edge => byId.get(edge.from).order !== null && byId.get(edge.to).order !== null && byId.get(edge.from).order <= byId.get(edge.to).order);
    if (!conflicts.length) break;
    for (const edge of conflicts) {
      edges.delete(edge.id);
      groups.delete(edge.id);
      unresolved.push({ reason: "order-conflict", edgeId: edge.id, anchor: edge.anchors[0] });
    }
  }
  }
  const files = (ast.plan?.uniqueFiles || []).map(file => ({ file, sourceHash: sourceSnapshots.get(file)?.sourceHash || null })).sort((a, b) => a.file.localeCompare(b.file));
  if (files.some(row => !row.sourceHash)) unresolved.push({ reason: "source-read-failed" });
  const sortedEdges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  const reviewDigest = files.every(row => row.sourceHash) ? hash({ previous: previous.outputDigest, files, edges: graph?.edges || sortedEdges }) : null;
  return { graph, nodes: [...nodes.values()], edges: sortedEdges, groups: [...groups.values()].sort((a, b) => a.id.localeCompare(b.id)), unresolved,
    exhaustedSeeds: [...new Map(exhaustedSeeds.map(row => [`${row.repository}\0${row.seed}`, row])).values()],
    advancedSeeds: [...new Map(advancedSeeds.map(row => [`${row.repository}\0${row.seed}`, row])).values()],
    limitReachedSeeds: [...new Set(limitReachedSeeds)].sort(), reviewDigest, evidenceCandidates };
}

module.exports = { createOwnerNode, discoverOwnerCandidates, exactStorageConfirmation };
