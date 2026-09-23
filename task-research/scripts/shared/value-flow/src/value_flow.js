"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const unique = values => [...new Set((values || []).filter(Boolean).map(String))].sort();
const stableId = (prefix, value) => `${prefix}-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;
const short = value => String(value || "").split(".").pop();
const same = (left, right) => left === right || short(left) === short(right);

function repositoryFor(file, repositories) {
  const absolute = path.resolve(file || "");
  return (repositories || []).find(repository => {
    const relative = path.relative(repository.root, absolute);
    return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
}

function relationShape(relation) {
  const ownerField = relation.field ? `${relation.ownerQualifiedName}.${relation.field}` : relation.ownerQualifiedName;
  if (relation.relation === "construct") return { relation: "construct", from: relation.targetQualifiedName, to: relation.sourceSymbol };
  if (["field-write", "object-field", "setter-argument-to-field", "parameter-to-field", "call-result-to-field", "computed-write"].includes(relation.relation) || String(relation.relation).startsWith("collection-")) {
    return { relation: relation.relation === "call-result-to-field" ? "transform" : "contain", from: relation.targetQualifiedName, to: ownerField };
  }
  if (relation.relation === "field-read") return { relation: "read", from: ownerField, to: relation.sourceSymbol };
  if (relation.relation === "field-to-call-argument") return { relation: "argument", from: ownerField, to: relation.targetQualifiedName };
  if (relation.relation === "field-to-return") return { relation: "return", from: ownerField, to: relation.targetQualifiedName };
  if (["call", "import", "export"].includes(relation.relation)) return { relation: "boundary", from: relation.sourceSymbol || relation.ownerQualifiedName, to: relation.targetQualifiedName };
  return null;
}

function sourceProof(relation, repositories) {
  const evidence = (relation.evidence || []).find(item => item?.file && item.range?.start?.line);
  const repository = evidence && repositoryFor(evidence.file, repositories);
  if (!evidence || !repository) return null;
  try {
    const bytes = fs.readFileSync(evidence.file), sourceHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (relation.analysisSourceHash && sourceHash !== relation.analysisSourceHash) return null;
    const line = evidence.range.start.line, endLine = evidence.range.end?.line || line;
    const sourceFragment = bytes.toString("utf8").replace(/\r\n/g, "\n").split("\n").slice(line - 1, endLine).join("\n");
    return { repository: repository.id, file: path.resolve(evidence.file), line, endLine, sourceHash, sourceFragment };
  } catch { return null; }
}

function buildValueFlow(relations, roots, repositoryScope) {
  const repositories = repositoryScope?.repositories || [], rootNames = unique(roots);
  const candidates = (relations || []).map(relation => {
    const shape = relationShape(relation); if (!shape?.from || !shape?.to || [shape.from, shape.to].includes("unknown")) return null;
    const proof = sourceProof(relation, repositories);
    const exact = proof && relation.dynamic !== true && (relation.evidence || []).some(item => ["exact", "resolved"].includes(item.confidence));
    const locator = proof ? [proof.repository, path.relative(repositories.find(row => row.id === proof.repository).root, proof.file).replace(/\\/g, "/"), proof.line, proof.endLine] : [shape.from, shape.to];
    const id=stableId("flow-edge", [...locator, shape.relation, shape.from, shape.to]);
    return { kind: "value-flow-edge", id, ...shape, status: exact ? "source-confirmed" : "unresolved", ...(proof || {}), originalRelation: relation.relation };
  }).filter(Boolean);
  const reachable = new Set(rootNames), selected = new Map(); let changed = true;
  while (changed) {
    changed = false;
    for (const edge of candidates) if ([...reachable].some(value => same(value, edge.from))) {
      if (!selected.has(edge.id)) { selected.set(edge.id, edge); changed = true; }
      if (![...reachable].some(value => same(value, edge.to))) { reachable.add(edge.to); changed = true; }
    }
  }
  return [...selected.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function buildObligationTree(edges) {
  const flowEdges = [...(edges || [])].sort((a,b)=>a.id.localeCompare(b.id)), obligations = [], edgeToObligation=new Map();
  const incoming = edge => flowEdges.filter(candidate => candidate.id !== edge.id && same(candidate.to, edge.from));
  let pending=[...flowEdges];
  while(pending.length){let progressed=false;
    for(const edge of [...pending]){const predecessors=incoming(edge),available=predecessors.map(row=>edgeToObligation.get(row.id)).filter(Boolean).sort();if(predecessors.length&&!available.length)continue;
      const parentObligationRef=available[0]||null,parent=parentObligationRef&&obligations.find(row=>row.id===parentObligationRef),edgeRefs=unique([...(parent?.edgeRefs||[]),edge.id]),id=stableId("path-obligation",edgeRefs);
      const unresolved=edge.status!=="source-confirmed"||predecessors.length>1||parent?.status==="unresolved",reason=edge.status!=="source-confirmed"?"unconfirmed-edge":predecessors.length>1?"merged-predecessors":parent?.status==="unresolved"?"unresolved-predecessor":undefined;
      obligations.push({kind:"path-obligation",id,...(parentObligationRef?{parentObligationRef}:{}),edgeRefs,frontier:edge.to,status:unresolved?"unresolved":"open",...(reason?{reason}:{})});edgeToObligation.set(edge.id,id);pending=pending.filter(row=>row.id!==edge.id);progressed=true;
    }
    if(!progressed){for(const edge of pending){const id=stableId("path-obligation",[edge.id,"cycle"]);obligations.push({kind:"path-obligation",id,edgeRefs:[edge.id],frontier:edge.to,status:"unresolved",reason:"cycle"});edgeToObligation.set(edge.id,id);}break;}
  }
  return obligations.sort((a, b) => a.id.localeCompare(b.id));
}

function splitObligation(obligation, branches) {
  const children = (branches || []).map(branch => ({ kind: "path-obligation",
    id: stableId("path-obligation", [obligation.id, branch.key, ...(branch.edgeRefs || [])]), parentObligationRef: obligation.id,
    edgeRefs: unique([...(obligation.edgeRefs || []), ...(branch.edgeRefs || [])]), frontier: branch.frontier,
    status: branch.status || (obligation.status === "unresolved" ? "unresolved" : "open"), ...((branch.reason || obligation.status === "unresolved") ? { reason: branch.reason || "unresolved-predecessor" } : {}) }));
  return [...new Map(children.map(row => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

function validateObligationTree(obligations, outcomes) {
  const rows = new Map((obligations || []).map(row => [row.id, row])), byParent = new Map(), errors = [];
  for (const row of rows.values()) {
    if (row.parentObligationRef && !rows.has(row.parentObligationRef)) errors.push(`${row.id}: orphan parent`);
    if (row.parentObligationRef) byParent.set(row.parentObligationRef, [...(byParent.get(row.parentObligationRef) || []), row.id]);
  }
  const outcomeCounts = new Map(); for (const outcome of outcomes || []) for (const ref of outcome.obligationRefs || []) outcomeCounts.set(ref, (outcomeCounts.get(ref) || 0) + 1);
  for (const row of rows.values()) {
    const children = unique(byParent.get(row.id) || []), count = (outcomeCounts.get(row.id) || 0) + (row.status === "unresolved" && !children.length ? 1 : 0);
    if (children.length && count) errors.push(`${row.id}: non-leaf has terminal outcome`);
    if (!children.length && count !== 1) errors.push(`${row.id}: leaf requires exactly one terminal outcome`);
    const seen = new Set([row.id]); let parent = row.parentObligationRef;
    while (parent) { if (seen.has(parent)) { errors.push(`${row.id}: obligation cycle`); break; } seen.add(parent); parent = rows.get(parent)?.parentObligationRef; }
  }
  return { ok: !errors.length, errors: unique(errors), roots: [...rows.values()].filter(row => !row.parentObligationRef).map(row => row.id).sort(), leaves: [...rows.values()].filter(row => !(byParent.get(row.id) || []).length).map(row => row.id).sort() };
}

module.exports = { buildObligationTree, buildValueFlow, relationShape, splitObligation, validateObligationTree };
