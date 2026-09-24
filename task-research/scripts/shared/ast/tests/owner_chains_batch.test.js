"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runAstBatch, selectBootstrapSeed } = require("../src/batch/batch.js");
const { buildChains } = require("../src/query/chains.js");
const { analyzeFile } = require("../src/analysis/analysis.js");

test("null cannot become a concrete owner or bridge between types", () => {
  const relations = [
    { ownerQualifiedName: "Holder", targetQualifiedName: "Seed", field: "value", relation: "field-write" },
    { ownerQualifiedName: "null", targetQualifiedName: "Holder", field: "holder", relation: "field-write" },
    { ownerQualifiedName: "Controller", targetQualifiedName: "null", field: "selection", relation: "field-write" },
  ];
  const result = buildChains(relations, "Seed");
  assert.deepEqual(result.chains.map(row => row.chain.map(step => step.owner).filter(Boolean)), [["Holder"]]);
});

test("bootstrap seed accepts one exact declaration and refuses absent or ambiguous symbols", () => {
  const file = path.join(os.tmpdir(), "bootstrap-seed.js");
  fs.writeFileSync(file,"function Feature() {}\n");
  const scope = { repositories: [{ id: "repo", root: os.tmpdir(), role: "source" }] };
  const sourceHash=require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const result = [{ file, analysisSourceHash:sourceHash, symbols: [{ kind: "function", name: "Feature", qualifiedName: "Feature", evidence: [{ file, range: { start: { line: 1, offset: 0 },end:{line:1,offset:21} } }] }, { kind: "import", name: "Feature", qualifiedName: "Feature", evidence: [{ file, range: { start: { line: 2, offset: 1 } } }] }] }];
  const selected = selectBootstrapSeed(result, { directSeeds: ["Feature"], repositoryScope: scope });
  assert.equal(selected.status, "selected");
  assert.equal(selected.group.relation, "defines");
  assert.match(selected.group.id, /^bootstrap-seed-[a-f0-9]{16}$/);
  assert.equal(selected.proof.sourceFragment,"function Feature() {}");
  assert.equal(selected.proof.sourceHash,sourceHash);
  assert.equal(selectBootstrapSeed(result, { directSeeds: ["Missing"], repositoryScope: scope }).status, "seed-not-found");
  const other = path.join(os.tmpdir(), "bootstrap-other.js");
  fs.writeFileSync(other,"function Feature() {}\n");
  assert.equal(selectBootstrapSeed([...result, { file: other, analysisSourceHash: sourceHash, symbols: [{ ...result[0].symbols[0], evidence: [{ file: other, range: { start: { line: 1, offset: 0 }, end: { line: 1, offset: 21 } } }] }] }], { directSeeds: ["Feature"], repositoryScope: scope }).status, "seed-ambiguous");
});

test("bootstrap seed is selected independently from the discovery dictionary", () => {
  const file = path.join(os.tmpdir(), "bootstrap-dictionary.js");
  fs.writeFileSync(file,"function CInnerShadow() {}\nfunction CInnerShadowProperty() {}\n");
  const scope = { repositories: [{ id: "repo", root: os.tmpdir(), role: "source" }] };
  const symbol = (name, line) => ({ kind: "function", name, qualifiedName: name, evidence: [{ file, range: { start: { line, offset: line } } }] });
  const result = [{ file,analysisSourceHash:require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex"), symbols: [symbol("CInnerShadow", 1), symbol("CInnerShadowProperty", 2)] }];
  assert.equal(selectBootstrapSeed(result, { directSeeds: ["CInnerShadow", "CInnerShadowProperty"], repositoryScope: scope }).status, "seed-ambiguous");
  const selected = selectBootstrapSeed(result, { directSeeds: ["CInnerShadow", "CInnerShadowProperty"], bootstrapSeed: "CInnerShadow", repositoryScope: scope });
  assert.equal(selected.status, "selected");
  assert.equal(selected.group.object, "CInnerShadow");
});

test("one AST analysis exposes generic owner chains and unresolved writes", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-chains-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Entity() {}",
    "function Box() { this.value = new Entity(); }",
    "function Root() { this.box = new Box(); }",
    "Box.prototype.setValue = function(value) { this.value = value; };",
  ].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Entity" } }], ownerSeedTypes: ["Entity"] });
  assert.equal(result.stats.parseCounts[file], 1);
  assert.equal(result.ownerChains.length, 1);
  assert.ok(result.ownerChains[0].chains.some(row => row.chain.some(step => step.owner === "Box" && step.field === "value")));
  assert.ok(result.ownerChains[0].chains.some(row => row.chain.some(step => step.owner === "Root" && step.field === "box")));
  assert.ok(result.ownerChains[0].unresolved.some(row => row.relation === "parameter-to-field"));
});

