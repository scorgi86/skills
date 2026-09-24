"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { evaluateStage1Coverage } = require("../src/stage1_coverage_gate");
const { buildStage1Summary } = require("../src/summary.js");
const { gitNexusInvocation } = require("../src/context/gitnexus.js");
const { runStage1 } = require("../src/runner.js");
const { writeCanonicalTransition } = require("../../../shared/dto/tests/test_helpers");

function fixtureSet() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage1-runtime-"));
  const source = path.join(directory, "component.js");
  const transition = writeCanonicalTransition(directory, 0);
  fs.writeFileSync(source, [
    "function FeatureValue() {}",
    "function FeatureCollection() { this.value = null; }",
    "function FeatureContainer() { this.featureState = new FeatureCollection(); }",
    "FeatureContainer.prototype.setFeatureState = function(value) { this.featureState = value; };",
  ].join("\n"));
  return { directory, source, transition };
}

function request(set) {
  return {
    stage: 1,
    transitionArtifact: set.transition,
    sourceRoot: set.directory,
    maxOutputBytes: 64 * 1024,
    budgets: { summaryBytes: 8 * 1024 },
    ast: { queries: [{ id: "owners", command: "find", file: set.source, options: { terms: "FeatureValue,value,featureState" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 10 }] },
    evidence: { checks: [{ id: "owners", file: set.source, pattern: { value: "FeatureValue|value|featureState", regex: true }, maxMatches: 10, maxGroups: 10 }] },
    ownership: { expectedIds: ["model", "container", "owner"], groups: [
      { id: "model", order: "1", role: "model", object: "FeatureValue", relation: "defines", evidenceRefs: ["owners"] },
      { id: "container", order: "2", role: "container", object: "FeatureCollection.value", relation: "contains", evidenceRefs: ["owners"] },
      { id: "owner", order: "3", role: "owner", object: "FeatureContainer.featureState", relation: "owns", evidenceRefs: ["owners"] },
    ] },
    coverageContract: {
      categories: [
        { id: "direct-model", status: "applicable", groupIds: ["model"] },
        { id: "container", status: "applicable", groupIds: ["container"] },
        { id: "owner-branches", status: "applicable", groupIds: ["owner"] },
        { id: "serialization", status: "not-applicable", reason: "fixture has no serializer" },
        { id: "history-copy", status: "open", reason: "deferred to a later scenario stage" },
        { id: "index-limitations", status: "not-applicable", reason: "fixture graph is supplied by test double" },
      ],
      baseline: { ownershipIds: ["model", "container", "owner"] },
    },
  };
}

function graph() {
  return { status: "candidate", requests: [{ seed: "FeatureValue", status: "candidate" }], context: { seed: "FeatureValue", candidateCount: 1, symbol: { name: "FeatureValue", filePath: "component.js", startLine: 1 } } };
}

test("stage 1 runner builds bounded facts and parses each file once", async () => {
  const set = fixtureSet();
  const facts = await runStage1(request(set), { runGitNexusContext: graph });
  assert.equal(facts.stage, 1);
  assert.equal(facts.quality.coverageGate.ok, true, facts.quality.coverageGate.errors.join("; "));
  assert.ok(Object.values(facts.ast.stats.parseCounts).every((count) => count === 1));
  assert.equal(facts.gitnexus.requests.length, 1);
  assert.equal(facts.ownership.groups.length, 3);
  assert.equal(facts.ownership.groups.every((item) => item.anchor && item.anchor.file), true);
  const summary = buildStage1Summary(facts, "facts.json");
  assert.equal(summary.output.bounded, true);
  assert.ok(summary.output.bytes <= 8 * 1024);
  assert.equal(facts.coverageContract.categories.length, 6);
});

test("stage 1 budgets canonical facts instead of retained source evidence", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  fs.writeFileSync(set.source, Array.from({ length: 300 }, (_, index) => `const FeatureValue${index} = FeatureValue; // retained evidence ${"x".repeat(48)}`).join("\n"));
  const data = request(set);
  data.budgets.factsBytes = 8 * 1024;
  data.evidence.checks[0].pattern = "FeatureValue";
  data.evidence.checks[0].maxMatches = 300;
  for (const group of data.ownership.groups) group.evidenceRefs = [];
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.ok(facts.sourceEvidence.checks[0].fullMatches.length >= 300);
  assert.equal(facts.output.autoRaised, false);
  assert.equal(facts.quality.coverageGate.errors.includes("Facts budget was exceeded"), false);
  assert.ok(facts.canonicalEvidence.length >= 300);
});

