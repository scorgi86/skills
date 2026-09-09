"use strict";

const OWNERSHIP_RELATIONS = new Set(["stores", "owns", "contains", "wraps"]);

function stableId(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeNode(item, index) {
  if (!item || !item.entity) throw new Error(`ownershipGraph node ${index + 1} requires entity`);
  return {
    id: String(item.id || stableId(item.entity)),
    entity: String(item.entity),
    role: String(item.role || "entity"),
    status: String(item.status || "candidate"),
    order: Number.isInteger(item.order) && item.order >= 0 ? item.order : null,
    evidenceRefs: [...new Set(item.evidenceRefs || [])],
    anchors: [...new Set(item.anchors || [])],
  };
}

function normalizeEdge(item, index) {
  if (!item || !item.from || !item.to || !item.relation) throw new Error(`ownershipGraph edge ${index + 1} requires from, to, relation`);
  return {
    id: String(item.id || `${item.from}:${item.relation}:${item.to}`),
    from: String(item.from),
    to: String(item.to),
    relation: String(item.relation),
    propertyOrMethod: String(item.propertyOrMethod || ""),
    status: String(item.status || "candidate"),
    evidenceRefs: [...new Set(item.evidenceRefs || [])],
    anchors: [...new Set(item.anchors || [])],
  };
}

function isOwnership(edge) { return OWNERSHIP_RELATIONS.has(edge.relation); }

function buildOwnershipGraph(input = {}) {
  const nodes = (input.nodes || input.seedNodes || []).map(normalizeNode);
  const edges = [...(input.edges || []), ...(input.candidateEdges || [])].map(normalizeEdge);
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`Duplicate ownershipGraph node: ${node.id}`);
    byId.set(node.id, node);
  }
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) throw new Error(`ownershipGraph edge ${edge.id} references an unknown node`);
  }
  const maxOrder = Number.isInteger(input.maxOrder) && input.maxOrder >= 0 ? input.maxOrder : 3;
  const seeds = nodes.filter((node) => node.order === 0);
  if (!seeds.length) throw new Error("ownershipGraph requires at least one order-0 seed node");
  const ownerEdgesByChild = new Map();
  for (const edge of edges.filter(isOwnership)) {
    if (!ownerEdgesByChild.has(edge.to)) ownerEdgesByChild.set(edge.to, []);
    ownerEdgesByChild.get(edge.to).push(edge);
  }
  // A Stage 2 artifact already contains computed owners. Start from every
  // reachable node so newly supplied candidate edges can advance its frontier.
  const queue = nodes.filter((node) => node.order !== null).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const cycles = [];
  while (queue.length) {
    const child = queue.shift();
    if (child.order >= maxOrder) continue;
    for (const edge of ownerEdgesByChild.get(child.id) || []) {
      const owner = byId.get(edge.from);
      const nextOrder = child.order + 1;
      if (owner.order === null) {
        owner.order = nextOrder;
        queue.push(owner);
      } else if (owner.order > nextOrder) {
        owner.order = nextOrder;
        queue.push(owner);
      } else if (owner.order <= child.order) {
        cycles.push({ edgeId: edge.id, from: edge.from, to: edge.to, orders: [owner.order, child.order] });
      }
    }
  }
  // Nodes at the declared boundary are the next search frontier even when no
  // higher-order candidate has been discovered yet. Known unresolved owners
  // also keep their child in the frontier.
  const frontier = nodes.filter((node) => node.order !== null && (
    node.order === maxOrder ||
    (node.order < maxOrder && (ownerEdgesByChild.get(node.id) || []).some((edge) => byId.get(edge.from).order === null))
  ));
  return {
    schemaVersion: "1.0.0",
    maxOrder,
    nodes: [...byId.values()].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
    frontier: frontier.map((node) => node.id).sort(),
    cycles,
  };
}

function validateOwnershipGraph(graph) {
  const errors = [];
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { ok: false, errors: ["ownershipGraph is missing"] };
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!graph.nodes.some((node) => node.order === 0)) errors.push("ownershipGraph has no order-0 seed node");
  for (const node of graph.nodes) {
    if (node.order === null || node.order === undefined) continue;
    if (node.order === 0) continue;
    const parent = graph.edges.find((edge) => isOwnership(edge) && edge.from === node.id && byId.get(edge.to)?.order === node.order - 1);
    if (!parent) errors.push(`${node.id}: order-${node.order} node is not connected to an order-${node.order - 1} child by an ownership edge`);
  }
  for (const edge of graph.edges.filter(isOwnership)) {
    const owner = byId.get(edge.from);
    const child = byId.get(edge.to);
    if (owner?.order !== null && child?.order !== null && owner.order <= child.order) errors.push(`${edge.id}: ownership order must increase from child to owner`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { OWNERSHIP_RELATIONS, buildOwnershipGraph, validateOwnershipGraph };