test("unknown writes inside the seed are not unresolved owner paths", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-seed-fields-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Seed() { this.blurRad = readLong(); }",
    "function Holder() { this.seed = new Seed(); this.other = makeOther(); }",
  ].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Seed" } }], ownerSeedTypes: ["Seed"] });
  assert.equal(result.ownerChains[0].unresolved.some(row => row.owner === "Seed" && row.field === "blurRad"), false);
  assert.ok(result.ownerChains[0].unresolved.some(row => row.owner === "Holder" && row.field === "other"));
});

test("owner chains do not join same-named types across repositories", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-scope-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, "a"), b = path.join(root, "b");
  fs.mkdirSync(a); fs.mkdirSync(b);
  const fileA = path.join(a, "a.js"), fileB = path.join(b, "b.js");
  fs.writeFileSync(fileA, "function Entity() {}\n");
  fs.writeFileSync(fileB, "function Holder() { this.value = new Entity(); }\n");
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", files: [fileA, fileB], options: { terms: "Entity" } }], ownerSeedTypes: ["Entity"], ownerRepositories: [{ id: "a", root: a }, { id: "b", root: b }] });
  assert.equal(result.ownerChains.find(row => row.repository === "a").chains[0].status, "not-found");
  assert.ok(result.ownerChains.find(row => row.repository === "b").unresolved.some(row => row.reason === "seed-declaration-not-in-scope"));
});

test("owner seed scope excludes another repository with its own same-named declaration", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-seed-scope-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, "a"), b = path.join(root, "b");
  fs.mkdirSync(a); fs.mkdirSync(b);
  const fileA = path.join(a, "a.js"), fileB = path.join(b, "b.js");
  fs.writeFileSync(fileA, "function Entity() {}\nfunction A() { this.value = new Entity(); }\n");
  fs.writeFileSync(fileB, "function Entity() {}\nfunction B() { this.value = new Entity(); }\n");
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", files: [fileA, fileB], options: { terms: "Entity" } }], ownerSeedTypes: ["Entity"], ownerRepositories: [{ id: "a", root: a }, { id: "b", root: b }], ownerSeedScopes: [{ seed: "Entity", repository: "a" }] });
  assert.equal(result.ownerChains.length, 1);
  assert.equal(result.ownerChains[0].repository, "a");
  assert.ok(result.ownerChains[0].chains.some(row => row.chain.some(step => step.owner === "A")));
  assert.equal(result.ownerChains[0].chains.some(row => row.chain.some(step => step.owner === "B")), false);
});

test("conditional local variable preserves one concrete owner candidate without promoting ambiguity", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-local-candidate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function CEffectLst() {}",
    "function CEffectProperties() {}",
    "function Other() {}",
    "function Shape() {",
    "  const oEffectProps = this.effectProps ? this.effectProps.clone() : new CEffectProperties();",
    "  oEffectProps.EffectLst = new CEffectLst();",
    "  const alias = oEffectProps;",
    "  alias.EffectLst = new CEffectLst();",
    "  const ambiguous = this.flag ? new CEffectProperties() : new Other();",
    "  ambiguous.EffectLst = new CEffectLst();",
    "}",
  ].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "CEffectLst" } }], ownerSeedTypes: ["CEffectLst"] });
  const steps = result.ownerChains[0].chains.flatMap(row => row.chain);
  assert.ok(steps.some(step => step.owner === "CEffectProperties" && step.ownerCandidate === true));
  assert.equal(steps.some(step => step.owner === "Other"), false);
  const candidates = result.ownerChains[0].unresolved.filter(row => row.owner === "CEffectProperties" && row.ownerCandidate === true);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].evidence.length, 2);
});