test("automatic owner summary stays bounded without dropping complete facts", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  const facts = await runStage1(request(set), { runGitNexusContext: graph });
  facts.ownerDiscovery = { generatedIds: Array.from({ length: 50 }, (_, i) => `owner-${i}`), unresolved: [], reviewDigest: "a".repeat(64) };
  facts.ownership.groups.push(...facts.ownerDiscovery.generatedIds.map(id => ({ id, order: 1, role: "owner", object: id, relation: "stores", anchor: { file: set.source, line: 1 } })));
  facts.quality.coverageGate.errors = facts.ownerDiscovery.generatedIds.map(id => `owner-branches: generated group ${id} was not reviewed`);
  const before = JSON.stringify(facts);
  const summary = buildStage1Summary(facts, "facts.json");
  assert.equal(summary.output.overflow, false);
  assert.ok(summary.output.bytes <= 8 * 1024);
  assert.equal(JSON.stringify(facts), before);
  assert.equal(facts.ownership.groups.length, 53);
  assert.equal(facts.quality.coverageGate.errors.length, 50);
});

test("opt-in Stage 1 discovers owner candidates but keeps unreviewed branches open", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  fs.writeFileSync(set.source, fs.readFileSync(set.source, "utf8").replace("this.value = null", "this.value = new FeatureValue()"));
  const value = request(set);
  value.searchFromStage0 = true;
  value.repositoryScope = { repositories: [{ id: "fixture", root: set.directory }] };
  value.budgets.factsBytes = 5 * 1024 * 1024;
  value.ownership = { autoCandidates: true, expectedIds: ["model"], groups: [
    { id: "model", order: 0, role: "model", object: "FeatureValue", relation: "defines", anchor: { file: set.source, line: 1 } }
  ] };
  value.coverageContract = { categories: [
    { id: "direct-model", status: "applicable", groupIds: ["model"], requiredBeforeClose: true },
    { id: "owner-branches", status: "open", reason: "review pending", requiredBeforeClose: true }
  ] };
  const facts = await runStage1(value, { runGitNexusContext: graph });
  assert.ok(facts.ownershipGraph.edges.length > 0);
  assert.ok(facts.ownership.groups.length > 1);
  assert.match(facts.ownerDiscovery.reviewDigest, /^[a-f0-9]{64}$/);
  assert.equal(facts.status, "partial");
  assert.ok(facts.quality.coverageGate.errors.some(error => error.includes("owner-branches")));
});

test("exact owner discovery closes owner branches without a manual retry", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  fs.writeFileSync(set.source, "function FeatureValue() {}\nfunction Holder() { this.value = new FeatureValue(); }\n");
  const value = request(set);
  value.searchFromStage0 = true;
  value.repositoryScope = { repositories: [{ id: "fixture", root: set.directory }] };
  value.ownership = { autoCandidates: true, expectedIds: ["model"], groups: [
    { id: "model", order: 0, role: "model", object: "FeatureValue", relation: "defines", anchor: { file: set.source, line: 1 } }
  ] };
  value.coverageContract = { categories: [
    { id: "direct-model", status: "applicable", groupIds: ["model"], requiredBeforeClose: true },
    { id: "owner-branches", status: "open", reason: "review pending", requiredBeforeClose: true }
  ] };
  const facts = await runStage1(value, { runGitNexusContext: graph });
  const ownerCategory = facts.coverageContract.categories.find(category => category.id === "owner-branches");
  const generated = facts.ownership.groups.filter(group => group.id.startsWith("owner-"));
  assert.equal(facts.ownerDiscovery.unresolved.length, 0);
  assert.equal(facts.quality.coverageGate.ok, true, facts.quality.coverageGate.errors.join("; "));
  assert.equal(ownerCategory.status, "applicable");
  assert.deepEqual(ownerCategory.groupIds, facts.ownerDiscovery.generatedIds);
  assert.equal(ownerCategory.reviewDigest, facts.ownerDiscovery.reviewDigest);
  assert.ok(generated.every(group => group.status === "confirmed" && group.confirmation?.status === "source-confirmed" && group.evidenceRefs.length === 1));
  assert.ok(generated.every(group => facts.canonicalEvidence.find(row => row.id === group.evidenceRefs[0])?.confirmation?.status === "source-confirmed"));
});

