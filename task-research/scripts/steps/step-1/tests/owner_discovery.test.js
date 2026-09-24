"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runAstBatch } = require("../../../shared/ast/src/batch/batch.js");
const { SourceSnapshotStore } = require("../../../shared/evidence/src/source_snapshot.js");
const { validateOwnershipGraph } = require("../../../shared/ownership/src/ownership_graph.js");
const { createOwnerNode, discoverOwnerCandidates } = require("../src/owner_discovery.js");

test("owner node factory applies defaults then caller overrides", () => {
  assert.deepEqual(createOwnerNode({ id: "a", entity: "Thing" }), { id: "a", entity: "Thing", role: "owner", order: null });
  assert.deepEqual(createOwnerNode({ id: "b", entity: "Seed", role: "seed", order: 0 }), { id: "b", entity: "Seed", role: "seed", order: 0 });
});

test("owner candidates are generic, anchored, deduplicated and bound to current source", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-discovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, "function Entity() {}\nfunction Box() { this.value = new Entity(); }\nfunction Root() { this.box = new Box(); }\n");
  const ast = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Entity" } }], ownerSeedTypes: ["Entity"] });
  const request = { repositoryScope: { repositories: [{ id: "repo", root, role: "source" }] }, ownership: { groups: [{ id: "seed", order: 0, object: "Entity" }] } };
  const first = discoverOwnerCandidates(ast, request, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.equal(first.groups.length, 2);
  assert.deepEqual(first.groups.map(group => group.relation), ["stores", "stores"]);
  assert.ok(first.groups.every(group => group.anchor.file === file && group.anchor.line > 0));
  assert.equal(first.graph.edges.length, 2);
  assert.equal(first.unresolved.length, 0);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8") + "// changed\n");
  const changed = discoverOwnerCandidates(ast, request, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.notEqual(changed.reviewDigest, first.reviewDigest);
  assert.deepEqual(changed.groups.map(group => group.id), first.groups.map(group => group.id));
});

test("exact storage links become source-confirmed ownership facts", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-auto-confirm-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, "class Entity {}\nclass Box { constructor() { this.value = new Entity(); } }\n");
  const evidence = { file, range: { start: { line: 2 }, end: { line: 2 } }, confidence: "exact" };
  const ast = { ownerChains: [{ repository: "repo", seed: "Entity", chains: [{ status: "leaf", chain: [
    { level: 0, type: "Entity" },
    { level: 1, owner: "Box", field: "value", type: "Entity", relation: "field-write", ownerCandidate: false, ownerConfidence: "exact", evidence: [evidence] }
  ] }] }], plan: { uniqueFiles: [file] } };
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  const group = result.groups[0];
  assert.equal(group.status, "confirmed");
  assert.deepEqual(group.evidenceRefs, [group.id]);
  assert.deepEqual(group.confirmation, {
    method: "ast-exact-storage", status: "source-confirmed", file, line: 2, endLine: 2,
    sourceFragment: "class Box { constructor() { this.value = new Entity(); } }",
    sourceHash: require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex"), evidenceRefs: [group.id]
  });
});

test("an exact factory return is source-confirmed with both anchors", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-exact-factory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  const source = ["function Entity() {}", "function Holder() {}", "Holder.prototype.make = function() { return new Entity(); };", "Holder.prototype.load = function() { this.value = this.make(); };"];
  fs.writeFileSync(file, source.join("\n"));
  const sourceHash = require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const ast = { ownerChains: [{ repository: "repo", seed: "Entity", chains: [{ status: "leaf", chain: [
    { level: 0, type: "Entity" },
    { level: 1, owner: "Holder", field: "value", type: "Entity", relation: "call-result-to-field", ownerCandidate: false, ownerConfidence: "exact", targetConfidence: "exact", assignmentSourceHash: sourceHash,
      evidence: [{ file, range: { start: { line: 4 }, end: { line: 4 } }, confidence: "resolved" }],
      targetProof: { file, range: { start: { line: 3 }, end: { line: 3 } }, sourceHash, confidence: "exact" } }
  ] }] }], plan: { uniqueFiles: [file] } };
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.equal(result.groups[0].status, "confirmed");
  assert.equal(result.groups[0].evidenceRefs.length, 2);
});