test("exact clone return resolves a guarded conditional owner", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-clone-return-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Item() {}",
    "function Props() {}",
    "Props.prototype.clone = function () { const copy = new Props(); return copy; };",
    "function Shape() {",
    "  const props = this.props ? this.props.clone() : new Props();",
    "  props.item = new Item();",
    "  const reverse = this.reverse ? new Props() : this.reverse.clone();",
    "  reverse.item = new Item();",
    "  const mismatch = this.flag ? this.other.clone() : new Props();",
    "  mismatch.unmatched = new Item();",
    "}",
  ].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Item" } }], ownerSeedTypes: ["Item"] });
  const steps = result.ownerChains[0].chains.flatMap(row => row.chain).filter(step => step.owner === "Props" && step.field === "item");
  assert.ok(steps.some(step => step.ownerCandidate === false && step.ownerConfidence === "exact"
    && step.evidence[0].confidence === "resolved" && step.evidence[0].range.start.line === 6
    && step.ownerProofEvidence?.range.start.line === 3 && /^[a-f0-9]{64}$/.test(step.ownerProofEvidence.sourceHash)));
  assert.ok(result.ownerChains[0].unresolved.some(row => row.owner === "Props" && row.field === "unmatched" && row.ownerCandidate === true));
  assert.equal(result.ownerChains[0].unresolved.filter(row => row.owner === "Props" && row.field === "unmatched" && row.ownerCandidate === true)[0].evidence.length, 1);
});

test("file analysis keeps an exact clone return as a candidate for batch reconciliation", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-deferred-clone-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Item() {}",
    "function Props() {}",
    "Props.prototype.clone = function () { return new Props(); };",
    "function Shape() { const props = this.props ? this.props.clone() : new Props(); props.item = new Item(); }",
  ].join("\n"));
  const relation = analyzeFile(file).result.relations.find(item => item.ownerQualifiedName === "Props" && item.field === "item");
  assert.equal(relation.ownerCandidate, true);
  assert.deepEqual(relation.ownerProof, { kind: "exact-method-return", ownerType: "Props", method: "clone", returnType: "Props" });
});

test("a repository batch reconciles an exact clone return from another file", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-cross-file-return-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const definition = path.join(root, "definition.js"), use = path.join(root, "use.js");
  fs.writeFileSync(definition, ["function Item() {}", "function Props() {}", "Props.prototype.clone = function () { const copy = new Props(); return copy; };"] .join("\n"));
  fs.writeFileSync(use, ["function Shape() {", "  const props = this.props ? this.props.clone() : new Props();", "  props.item = new Item();", "}"].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", files: [definition, use], options: { terms: "Item" } }], ownerSeedTypes: ["Item"], ownerRepositories: [{ id: "repo", root }], ownerSeedScopes: [{ seed: "Item", repository: "repo" }] });
  const steps = result.ownerChains[0].chains.flatMap(row => row.chain).filter(step => step.owner === "Props" && step.field === "item");
  assert.ok(steps.some(step => step.ownerCandidate === false && step.ownerConfidence === "exact"
    && step.evidence[0].confidence === "resolved" && step.ownerProofEvidence?.file === definition));
  assert.equal(result.ownerChains[0].unresolved.some(row => row.owner === "Props" && row.field === "item"), false);
});