test("reviewed owner candidates close only against the same source snapshot", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  fs.writeFileSync(set.source, "function FeatureValue() {}\nfunction Holder() { this.value = new FeatureValue(); }\n");
  const value = request(set);
  value.searchFromStage0 = true;
  value.repositoryScope = { repositories: [{ id: "fixture", root: set.directory }] };
  value.budgets.factsBytes = 5 * 1024 * 1024;
  value.ownership = { autoCandidates: true, expectedIds: ["model"], groups: [
    { id: "model", order: 0, role: "model", object: "FeatureValue", relation: "defines", anchor: { file: set.source, line: 1 } }
  ] };
  value.coverageContract = { categories: [
    { id: "direct-model", status: "applicable", groupIds: ["model"], requiredBeforeClose: true },
    { id: "owner-branches", status: "open", reason: "review pending", requiredBeforeClose: true }
  ] };
  const first = await runStage1(value, { runGitNexusContext: graph });
  assert.equal(first.ownerDiscovery.unresolved.length, 0);
  assert.equal(first.ownershipGraph.edges.length, 1);
  const ownerCategory = value.coverageContract.categories[1];
  ownerCategory.status = "applicable";
  ownerCategory.groupIds = first.ownerDiscovery.generatedIds;
  ownerCategory.reviewDigest = first.ownerDiscovery.reviewDigest;
  const reviewed = await runStage1(value, { runGitNexusContext: graph });
  assert.equal(reviewed.quality.coverageGate.ok, true, reviewed.quality.coverageGate.errors.join("; "));
  fs.appendFileSync(set.source, "// changed source\n");
  const stale = await runStage1(value, { runGitNexusContext: graph });
  assert.equal(stale.quality.coverageGate.ok, false);
  assert.match(stale.quality.coverageGate.errors.join("; "), /review digest is missing or stale/);
});

test("owner seed anchor limits candidates to its repository", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  const firstRepo = path.join(set.directory, "first");
  fs.mkdirSync(firstRepo);
  const firstFile = path.join(firstRepo, "component.js");
  const other = path.join(set.directory, "other");
  fs.mkdirSync(other);
  const otherFile = path.join(other, "component.js");
  fs.writeFileSync(firstFile, "function FeatureValue() {}\nfunction A() { this.value = new FeatureValue(); }\n");
  fs.writeFileSync(otherFile, "function FeatureValue() {}\nfunction B() { this.value = new FeatureValue(); }\n");
  const value = request(set);
  value.searchFromStage0 = true;
  value.repositoryScope = { repositories: [{ id: "a", root: firstRepo }, { id: "b", root: other }] };
  value.ast.queries[0].files = [firstFile, otherFile];
  delete value.ast.queries[0].file;
  value.ownership = { autoCandidates: true, expectedIds: ["model"], groups: [{ id: "model", order: 0, object: "FeatureValue", relation: "defines", anchor: { file: firstFile, line: 1 } }] };
  value.coverageContract = { categories: [{ id: "owner-branches", status: "open", reason: "review pending", requiredBeforeClose: true }] };
  const facts = await runStage1(value, { runGitNexusContext: graph });
  assert.ok(facts.ownership.groups.some(group => group.object === "A.value"));
  assert.equal(facts.ownership.groups.some(group => group.object === "B.value"), false);
});

test("automatic Stage 1 search stays partial when its source check is incomplete", async () => {
  const set = fixtureSet();
  const data = request(set);
  data.searchFromStage0 = true;
  data.evidence = { checks: [{ id: "stage0-seeds-fixture", file: set.source, pattern: "FeatureValue" }] };
  for (const group of data.ownership.groups) group.anchor = { file: set.source, line: 1 };
  const facts = await runStage1(data, {
    runGitNexusContext: graph,
    runEvidenceChecks: () => ({ checks: [{ id: "stage0-seeds-fixture", status: "partial", resultComplete: false, filesScanned: 0, errors: [{ code: "source-read" }] }] }),
    deferCanonicalization: true,
  });
  assert.equal(facts.quality.coverageGate.ok, true);
  assert.equal(facts.status, "partial");
});

