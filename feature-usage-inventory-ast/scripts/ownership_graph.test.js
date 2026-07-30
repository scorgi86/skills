"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { advanceOwnershipGraph } = require("./stage2_runner");
const { buildOwnershipGraph, validateOwnershipGraph } = require("./ownership_graph");

test("ownership graph assigns increasing owner orders from order-zero seeds", () => {
  const graph = buildOwnershipGraph({
    maxOrder: 3,
    nodes: [{ id: "effect", entity: "Effect", order: 0 }, { id: "list", entity: "EffectList" }, { id: "shape", entity: "ShapeProperties" }],
    edges: [
      { from: "list", to: "effect", relation: "contains", propertyOrMethod: "effect" },
      { from: "shape", to: "list", relation: "owns", propertyOrMethod: "effects" },
    ],
  });
  assert.deepEqual(graph.nodes.map((node) => [node.id, node.order]), [["effect", 0], ["list", 1], ["shape", 2]]);
  assert.deepEqual(graph.frontier, []);
  assert.equal(validateOwnershipGraph(graph).ok, true);
});

test("non-ownership relations do not create a higher order", () => {
  const graph = buildOwnershipGraph({
    nodes: [{ id: "effect", entity: "Effect", order: 0 }, { id: "writer", entity: "Writer" }],
    edges: [{ from: "writer", to: "effect", relation: "serializes", propertyOrMethod: "write" }],
  });
  assert.equal(graph.nodes.find((node) => node.id === "writer").order, null);
  assert.equal(validateOwnershipGraph(graph).ok, true);
});

test("graph validation rejects dangling higher-order nodes", () => {
  const graph = { nodes: [{ id: "seed", order: 0 }, { id: "dangling", order: 1 }], edges: [] };
  assert.match(validateOwnershipGraph(graph).errors.join("\n"), /dangling/);
});

test("stage two advances a prior graph with discovered nodes and ownership edges", () => {
  const prior = buildOwnershipGraph({ nodes: [{ id: "effect", entity: "Effect", order: 0 }, { id: "list", entity: "EffectList" }], edges: [{ from: "list", to: "effect", relation: "contains" }] });
  const next = advanceOwnershipGraph(prior, {
    ownershipGraphNodes: [{ id: "shape", entity: "ShapeProperties" }],
    ownershipGraphCandidates: [{ from: "shape", to: "list", relation: "owns", propertyOrMethod: "effects" }],
  });
  assert.equal(next.nodes.find((node) => node.id === "shape").order, 2);
  assert.equal(validateOwnershipGraph(next).ok, true);
});

test("stage two replaces a candidate edge with its source-confirmed observation", () => {
  const prior = buildOwnershipGraph({ nodes: [{ id: "effect", entity: "Effect", order: 0 }, { id: "list", entity: "List" }], edges: [{ id: "list-effect", from: "list", to: "effect", relation: "contains", status: "candidate" }] });
  const next = advanceOwnershipGraph(prior, { ownershipGraphCandidates: [{ id: "list-effect", from: "list", to: "effect", relation: "contains", status: "confirmed", anchors: ["fixture.js:2"] }] });
  assert.equal(next.edges.find((edge) => edge.id === "list-effect").status, "confirmed");
});