test("conflicting cross-file clone returns remain owner candidates", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-cross-file-conflict-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = path.join(root, "first.js"), second = path.join(root, "second.js"), use = path.join(root, "use.js");
  fs.writeFileSync(first, ["function Props() {}", "Props.prototype.clone = function () { return new Props(); }"].join("\n"));
  fs.writeFileSync(second, ["function Other() {}", "Props.prototype.clone = function () { return new Other(); }"].join("\n"));
  fs.writeFileSync(use, ["function Item() {}", "function Shape() { const props = this.props ? this.props.clone() : new Props(); props.item = new Item(); }"].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", files: [first, second, use], options: { terms: "Item" } }], ownerSeedTypes: ["Item"], ownerRepositories: [{ id: "repo", root }], ownerSeedScopes: [{ seed: "Item", repository: "repo" }] });
  assert.ok(result.ownerChains[0].unresolved.some(row => row.owner === "Props" && row.field === "item" && row.ownerCandidate === true));
});

test("exact and candidate owner relations remain separate", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-mixed-confidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function CEffectLst() {}",
    "function CEffectProperties() {}",
    "function Shape() {",
    "  const exact = new CEffectProperties();",
    "  exact.EffectLst = new CEffectLst();",
    "  const candidate = this.props ? this.props.copy() : new CEffectProperties();",
    "  candidate.EffectLst = new CEffectLst();",
    "}",
  ].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "CEffectLst" } }], ownerSeedTypes: ["CEffectLst"] });
  const steps = result.ownerChains[0].chains.flatMap(row => row.chain).filter(step => step.owner === "CEffectProperties" && step.field === "EffectLst");
  assert.ok(steps.some(step => step.ownerCandidate === false));
  assert.ok(steps.some(step => step.ownerCandidate === true));
  assert.ok(result.ownerChains[0].unresolved.some(row => row.owner === "CEffectProperties" && row.ownerCandidate === true));
});

test("a switch factory retains possible returns as unresolved without claiming ownership", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-factory-set-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Glow() {}",
    "function Holder() {}",
    "Holder.prototype.make = function(value) { var result; switch (value.type) { case 'inner': result = new Inner(); return result; case 'glow': result = new Glow(); return result; } };",
    "Holder.prototype.load = function(value) { this.inner = this.make(value); }"
  ].join("\n"));
  const analysis = analyzeFile(file).result;
  const summary = analysis.methodSummaries.find(row => row.owner === "Holder" && row.method === "make");
  assert.deepEqual(summary.possibleReturnTypes.map(row => row.type), ["Glow", "Inner"]);
  assert.equal(summary.returnType, undefined);
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Inner" } }], ownerSeedTypes: ["Inner"] });
  const owners = result.ownerChains[0];
  assert.equal(owners.chains.flatMap(row => row.chain).some(row => row.owner === "Holder"), false);
  assert.ok(owners.unresolved.some(row => row.reason === "factory-return-not-narrowed" && row.field === "inner"));
});

test("runtime property spelling never selects a factory return", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-factory-keyed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Glow() {}",
    "function Holder() {}",
    "Holder.prototype.make = function(item) { switch (item.type) { case 'inner': return new Inner(); case 'glow': return new Glow(); } };",
    "Holder.prototype.load = function(payload) { this.first = this.make(payload['inner']); this.second = this.make(payload.inner); }"
  ].join("\n"));
  const summary = analyzeFile(file).result.methodSummaries.find(row => row.owner === "Holder" && row.method === "make");
  assert.deepEqual(summary.possibleReturnTypes.map(row => row.type), ["Glow", "Inner"]);
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Inner Glow" } }], ownerSeedTypes: ["Inner", "Glow"] });
  for (const seed of ["Inner", "Glow"]) {
    const owner = result.ownerChains.find(row => row.seed === seed);
    const fields = owner.unresolved.filter(row => row.reason === "factory-return-not-narrowed").map(row => row.field);
    assert.deepEqual(fields.sort(), ["first", "second"]);
  }
});