test("empty auto-bootstrap uses one declared bootstrap seed from the Stage 0 dictionary", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  fs.writeFileSync(set.source, "function CInnerShadow() {}\nfunction CInnerShadowProperty() {}\nfunction Holder() { this.innerShdw = new CInnerShadow(); }\n");
  const repositoryScope = { repositories: [{ id: "fixture", root: set.directory }] };
  set.transition = writeCanonicalTransition(set.directory, 0, { facts: { repositoryScope, summary: { seeds: ["CInnerShadow", "CInnerShadowProperty", "innerShdw"] } } });
  const data = request(set);
  data.searchFromStage0 = true;
  data.repositoryScope = repositoryScope;
  data.ast.queries[0].options.terms = "CInnerShadow,CInnerShadowProperty,innerShdw";
  data.ownership = { bootstrapSeed: "CInnerShadow" };
  delete data.coverageContract;
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.summary.bootstrap.status, "selected");
  assert.equal(facts.summary.bootstrap.group.object, "CInnerShadow");
  assert.equal(facts.ownerDiscovery.generatedIds.length, 1);
  assert.equal(facts.ownership.groups.find(group=>group.role==="seed").status,"confirmed");
  assert.equal(facts.capabilities.find(row=>row.id==="definition").status,"confirmed");
  assert.equal(facts.capabilities.find(row=>row.id==="ownership").status,"confirmed");
});

test("diagnostic factory returns do not block a confirmed bootstrap ownership path", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  fs.writeFileSync(set.source, [
    "function Inner() {}",
    "function Blur() {}",
    "function Holder() {}",
    "Holder.prototype.make = function(item) { switch (item.type) { case 'inner': return new Inner(); case 'blur': return new Blur(); } };",
    "Holder.prototype.load = function(payload) { this.possible = this.make(payload.slot); this.exact = this.make({ type: 'inner' }); };",
  ].join("\n"));
  const repositoryScope = { repositories: [{ id: "fixture", root: set.directory }] };
  set.transition = writeCanonicalTransition(set.directory, 0, { facts: { repositoryScope, summary: { seeds: ["Inner"] } } });
  const data = request(set);
  data.transitionArtifact = set.transition;
  data.searchFromStage0 = true;
  data.repositoryScope = repositoryScope;
  data.ast.queries[0].options.terms = "Inner";
  data.ownership = { bootstrapSeed: "Inner" };
  delete data.coverageContract;
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.status, "closed", facts.quality.coverageGate.errors.join("; "));
  assert.equal(facts.quality.coverageGate.ok, true, facts.quality.coverageGate.errors.join("; "));
  assert.ok(facts.ownerDiscovery.unresolved.some(row => row.reason === "factory-return-not-narrowed" && row.field === "possible"));
  const exact = facts.ownership.groups.find(group => group.object === "Holder.exact");
  assert.equal(exact?.status, "confirmed");

  const candidate = structuredClone(facts);
  candidate.ownership.groups.find(group => group.id === exact.id).status = "candidate";
  const candidateGate = evaluateStage1Coverage(candidate);
  assert.equal(candidateGate.ok, false);
  assert.match(candidateGate.errors.join("\n"), /generated group .* is not confirmed/);

  for (const reason of ["truncated", "missing-source-anchor"]) {
    const blocked = structuredClone(facts);
    blocked.ownerDiscovery.unresolved = [{ reason, seed: "Inner" }];
    const gate = evaluateStage1Coverage(blocked);
    assert.equal(gate.ok, false);
    assert.match(gate.errors.join("\n"), /unresolved candidate paths remain/);
  }
});

test("bootstrapSeed rejects invalid, undeclared, and non-empty ownership modes", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  const repositoryScope = { repositories: [{ id: "fixture", root: set.directory }] };
  set.transition = writeCanonicalTransition(set.directory, 0, { facts: { repositoryScope, summary: { seeds: ["FeatureValue"] } } });
  const base = request(set);
  base.searchFromStage0 = true;
  base.repositoryScope = repositoryScope;
  base.ownership = {};
  delete base.coverageContract;
  for (const bootstrapSeed of ["", 1, "Missing"]) {
    await assert.rejects(runStage1({ ...base, ownership: { bootstrapSeed } }, { runGitNexusContext: graph }), /bootstrapSeed|Stage 0/i);
  }
  const manual = request(set);
  manual.searchFromStage0 = true;
  manual.repositoryScope = repositoryScope;
  manual.ownership.bootstrapSeed = "FeatureValue";
  await assert.rejects(runStage1(manual, { runGitNexusContext: graph }), /bootstrapSeed|auto-bootstrap/i);
});

