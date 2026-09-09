"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { advanceOwnershipGraph } = require("../../../steps/step-2/src/runner");
const { buildOwnershipGraph, validateOwnershipGraph } = require("../src/ownership_graph");

test("ownership graph assigns increasing owner orders from order-zero seeds", () => {
  const graph = buildOwnershipGraph({
    maxOrder: 3,
    nodes: [{ id: "value", entity: "FeatureValue", order: 0 }, { id: "collection", entity: "FeatureCollection" }, { id: "container", entity: "FeatureContainer" }],
    edges: [
      { from: "collection", to: "value", relation: "contains", propertyOrMethod: "value" },
      { from: "container", to: "collection", relation: "owns", propertyOrMethod: "values" },
    ],
  });
  assert.deepEqual(graph.nodes.map((node) => [node.id, node.order]), [["value", 0], ["collection", 1], ["container", 2]]);
  assert.deepEqual(graph.frontier, []);
  assert.equal(validateOwnershipGraph(graph).ok, true);
});

test("non-ownership relations do not create a higher order", () => {
  const graph = buildOwnershipGraph({
    nodes: [{ id: "value", entity: "FeatureValue", order: 0 }, { id: "writer", entity: "Writer" }],
    edges: [{ from: "writer", to: "value", relation: "serializes", propertyOrMethod: "write" }],
  });
  assert.equal(graph.nodes.find((node) => node.id === "writer").order, null);
  assert.equal(validateOwnershipGraph(graph).ok, true);
});

test("graph validation rejects dangling higher-order nodes", () => {
  const graph = { nodes: [{ id: "seed", order: 0 }, { id: "dangling", order: 1 }], edges: [] };
  assert.match(validateOwnershipGraph(graph).errors.join("\n"), /dangling/);
});

test("stage two advances a prior graph with discovered nodes and ownership edges", () => {
  const prior = buildOwnershipGraph({ nodes: [{ id: "value", entity: "FeatureValue", order: 0 }, { id: "list", entity: "FeatureCollection" }], edges: [{ from: "list", to: "value", relation: "contains" }] });
  const next = advanceOwnershipGraph(prior, {
    ownershipGraphNodes: [{ id: "container", entity: "FeatureContainer" }],
    ownershipGraphCandidates: [{ from: "container", to: "list", relation: "owns", propertyOrMethod: "values" }],
  });
  assert.equal(next.nodes.find((node) => node.id === "container").order, 2);
  assert.equal(validateOwnershipGraph(next).ok, true);
});

test("stage two replaces a candidate edge with its source-confirmed observation", () => {
  const prior = buildOwnershipGraph({ nodes: [{ id: "value", entity: "FeatureValue", order: 0 }, { id: "list", entity: "FeatureCollection" }], edges: [{ id: "list-value", from: "list", to: "value", relation: "contains", status: "candidate" }] });
  const next = advanceOwnershipGraph(prior, { ownershipGraphCandidates: [{ id: "list-value", from: "list", to: "value", relation: "contains", status: "confirmed", anchors: ["fixture.js:2"] }] });
  assert.equal(next.edges.find((edge) => edge.id === "list-value").status, "confirmed");
});