test("exact-possible factory returns do not consume ownership path limits", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-factory-path-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  const possibleFields = Array.from({ length: 30 }, (_, index) => `possible${index}`);
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Blur() {}",
    "function Holder() {}",
    "Holder.prototype.make = function(item) { switch (item.type) { case 'inner': return new Inner(); case 'blur': return new Blur(); } };",
    `Holder.prototype.load = function(payload) { ${possibleFields.map(field => `this.${field} = this.make(payload.${field});`).join(" ")} this.exact = this.make({ type: 'inner' }); };`,
  ].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Inner" } }], ownerSeedTypes: ["Inner"], ownerRepositories: [{ id: "repo", root }] });
  const owners = result.ownerChains[0];
  assert.equal(owners.truncated, false);
  assert.deepEqual(owners.chains.flatMap(row => row.chain).filter(step => step.owner === "Holder").map(step => step.field), ["exact"]);
  assert.deepEqual(owners.unresolved.filter(row => row.reason === "factory-return-not-narrowed").map(row => row.field).sort(), possibleFields.sort());
});

test("local literal domains select direct, nested, and conditional factory arguments", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-factory-same-type-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Glow() {}",
    "function Holder() {}",
    "Holder.prototype.make = function(item) { switch (item.type) { case 'inner': return new Inner(); case 'other': return new Glow(); } };",
    "Holder.prototype.inner = function() { this.slot = this.make({ type: 'inner' }); };",
    "Holder.prototype.nested = function() { const payload = { custom: { type: 'other' } }; this.otherSlot = this.make(payload.custom); };",
    "Holder.prototype.both = function(flag) { const payload = flag ? { type: 'inner' } : { type: 'other' }; this.bothSlot = this.make(payload); };"
  ].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Inner Glow" } }], ownerSeedTypes: ["Inner", "Glow"] });
  const inner = result.ownerChains.find(row => row.seed === "Inner").chains.flatMap(row => row.chain).filter(row => row.owner === "Holder").map(row => row.field).sort();
  const glow = result.ownerChains.find(row => row.seed === "Glow").chains.flatMap(row => row.chain).filter(row => row.owner === "Holder").map(row => row.field).sort();
  assert.deepEqual(inner, ["slot"]);
  assert.deepEqual(glow, ["otherSlot"]);
  for (const seed of ["Inner", "Glow"]) assert.ok(result.ownerChains.find(row => row.seed === seed).unresolved.some(row => row.reason === "factory-return-not-narrowed" && row.field === "bothSlot"));
});

test("mutation, dynamic object shape, and non-linear calls keep the raw factory return set", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-factory-domain-fallback-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Glow() {}",
    "function Holder() {}",
    "Holder.prototype.make = function(item) { switch (item.type) { case 'inner': return new Inner(); case 'glow': return new Glow(); } };",
    "Holder.prototype.load = function(flag, runtime) {",
    "  const changed = { type: 'inner' }; changed.type = 'glow'; this.changed = this.make(changed);",
    "  const spread = { type: 'inner', ...runtime }; this.spread = this.make(spread);",
    "  const nested = { type: 'inner' }; if (flag) nested.type = 'glow'; this.branch = this.make(nested);",
    "  const escaped = { type: 'inner' }; touch(escaped); this.escaped = this.make(escaped);",
    "  this.late = this.make(later); const later = { type: 'inner' };",
    "  const computed = { ['type']: 'inner' }; this.computed = this.make(computed);",
    "  const original = { type: 'inner' }; const alias = original; this.alias = this.make(alias);",
    "}"
  ].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Inner Glow" } }], ownerSeedTypes: ["Inner", "Glow"] });
  for (const seed of ["Inner", "Glow"]) {
    const owner = result.ownerChains.find(row => row.seed === seed);
    assert.equal(owner.chains.flatMap(row => row.chain).some(row => row.owner === "Holder"), false);
    const fields = owner.unresolved.filter(row => row.reason === "factory-return-not-narrowed").map(row => row.field).sort();
    assert.deepEqual(fields, ["alias", "branch", "changed", "computed", "escaped", "late", "spread"]);
  }
});