test("prepared automatic ownership rejects manual producer capabilities", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  const data = request(set);
  data.searchFromStage0 = true;
  data.ownership.autoCandidates = true;
  data.capabilities = [{ id: "ownership", status: "confirmed", evidenceRefs: ["manual"] }];
  await assert.rejects(runStage1(data, { runAstBatch() { throw new Error("REACHED_AST"); }, runGitNexusContext: graph }), /capabilities|conflict/i);
});

test("stage 1 retains declared generic boundary candidates for later stages", async () => {
  const set = fixtureSet();
  const data = request(set);
  data.boundaries = [{ id: "fixture-bridge", producerRepo: "engine", kind: "setter", symbol: "setEffectPr", relation: "sets effect property", evidenceRefs: ["owners"], ownershipRefs: ["owner"], consumerRepos: ["client"], searchTerms: ["applyEffectPr"] }];
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.boundaries.length, 1);
  assert.equal(facts.boundaries[0].status, "candidate");
  assert.equal(facts.quality.coverageGate.ok, true, facts.quality.coverageGate.errors.join("; "));
});

test("stage 1 gate rejects an unconfirmed promotion", async () => {
  const set = fixtureSet();
  const facts = await runStage1(request(set), { runGitNexusContext: graph });
  facts.ownership.groups[0].status = "confirmed";
  const gate = evaluateStage1Coverage(facts);
  assert.equal(gate.ok, false);
  assert.match(gate.errors.join("\n"), /confirmation record/);
});

test("stage 1 gate requires declared ownership branches", async () => {
  const set = fixtureSet();
  const data = request(set);
  data.ownership.expectedIds.push("additional-owner");
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, false);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /additional-owner: expected ownership group is missing/);
});

test("stage 1 gate requires an ownership expectation set", async () => {
  const set = fixtureSet();
  const data = request(set);
  delete data.ownership.expectedIds;
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, false);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /must declare expected ownership ids/);
});

test("stage 1 gate enforces generic categories and baseline preservation", async () => {
  const set = fixtureSet();
  const data = request(set);
  data.coverageContract.categories[0].groupIds = ["missing-model"];
  data.coverageContract.baseline.ownershipIds.push("removed-owner");
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, false);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /direct-model: declared group missing-model is missing/);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /removed-owner: baseline ownership group is missing/);
});

test("stage 1 gate blocks an open category required before close", async () => {
  const set = fixtureSet();
  const data = request(set);
  const category = data.coverageContract.categories.find((item) => item.id === "history-copy");
  category.requiredBeforeClose = true;
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, false);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /history-copy: required-before-close coverage category remains open/);
  category.status = "not-applicable";
  const closed = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(closed.quality.coverageGate.ok, true, closed.quality.coverageGate.errors.join("; "));
});

test("stage 1 claim ledger requires declared groups and observations", async () => {
  const set = fixtureSet();
  const data = request(set);
  data.observations = [{ id: "cross-repo", status: "candidate-negative", scope: "fixture", result: "no exact seed matches" }];
  data.claimLedger = { required: true, claims: [
    { id: "model-claim", status: "confirmed", groupIds: ["model"] },
    { id: "cross-repo-claim", status: "candidate-negative", observationIds: ["cross-repo"] },
  ] };
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, true, facts.quality.coverageGate.errors.join("; "));
  facts.claimLedger.claims[0].groupIds = ["missing"];
  const gate = evaluateStage1Coverage(facts);
  assert.equal(gate.ok, false);
  assert.match(gate.errors.join("\n"), /model-claim: claimed ownership group missing is missing/);
});

test("confirmed ownership uses and enforces its confirmation anchor", async () => {
  const set = fixtureSet();
  const data = request(set);
  data.ownership.groups[1].status = "confirmed";
  data.ownership.groups[1].confirmation = { method: "manual-read", file: "component.js", line: 2 };
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.deepEqual(facts.ownership.groups[1].anchor, { file: "component.js", line: 2 });
  assert.match(facts.ownership.groups[1].confirmation.freshness.fragmentHash, /^[a-f0-9]{64}$/);
  assert.equal(facts.quality.coverageGate.ok, true, facts.quality.coverageGate.errors.join("; "));
  facts.ownership.groups[1].anchor = { file: "component.js", line: 3 };
  const gate = evaluateStage1Coverage(facts);
  assert.equal(gate.ok, false);
  assert.match(gate.errors.join("\n"), /anchor must match confirmation/);
});

