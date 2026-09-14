"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const crypto = require("node:crypto");
const { carryPlanningFacts, runStagePipeline } = require("../src/stage_pipeline.js");
const { main: runState } = require("../../../state/src/stage_state.js");
const { IDS } = require("../../../shared/dto/src/capability_contract.js");
const { writeStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { transitionFields } = require("../../../shared/dto/tests/test_helpers.js");
const { runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");

function fixture(t, full = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planning-output-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repositoryScope = { repositories: [{ id: "source", root, role: "source" }] };
  const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "output");
  runState(["init", "--state", stateFile]);
  const coverageProfile = full ? { kind: "full-inventory", requiredCapabilities: [...IDS], requiredCollections: ["scenarios", "criticalPaths"] } : { kind: "bounded", requiredCapabilities: ["definition"] };
  const request = { stage: 0, target: "Feature", repositoryScope, coverageProfile };
  return { root, repositoryScope, stateFile, outputRoot, request };
}

async function recipientFixture(t, earlierConfirmed = true) {
  const value = fixture(t), source = path.join(value.root, "receiver.js");
  const line = "Container.prototype.setValue = function(value) { this.value = value; };";
  const text = `${line}\n${line}\n`;
  fs.writeFileSync(source, text);
  const confirmation = { id: "receiver-proof", repository: "source", file: source, status: "source-confirmed",
    line: 1, endLine: 1, sourceFragment: line, sourceHash: crypto.createHash("sha256").update(text).digest("hex") };
  const artifacts = [];
  for (const stage of [0, 1, 2, 3]) {
    const result = await runStagePipeline({ ...value, request: { ...value.request, stage }, runner: () => ({ stage, status: "candidate",
      transition: { fields: transitionFields(stage) }, ...(stage === 2 ? { sourceEvidence: runEvidenceChecks({ retainAllMatches: true,
        checks: [{ id: "query-receiver", repository: "source", file: source, pattern: "setValue", ...(earlierConfirmed ? { confirmation } : {}) }] }) } : {}) }) });
    artifacts.push(result);
  }
  const bundle = JSON.parse(fs.readFileSync(artifacts[2].evidence));
  const first = bundle.evidence.find(row => row.range.startLine === 1);
  const candidate = bundle.evidence.find(row => row.range.startLine === 2);
  const family = { id: "receiver", receiver: "Container", relation: "setValue stores value", status: "confirmed",
    statement: "Container receives the mutation", result: "The supplied value is stored", evidenceRefs: [earlierConfirmed ? confirmation.id : first.id],
    checks: [{ id: "mutation", repository: "source", file: source, pattern: "setValue" }] };
  const request = { stage: 4, target: value.request.target, repositoryScope: value.repositoryScope, recipientFamilies: [family] };
  const saved = new Map([...artifacts.flatMap(row => [row.artifact, row.evidence, row.manifest]), value.stateFile].map(file => [file, fs.readFileSync(file)]));
  return { ...value, source, text, confirmation, first, candidate, family, request, saved };
}

test("BDD: Stage 4 retains lineage proof and aliases when the same source is searched again", async t => {
  const value = await recipientFixture(t);
  const result = await runStagePipeline(value);
  assert.equal(result.status, "closed");
  const received = JSON.parse(fs.readFileSync(result.artifact)).facts.find(row => row.id === value.family.id);
  for (const field of ["receiver", "relation", "statement", "result", "status"]) assert.equal(received[field], value.family[field]);
  assert.deepEqual(received.evidenceRefs, [value.first.id]);
  const proof = JSON.parse(fs.readFileSync(result.evidence)).evidence.find(row => row.id === value.first.id);
  assert.equal(proof.confirmation.status, "source-confirmed");
  for (const alias of ["receiver-proof", "query-receiver", "receiver/mutation"]) assert.ok(proof.aliases.includes(alias));
  assert.deepEqual(proof.aliases, [...new Set(proof.aliases)].sort());
  for (const [file, bytes] of value.saved) if (file !== value.stateFile) assert.deepEqual(fs.readFileSync(file), bytes);
});

for (const failure of ["empty", "unknown", "candidate", "mixed alias", "stale source", "invalid anchor"]) {
  test(`BDD: Stage 4 rejects ${failure} proof before publication and permits corrected retry`, async t => {
    const value = await recipientFixture(t);
    if (failure === "empty") value.family.evidenceRefs = [];
    if (failure === "unknown") value.family.evidenceRefs = ["unknown-proof"];
    if (failure === "candidate") value.family.evidenceRefs = [value.candidate.id];
    if (failure === "mixed alias") value.family.evidenceRefs = ["query-receiver"];
    if (failure === "stale source") fs.writeFileSync(value.source, value.text + "// changed\n");
    if (failure === "invalid anchor") value.family.checks[0].confirmation = { ...value.confirmation, sourceFragment: "wrong" };
    await assert.rejects(runStagePipeline(value), /evidenceRefs|Stale lineage evidence|source.*fragment|fragment.*mismatch/i);
    for (const [file, bytes] of value.saved) assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(fs.existsSync(path.join(value.outputRoot, "stage-4")), false);
    fs.writeFileSync(value.source, value.text);
    delete value.family.checks[0].confirmation;
    value.family.evidenceRefs = [value.confirmation.id];
    assert.equal((await runStagePipeline(value)).status, "closed");
  });
}

test("BDD: authored Stage 4 proof does not advance an incomplete search", async t => {
  const value = await recipientFixture(t);
  value.family.checks.push({ id: "unavailable", repository: "source", file: path.join(value.root, "missing.js"), pattern: "setValue" });
  const result = await runStagePipeline(value);
  assert.equal(result.status, "partial");
  assert.equal(JSON.parse(fs.readFileSync(result.artifact)).facts.find(row => row.id === value.family.id).status, "confirmed");
  for (const [file, bytes] of value.saved) assert.deepEqual(fs.readFileSync(file), bytes);
});

test("BDD: current exact proof upgrades an earlier candidate and retains its aliases", async t => {
  const value = await recipientFixture(t, false);
  value.family.checks[0].confirmation = value.confirmation;
  const result = await runStagePipeline(value);
  assert.equal(result.status, "closed");
  const proof = JSON.parse(fs.readFileSync(result.evidence)).evidence.find(row => row.id === value.first.id);
  assert.equal(proof.confirmation.status, "source-confirmed");
  for (const alias of ["query-receiver", "receiver-proof", "receiver/mutation"]) assert.ok(proof.aliases.includes(alias));
});

for (const earlierConfirmed of [false, true]) test(`BDD: equal-strength evidence keeps incoming content, confirmed=${earlierConfirmed}`, async t => {
  const value = await recipientFixture(t, earlierConfirmed);
  value.family.status = "candidate";
  if (earlierConfirmed) value.family.checks[0].confirmation = { ...value.confirmation, id: "current-proof" };
  const result = await runStagePipeline(value);
  const proof = JSON.parse(fs.readFileSync(result.evidence)).evidence.find(row => row.id === value.first.id);
  assert.ok(proof.aliases.includes("query-receiver"));
  assert.ok(proof.aliases.includes("receiver/mutation"));
  assert.ok(proof.provenance.some(item => item.includes("receiver/mutation")));
  assert.ok(proof.provenance.every(item => !item.includes("query-receiver")));
  assert.equal(proof.confirmation.status, earlierConfirmed ? "source-confirmed" : "candidate");
});

test("BDD: a fileless record cannot replace a source identity with the same ID", async t => {
  const value = await recipientFixture(t);
  await assert.rejects(runStagePipeline({ ...value, runner: () => ({ stage: 4, status: "candidate",
    transition: { fields: transitionFields(4) }, canonicalEvidence: [{ id: value.first.id, status: "candidate", aliases: ["spoof"] }] }) }), /Conflicting evidence identity/);
  for (const [file, bytes] of value.saved) assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(fs.existsSync(path.join(value.outputRoot, "stage-4")), false);
});

for (const [label, fields] of [
  ["array", { scenarios: [{ entry: "A" }, { entry: "B" }] }],
  ["ownership groups", { ownership: { groups: [{ object: "A" }, { object: "B" }] } }],
  ["canonical facts", { canonicalFacts: [{ kind: "scenario", entry: "A" }, { kind: "scenario", entry: "B" }] }]
]) test(`BDD: ${label} missing IDs fail before publication and permit corrected retry`, async t => {
  const value = fixture(t), before = fs.readFileSync(value.stateFile);
  await assert.rejects(runStagePipeline({ ...value, runner: () => ({ stage: 0, status: "candidate", ...fields }) }), /(?:scenarios|ownership).*id/);
  assert.deepEqual(fs.readFileSync(value.stateFile), before);
  assert.equal(fs.existsSync(path.join(value.outputRoot, "stage-0")), false);
  const result = await runStagePipeline({ ...value, runner: () => ({ stage: 0, status: "candidate", scenarios: [{ id: "s", status: "candidate" }] }) });
  assert.equal(result.status, "closed");
});

test("BDD: collection collisions and conflicting filled content cannot be merged away", () => {
  assert.throws(() => carryPlanningFacts({ scenarios: [{ id: "same", entry: "A" }] }, { stage: 0, scenarios: [{ id: "same", entry: "B" }] }), /scenarios.*same.*entry/);
  assert.throws(() => carryPlanningFacts({ scenarios: [{ id: "same" }], recipientFamilies: [{ id: "same" }] }, { stage: 0 }), /same.*id/);
});

test("BDD: canonical facts priority does not validate unused automatic collections", async t => {
  const value = fixture(t);
  const result = await runStagePipeline({ ...value, runner: () => ({ stage: 0, status: "candidate", ownership: { groups: [{ object: "unused" }] }, canonicalFacts: [{ kind: "scenario", id: "s", status: "candidate" }] }) });
  const facts = JSON.parse(fs.readFileSync(result.artifact)).facts;
  assert.equal(facts.filter(row => row.kind === "scenario").length, 1);
  assert.equal(facts.some(row => row.kind === "ownership"), false);
});

test("BDD: planning guards classify overridden kinds by the emitted fact", async t => {
  const value = fixture(t);
  const result = await runStagePipeline({ ...value, runner: () => ({ stage: 0, status: "candidate", scenarios: [
    { id: "only", kind: "noise", status: "candidate" },
    { kind: "unknown-kind", status: "candidate" }
  ] }) });
  const facts = JSON.parse(fs.readFileSync(result.artifact)).facts;
  assert.equal(facts.filter(row => row.kind === "noise" && row.id === "only").length, 1);
  assert.equal(facts.some(row => row.kind === "unknown-kind"), true);
  assert.throws(() => carryPlanningFacts({}, { stage: 0, scenarios: [{ kind: "noise" }] }), /noise.*id/);
  assert.throws(() => carryPlanningFacts({}, { stage: 0, scenarios: [{ id: "same", kind: "noise" }], noise: [{ id: "same", entry: "A" }, { id: "same", entry: "B" }] }), /noise.*entry/);
  assert.throws(() => carryPlanningFacts({}, { stage: 0, scenarios: [{ id: "same", kind: "noise" }], dictionary: [{ id: "same" }] }), /same.*id/);
});

test("BDD: stored report-model rows are not new planning inputs", async t => {
  const value = fixture(t);
  const report = { stage: 0, modelType: "inventory-report-model", status: "candidate", scenarios: [{ entry: "Stored report row" }] };
  const result = await runStagePipeline({ ...value, runner: () => report });
  const facts = JSON.parse(fs.readFileSync(result.artifact)).facts;
  assert.equal(facts.filter(row => row.kind === "report-model").length, 1);
  assert.equal(facts.some(row => row.kind === "scenario"), false);
  assert.throws(() => carryPlanningFacts({}, { ...report, canonicalFacts: [{ kind: "scenario" }] }), /scenarios.*id/);
});

test("BDD: legacy inherited corrections are carried without retrovalidating old claims", async t => {
  const value = fixture(t);
  const summary = { repositoryScope: value.repositoryScope, coverageProfile: value.request.coverageProfile, lineage: [] };
  const partial = writeStageArtifact({ outputDir: path.join(value.root, "legacy-partial"), facts: { stage: 0, status: "partial", repositoryScope: value.repositoryScope, openChecks: ["legacy-gap"], summary }, input: value.request });
  const canonical = JSON.parse(fs.readFileSync(partial.resultFile));
  const receipt = { kind: "check-resolution", check: "legacy-gap", originDigest: canonical.outputDigest, disposition: "corrected", correctionRef: "legacy", reason: "Legacy correction" };
  const closed = writeStageArtifact({ outputDir: path.join(value.root, "legacy-closed"), facts: {
    stage: 0, status: "closed", repositoryScope: value.repositoryScope, gaps: [{ id: "legacy", status: "confirmed", statement: "Legacy corrected gap" }], checkResolutions: [receipt],
    summary: { ...summary, checkHistory: [{ artifact: partial.resultFile, outputDigest: canonical.outputDigest }] }
  }, input: value.request });
  runState(["advance", "--state", value.stateFile, "--stage", "0", "--artifact", closed.resultFile]);
  const before = fs.readFileSync(closed.resultFile);
  const request = { stage: 1, target: "Feature", repositoryScope: value.repositoryScope };
  const result = await runStagePipeline({ ...value, request, runner: () => ({ stage: 1, status: "candidate" }) });
  assert.equal(result.status, "closed");
  assert.deepEqual(fs.readFileSync(closed.resultFile), before);
  assert.equal(JSON.parse(fs.readFileSync(result.artifact)).facts.some(row => row.id === "legacy"), true);
  await assert.rejects(runStagePipeline({ ...value, request: { ...request, stage: 2, gaps: [{ id: "legacy", status: "confirmed" }] }, runner: () => ({ stage: 2, status: "candidate" }) }), /gaps\[legacy\].evidenceRefs/);
});

function proofs(value) {
  const text = "const Feature = true;\n";
  fs.writeFileSync(path.join(value.root, "proof.js"), text);
  fs.writeFileSync(path.join(value.root, "candidate.js"), "const Candidate = false;\n");
  return [
    { id: "good", repository: "source", file: "proof.js", status: "source-confirmed", sourceHash: crypto.createHash("sha256").update(text).digest("hex"), line: 1, endLine: 1, sourceFragment: text.trim(), evidenceRefs: ["good"] },
    { id: "candidate", repository: "source", file: "candidate.js", status: "candidate", line: 1 }
  ];
}

for (const [label, fields, full, pattern] of [
  ["scenario content", { scenarios: [{ id: "bad", status: "confirmed", evidenceRefs: ["good"] }] }, true, /scenarios\[bad\].*entry\/steps\/result/],
  ["absence scenario content", { scenarios: [{ id: "bad", status: "checked-no-usage", evidenceRefs: [] }] }, true, /scenarios\[bad\].*entry\/steps\/result/],
  ["canonical scenario content", { canonicalFacts: [{ kind: "scenario", id: "bad", status: "confirmed", evidenceRefs: ["good"] }] }, true, /scenarios\[bad\].*entry\/steps\/result/],
  ["empty capability proofs", { capabilities: [{ id: "definition", status: "confirmed", evidenceRefs: [] }] }, false, /capabilities\[definition\].*evidenceRefs/],
  ["empty ownership proofs", { ownership: { groups: [{ id: "bad", status: "confirmed", evidenceRefs: [] }] } }, false, /ownership\[bad\].*evidenceRefs/],
  ["candidate proofs", { scenarios: [{ id: "bad", status: "confirmed", evidenceRefs: ["candidate"] }] }, false, /scenarios\[bad\].*evidenceRefs/],
  ["mixed proofs", { scenarios: [{ id: "bad", status: "confirmed", evidenceRefs: ["good", "candidate"] }] }, false, /scenarios\[bad\].*evidenceRefs/]
]) test(`BDD: ${label} fails at its stage without changing published predecessors`, async t => {
  const value = fixture(t, full);
  const first = await runStagePipeline({ ...value, runner: () => ({ stage: 0, status: "candidate", canonicalEvidence: proofs(value) }) });
  const saved = new Map([first.artifact, first.evidence, first.manifest, value.stateFile].map(file => [file, fs.readFileSync(file)]));
  const request = { stage: 1, target: "Feature", repositoryScope: value.repositoryScope };
  await assert.rejects(runStagePipeline({ ...value, request, runner: () => ({ stage: 1, status: "candidate", ...fields }) }), pattern);
  for (const [file, bytes] of saved) assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(fs.existsSync(path.join(value.outputRoot, "stage-1")), false);
  const scenario = { id: "fixed", status: "confirmed", entry: "Read Feature", steps: ["Read proof.js"], result: "Feature is true", evidenceRefs: ["good"] };
  const result = await runStagePipeline({ ...value, request: { ...request, scenarios: [scenario, scenario] }, runner: () => ({ stage: 1, status: "candidate" }) });
  assert.equal(result.status, "closed");
  const facts = JSON.parse(fs.readFileSync(result.artifact)).facts;
  assert.equal(facts.filter(row => row.kind === "scenario").length, 1);
});

test("BDD: incoming planning ID collisions with lineage fail before publication", async t => {
  const value = fixture(t);
  await runStagePipeline({ ...value, runner: () => ({ stage: 0, status: "candidate", ownership: [{ id: "same", status: "candidate" }] }) });
  const before = fs.readFileSync(value.stateFile);
  await assert.rejects(runStagePipeline({ ...value, request: { stage: 1, target: "Feature", repositoryScope: value.repositoryScope, scenarios: [{ id: "same", status: "candidate" }] }, runner: () => ({ stage: 1, status: "candidate" }) }), /scenarios\[same\].id/);
  assert.deepEqual(fs.readFileSync(value.stateFile), before);
});

test("BDD: lineage enrichment retains proofs while incomplete candidates stay permitted", async t => {
  const value = fixture(t, true);
  await runStagePipeline({ ...value, runner: () => ({ stage: 0, status: "candidate", canonicalEvidence: proofs(value), scenarios: [{ id: "s", status: "candidate", entry: "", steps: [], evidenceRefs: ["good"] }] }) });
  const result = await runStagePipeline({ ...value, request: { stage: 1, target: "Feature", repositoryScope: value.repositoryScope, scenarios: [{ id: "s", status: "confirmed", entry: "Read", steps: ["Read Feature"], result: "True" }, { id: "pending", status: "candidate" }] }, runner: () => ({ stage: 1, status: "candidate" }) });
  const facts = JSON.parse(fs.readFileSync(result.artifact)).facts;
  assert.equal(facts.find(row => row.id === "s").evidenceRefs.length, 1);
  assert.equal(facts.find(row => row.id === "pending").status, "candidate");
});

test("BDD: Stage 2 explicit source proof reaches Stage 3 without manual alias selection", async t => {
  const value = fixture(t);
  const source = path.join(value.root, "repeated.js"), text = "const Feature = true;\nconst Feature = true;\n";
  fs.writeFileSync(source, text);
  const base = { target: "Feature", repositoryScope: value.repositoryScope };
  for (const stage of [0, 1]) await runStagePipeline({ ...value, request: { ...value.request, ...base, stage }, runner: () => ({ stage, status: "candidate" }) });
  const confirmation = { id: "proof-first", repository: "source", file: source, line: 1, endLine: 1,
    sourceFragment: "const Feature = true;", sourceHash: crypto.createHash("sha256").update(text).digest("hex"), status: "source-confirmed" };
  const { runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");
  const second = await runStagePipeline({ ...value, request: { ...base, stage: 2,
    dictionary: [{ id: "definition", name: "Feature", status: "confirmed", evidenceRefs: [confirmation.id] }] },
    runner: () => ({ stage: 2, status: "candidate", sourceEvidence: runEvidenceChecks({ retainAllMatches: true,
      checks: [{ id: "query-feature", repository: "source", file: source, pattern: "Feature", confirmation }] }) }) });
  const bundle = JSON.parse(fs.readFileSync(second.evidence)), proof = bundle.evidence.find(row => row.aliases.includes(confirmation.id));
  assert.equal(bundle.evidence.length, 2);
  assert.equal(proof.confirmation.status, "source-confirmed");
  const saved = new Map([second.artifact, second.evidence, second.manifest, value.stateFile].map(file => [file, fs.readFileSync(file)]));
  const scenario = { id: "read", status: "confirmed", entry: "Read first Feature", steps: ["Read first source line"], result: "Feature is true" };
  // The broad query alias must still fail: proof filtering or automatic substitution is forbidden.
  await assert.rejects(runStagePipeline({ ...value, request: { ...base, stage: 3,
    scenarios: [{ ...scenario, evidenceRefs: ["query-feature"] }] }, runner: () => ({ stage: 3, status: "candidate" }) }), /scenarios\[read\].*evidenceRefs/);
  for (const [file, bytes] of saved) assert.deepEqual(fs.readFileSync(file), bytes);
  const third = await runStagePipeline({ ...value, request: { ...base, stage: 3,
    scenarios: [{ ...scenario, evidenceRefs: [confirmation.id] }] }, runner: () => ({ stage: 3, status: "candidate" }) });
  const facts = JSON.parse(fs.readFileSync(third.artifact)).facts;
  assert.deepEqual(facts.find(row => row.id === "read").evidenceRefs, [proof.id]);
});