test("factory relations with distinct proven domains are not deduplicated", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-factory-domain-dedup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Glow() {}",
    "function Holder() {}",
    "Holder.prototype.make = function(item) { switch (item.type) { case 'inner': return new Inner(); case 'glow': return new Glow(); } };",
    "Holder.prototype.load = function() { this.slot = this.make({ type: 'inner' }); this.slot = this.make({ type: 'glow' }); }"
  ].join("\n"));
  const domains = analyzeFile(file).result.relations.filter(item => item.field === "slot" && item.callableProof?.argumentDomains).map(item => item.callableProof.argumentDomains[0].values[0]).sort();
  assert.deepEqual(domains, ["glow", "inner"]);
});

test("unsupported factory selectors preserve the analyzer-emitted return set", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-factory-fallback-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scenarios = [
    ["dynamic", "payload[key]", "switch (item.type) { case 'inner': return new Inner(); case 'glow': return new Glow(); }"],
    ["mismatch", "payload['other']", "switch (item.type) { case 'inner': return new Inner(); case 'glow': return new Glow(); }"],
    ["discriminator", "payload['inner']", "switch (item) { case 'inner': return new Inner(); case 'glow': return new Glow(); }"],
    ["case", "payload['inner']", "switch (item.type) { case 1: return new Inner(); case 'glow': return new Glow(); }"],
    ["branch", "payload['glow']", "switch (item.type) { case 'inner': if (payload) mark(); return new Inner(); case 'glow': return new Glow(); }"],
    ["fallthrough", "payload['inner']", "switch (item.type) { case 'inner': mark(); case 'glow': return new Glow(); }"]
  ];
  for (const [name, argument, body] of scenarios) {
    const file = path.join(root, `${name}.js`);
    fs.writeFileSync(file, [
      "function Inner() {}",
      "function Glow() {}",
      "function Holder() {}",
      `Holder.prototype.make = function(item) { ${body} };`,
      `Holder.prototype.load = function(payload, key) { this.slot = this.make(${argument}); }`
    ].join("\n"));
    const summary = analyzeFile(file).result.methodSummaries.find(row => row.owner === "Holder" && row.method === "make");
    const expected = summary.possibleReturnTypes.map(row => row.type).sort();
    const result = await runAstBatch({ queries: [{ id: name, command: "find", file, options: { terms: "Inner Glow" } }], ownerSeedTypes: ["Inner", "Glow"] });
    const actual = result.ownerChains.filter(row => row.unresolved.some(item => item.reason === "factory-return-not-narrowed")).map(row => row.seed).sort();
    assert.deepEqual(actual, expected, name);
    if (!["dynamic", "mismatch"].includes(name)) assert.equal(summary.possibleReturnTypes.some(row => row.type === "Inner" && row.selector), false, name);
  }
});

test("an exact factory return confirms storage without a possible-return branch", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-factory-exact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Holder() {}",
    "Holder.prototype.make = function() { var value = new Inner(); return value; };",
    "Holder.prototype.load = function(input) { this.inner = this.make(input); };",
  ].join("\n"));
  const summary = analyzeFile(file).result.methodSummaries.find(row => row.owner === "Holder" && row.method === "make");
  assert.equal(summary.returnType, "Inner");
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Inner" } }], ownerSeedTypes: ["Inner"] });
  const step = result.ownerChains[0].chains.flatMap(row => row.chain).find(row => row.owner === "Holder" && row.field === "inner");
  assert.equal(step.targetConfidence, "exact");
  assert.equal(step.type, "Inner");
  assert.equal(step.targetProof.confidence, "exact");
  assert.match(step.targetProof.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(result.ownerChains[0].unresolved.some(row => row.field === "inner"), false);
});

test("a factory called through a candidate receiver is not promoted", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-factory-candidate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Holder() {}",
    "Holder.prototype.make = function() { return new Inner(); };",
    "function Root(flag) { const maybe = flag ? new Holder() : this.other; this.inner = maybe.make(); }"
  ].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", file, options: { terms: "Inner" } }], ownerSeedTypes: ["Inner"] });
  const steps = result.ownerChains[0].chains.flatMap(row => row.chain).filter(row => row.field === "inner");
  assert.equal(steps.some(row => row.targetConfidence === "exact-possible"), false);
});