test("confirmation freshness reuses one source read for multiple anchors", async () => {
  const set = fixtureSet();
  const data = request(set);
  data.ownership.groups[0].status = "confirmed";
  data.ownership.groups[0].confirmation = { method: "manual-read", file: "component.js", line: 1 };
  data.ownership.groups[1].status = "confirmed";
  data.ownership.groups[1].confirmation = { method: "manual-read", file: "component.js", line: 2 };
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (...args) {
    if (path.resolve(args[0]) === set.source) reads += 1;
    return original.apply(this, args);
  };
  try {
    await runStage1(data, { runGitNexusContext: graph });
    assert.equal(reads, 3, "one AST read, one source-evidence read, and one shared freshness read");
  } finally {
    fs.readFileSync = original;
  }
});

test("GitNexus invocation supports local run.cjs and rejects unresolved shell shims", () => {
  const local = gitNexusInvocation({ runnerPath: path.join(os.tmpdir(), "graph-runner.cjs"), repo: "repository-a", file: "a.js", seed: "FeatureValue", limit: 5 });
  assert.equal(local.command, process.execPath);
  assert.deepEqual(local.args.slice(1, 5), ["context", "--repo", "repository-a", "--file"]);
  assert.throws(() => gitNexusInvocation({ command: path.join(os.tmpdir(), "unresolved-gitnexus.cmd"), seed: "FeatureValue" }), /configure runnerPath/);
});

test("stage 1 CLI emits only bounded summary when facts artifact is retained", () => {
  const set = fixtureSet();
  const requestFile = path.join(set.directory, "request.json");
  const factsFile = path.join(set.directory, "facts.json");
  fs.writeFileSync(requestFile, JSON.stringify(request(set)));
  const completed = spawnSync(process.execPath, [path.resolve(require("node:path").resolve(__dirname, "../../.."), "cli/src/commands/stage1_runner.js"), "--request", requestFile, "--output", factsFile, "--stdout", "summary"], { encoding: "utf8" });
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  const summary = JSON.parse(completed.stdout);
  assert.equal(summary.artifact, factsFile);
  assert.ok(Buffer.byteLength(completed.stdout) <= 8 * 1024);
  assert.equal(JSON.parse(fs.readFileSync(factsFile, "utf8")).stage, 1);
});

test("ownerDiscovery skip closes bootstrap-only Stage 1 without discovery", async t => {
  const set = fixtureSet();
  t.after(() => fs.rmSync(set.directory, { recursive: true, force: true }));
  fs.writeFileSync(set.source, "function CInnerShadow() {}\nfunction CInnerShadowProperty() {}\nfunction Holder() { this.innerShdw = new CInnerShadow(); }\n");
  const repositoryScope = { repositories: [{ id: "fixture", root: set.directory }] };
  set.transition = writeCanonicalTransition(set.directory, 0, { facts: { repositoryScope, summary: { seeds: ["CInnerShadow", "CInnerShadowProperty", "innerShdw"] } } });
  const data = request(set);
  data.searchFromStage0 = true;
  data.repositoryScope = repositoryScope;
  data.ast.queries[0].options.terms = "CInnerShadow,CInnerShadowProperty,innerShdw";
  data.ownership = { bootstrapSeed: "CInnerShadow", ownerDiscovery: "skip" };
  delete data.coverageContract;
  const facts = await runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.summary.bootstrap.status, "selected");
  assert.equal(facts.status, "closed");
  assert.equal(facts.ownerDiscovery, undefined);
  assert.equal(facts.ownership.groups.filter(group => group.id.startsWith("owner-")).length, 0);
  assert.equal(facts.capabilities.find(row => row.id === "definition").status, "confirmed");
  const ownerBranches = (facts.coverageContract.categories || []).find(category => category.id === "owner-branches");
  assert.equal(ownerBranches.status, "not-applicable");
  assert.ok((facts.limitations || []).some(row => /skipped by package/i.test(row.statement)));
});