test("a reconciled clone owner is confirmed at the assignment with a separate method proof", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-clone-proof-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Item() {}",
    "function Props() {}",
    "Props.prototype.clone = function () { return new Props(); };",
    "function Shape() {",
    "  const props = this.props ? this.props.clone() : new Props();",
    "  props.item = new Item();",
    "}",
  ].join("\n"));
  const ast = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Item" } }], ownerSeedTypes: ["Item"], ownerRepositories: [{ id: "repo", root }] });
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  const group = result.groups.find(row => row.object === "Props.item");
  assert.equal(group.status, "confirmed");
  assert.equal(group.anchor.line, 6);
  assert.equal(group.confirmation.line, 6);
  assert.equal(group.evidenceRefs.length, 2);
  assert.deepEqual(result.evidenceCandidates.map(row => [row.usageKind, row.line]), [["field-write", 6], ["ast-definition", 3]]);

  fs.appendFileSync(file, "\n// proof changed");
  const stale = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.equal(stale.groups.find(row => row.object === "Props.item").status, "candidate");
  assert.ok(stale.unresolved.some(row => row.reason === "stale-or-missing-owner-proof"));
});

test("an exact-possible factory return remains a candidate until its discriminator is proven", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-possible-factory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Blur() {}",
    "function Holder() {}",
    "Holder.prototype.make = function(item) { switch (item.type) { case 'inner': return new Inner(); case 'blur': return new Blur(); } };",
    "Holder.prototype.load = function(payload) { this.possible = this.make(payload['slot']); this.exact = this.make({ type: 'inner' }); };",
  ].join("\n"));
  const ast = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Inner" } }], ownerSeedTypes: ["Inner"], ownerRepositories: [{ id: "repo", root }] });
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  const possible = result.groups.find(group => group.object === "Holder.possible");
  const exact = result.groups.find(group => group.object === "Holder.exact");
  assert.equal(possible, undefined);
  assert.ok(result.unresolved.some(row => row.reason === "factory-return-not-narrowed" && row.field === "possible"));
  assert.equal(exact.status, "confirmed");
});

test("candidate and dynamic storage links remain candidates", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-auto-candidate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, "const box = {};\nbox.value = value;\n");
  const evidence = confidence => [{ file, range: { start: { line: 2 }, end: { line: 2 } }, confidence }];
  const ast = { ownerChains: [{ repository: "repo", seed: "Entity", chains: [
    { status: "leaf", chain: [{ level: 0, type: "Entity" }, { level: 1, owner: "Candidate", field: "value", type: "Entity", relation: "field-write", ownerCandidate: true, ownerConfidence: "candidate", evidence: evidence("exact") }] },
    { status: "leaf", chain: [{ level: 0, type: "Entity" }, { level: 1, owner: "Dynamic", field: "value", type: "Entity", relation: "computed-write", ownerCandidate: false, ownerConfidence: "exact", dynamic: true, evidence: evidence("exact") }] },
    { status: "leaf", chain: [{ level: 0, type: "Entity" }, { level: 1, owner: "Weak", field: "value", type: "Entity", relation: "field-write", ownerCandidate: false, ownerConfidence: "exact", evidence: evidence("candidate") }] },
    { status: "leaf", chain: [{ level: 0, type: "Entity" }, { level: 1, owner: "MissingProof", field: "value", type: "Entity", relation: "field-write", ownerCandidate: false, evidence: evidence("exact") }] },
    { status: "leaf", chain: [{ level: 0, type: "Entity" }, { level: 1, owner: "Incomplete", field: "value", type: "Entity", relation: "field-write", ownerCandidate: false, ownerConfidence: "exact", evidence: [{ file, range: { start: { line: 2 }, end: { line: 3 } }, confidence: "exact" }] }] }
  ] }], plan: { uniqueFiles: [file] } };
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.ok(result.groups.every(group => group.status === "candidate" && group.confirmation === undefined));
});