test("an imported constructor alias connects a factory return to its canonical owner seed", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-imported-alias-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const types = path.join(root, "types.js");
  const format = path.join(root, "format.js");
  fs.writeFileSync(types, "export function CInnerShadow() {}\n");
  fs.writeFileSync(format, [
    "import { CInnerShadow } from './types.js';",
    "window.AscFormat.CInnerShadow = CInnerShadow;",
    "window.AscFormat.CInnerShdw = CInnerShadow;",
    "function Factory() {}",
    "Factory.prototype.make = function() { return new AscFormat.CInnerShdw(); };",
    "Factory.prototype.load = function(value) { this.innerShdw = this.make(value); };",
  ].join("\n"));
  const aliases = analyzeFile(format).result.typeAliases;
  assert.deepEqual(aliases.map(item => [item.aliasQualifiedName, item.targetQualifiedName]), [
    ["AscFormat.CInnerShadow", "CInnerShadow"],
    ["AscFormat.CInnerShdw", "CInnerShadow"],
  ]);
  assert.ok(aliases.every(item => item.proof.confidence === "exact" && item.proof.file === format));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", files: [types, format], options: { terms: "CInnerShadow" } }], ownerSeedTypes: ["CInnerShadow"], ownerRepositories: [{ id: "repo", root }], ownerSeedScopes: [{ seed: "CInnerShadow", repository: "repo" }] });
  const step = result.ownerChains[0].chains.flatMap(row => row.chain).find(row => row.owner === "Factory" && row.field === "innerShdw");
  assert.equal(step.targetConfidence, "exact");
  assert.equal(step.type, "AscFormat.CInnerShdw");
  assert.equal(step.targetProof.confidence, "exact");
  assert.ok(step.evidence.length > 0);
  assert.equal(result.ownerChains[0].unresolved.some(row => row.field === "innerShdw"), false);
});

test("type aliases exclude computed members, calls, and merely similar names", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-alias-negatives-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.js");
  fs.writeFileSync(file, [
    "function CInnerShadow() {}",
    "function CInnerShdw() {}",
    "window['AscFormat'].Computed = CInnerShadow;",
    "window.AscFormat.Called = build();",
    "function outer() { function Hidden() {} }",
    "window.AscFormat.Hidden = Hidden;",
    "if (true) { class BlockHidden {} }",
    "window.AscFormat.BlockHidden = BlockHidden;",
  ].join("\n"));
  assert.deepEqual(analyzeFile(file).result.typeAliases, []);
  const chains = buildChains([{ ownerQualifiedName: "Holder", targetQualifiedName: "CInnerShdw", field: "value", relation: "field-write" }], "CInnerShadow", { typeAliases: [] });
  assert.equal(chains.chains[0].status, "not-found");
});

test("an alias outside the selected repository does not change its owner chain", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-alias-scope-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = path.join(root, "first"), second = path.join(root, "second");
  fs.mkdirSync(first); fs.mkdirSync(second);
  const use = path.join(first, "use.js"), aliases = path.join(second, "aliases.js");
  fs.writeFileSync(use, [
    "function CInnerShadow() {}",
    "function Factory() {}",
    "Factory.prototype.make = function() { return new AscFormat.CInnerShdw(); };",
    "Factory.prototype.load = function() { this.innerShdw = this.make(); };",
  ].join("\n"));
  fs.writeFileSync(aliases, ["function CInnerShadow() {}", "window.AscFormat.CInnerShdw = CInnerShadow;"].join("\n"));
  const result = await runAstBatch({ queries: [{ id: "find", command: "find", files: [use, aliases], options: { terms: "CInnerShadow" } }], ownerSeedTypes: ["CInnerShadow"], ownerRepositories: [{ id: "first", root: first }, { id: "second", root: second }], ownerSeedScopes: [{ seed: "CInnerShadow", repository: "first" }] });
  assert.equal(result.ownerChains.length, 1);
  assert.equal(result.ownerChains[0].chains[0].status, "not-found");
});