test("a junction to an external source cannot become a source-confirmed owner", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-auto-junction-root-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "owner-auto-junction-external-"));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(external, { recursive: true, force: true }); });
  const outsideFile = path.join(external, "fixture.js");
  fs.writeFileSync(outsideFile, "class Entity {}\nclass Box { constructor() { this.value = new Entity(); } }\n");
  const linked = path.join(root, "linked");
  fs.symlinkSync(external, linked, "junction");
  const file = path.join(linked, "fixture.js");
  const ast = { ownerChains: [{ repository: "repo", seed: "Entity", chains: [{ status: "leaf", chain: [
    { level: 0, type: "Entity" },
    { level: 1, owner: "Box", field: "value", type: "Entity", relation: "field-write", ownerCandidate: false, ownerConfidence: "exact", evidence: [{ file, range: { start: { line: 2 }, end: { line: 2 } }, confidence: "exact" }] }
  ] }] }], plan: { uniqueFiles: [file] } };
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.equal(result.groups[0].status, "candidate");
  assert.equal(result.groups[0].confirmation, undefined);
});

test("a computed collection receiver remains an owner candidate", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-auto-computed-collection-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, "function Entity() {}\nfunction Box() { this[\"items\"].push(new Entity()); }\n");
  const ast = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Entity" } }], ownerSeedTypes: ["Entity"] });
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.equal(result.groups.length, 0);
  assert.ok(result.unresolved.some(item => item.relation === "collection-push"));
});

test("owner edges use the preceding node ID even when AST type names differ", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-linked-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, "first\nsecond\n");
  const evidence = line => [{ file, range: { start: { line } } }];
  const ast = { ownerChains: [{ repository: "repo", seed: "Entity", chains: [{ status: "leaf", chain: [
    { level: 0, type: "Entity" },
    { level: 1, owner: "Module.Box", type: "Entity", field: "value", relation: "field-write", evidence: evidence(1) },
    { level: 2, owner: "Root", type: "Box", field: "box", relation: "field-write", evidence: evidence(2) }
  ] }] }], results: [{ id: "find", files: [file] }], plan: { uniqueFiles: [file] } };
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.equal(result.graph.edges.length, 2);
  const box = result.graph.nodes.find(node => node.entity === "Module.Box");
  assert.ok(result.graph.edges.some(edge => edge.to === box.id));
});

test("an unanchored intermediate node leaves the branch unresolved without a dangling edge", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-unanchored-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, "source\n");
  const ast = { ownerChains: [{ repository: "repo", seed: "Entity", chains: [{ status: "leaf", chain: [
    { level: 0, type: "Entity" },
    { level: 1, owner: "Box", type: "Entity", field: "value", relation: "field-write", evidence: [] },
    { level: 2, owner: "Root", type: "Box", field: "box", relation: "field-write", evidence: [{ file, range: { start: { line: 1 } } }] }
  ] }] }], results: [{ id: "find", files: [file] }], plan: { uniqueFiles: [file] } };
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.equal(result.graph.edges.length, 0);
  assert.ok(result.unresolved.some(row => row.reason === "missing-source-anchor"));
});

test("converging owner paths retain valid edges and expose the conflicting source link", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-converging-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, "one\ntwo\nthree\n");
  const step = (level, owner, type, line) => ({ level, owner, type, field: "value", relation: "field-write", evidence: [{ file, range: { start: { line } } }] });
  const ast = { ownerChains: [{ repository: "repo", seed: "Seed", chains: [
    { status: "leaf", chain: [{ level: 0, type: "Seed" }, step(1, "A", "Seed", 1)] },
    { status: "leaf", chain: [{ level: 0, type: "Seed" }, step(1, "B", "Seed", 2), step(2, "A", "B", 3)] }
  ] }], results: [{ id: "find", files: [file] }], plan: { uniqueFiles: [file] } };
  const result = discoverOwnerCandidates(ast, { repositoryScope: { repositories: [{ id: "repo", root }] } }, { outputDigest: "a".repeat(64) }, new SourceSnapshotStore());
  assert.equal(validateOwnershipGraph(result.graph).ok, true);
  assert.equal(result.graph.edges.length, 2);
  assert.equal(result.groups.length, 2);
  assert.ok(result.unresolved.some(row => row.reason === "order-conflict" && row.anchor.file === file && row.anchor.line === 3 && row.edgeId));
});
