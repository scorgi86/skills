"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { buildStage1Bundle } = require("./stage1_bundle");
const { evaluateStage1Coverage } = require("./stage1_coverage_gate");
const { buildStage1Summary, gitNexusInvocation, runStage1 } = require("./stage1_runner");

function fixtureSet() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage1-runtime-"));
  const source = path.join(directory, "shape.js");
  const transition = path.join(directory, "stage0.md");
  fs.writeFileSync(source, [
    "function CInnerShdw() {}",
    "function CEffectLst() { this.innerShdw = null; }",
    "function CSpPr() { this.effectProps = new CEffectLst(); }",
    "CSpPr.prototype.setEffectPr = function(value) { this.effectProps = value; };",
  ].join("\n"));
  fs.writeFileSync(transition, [
    "# Этап 0. Подготовка",
    "", "## Вход", "- target", "", "## Действия", "- scope", "", "## Выход", "- seeds", "", "## DoD", "- [x] scope", "", "## Статус этапа", "закрыт", "", "## Артефакт для следующего этапа",
    "- target: inner shadow", "- scope: fixture", "- stage: 0", "- status: закрыт", "- confirmed evidence: seeds", "- candidate evidence: none", "- dictionary/graph/path state: ready", "- skipped/forbidden: none", "- open checks: owners", "- next stage: 1 — Нижние слои и владение", "", "## Следующий этап", "Остановиться до команды пользователя продолжай.",
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
    ast: { queries: [{ id: "owners", command: "find", file: set.source, options: { terms: "innerShdw,effectProps" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 10 }] },
    evidence: { checks: [{ id: "owners", file: set.source, pattern: { value: "innerShdw|effectProps", regex: true }, maxMatches: 6, maxGroups: 6 }] },
    ownership: { expectedIds: ["model", "container", "owner"], groups: [
      { id: "model", order: "1", role: "model", object: "CInnerShdw", relation: "defines", evidenceRefs: ["owners"] },
      { id: "container", order: "2", role: "container", object: "CEffectLst.innerShdw", relation: "contains", evidenceRefs: ["owners"] },
      { id: "owner", order: "3", role: "owner", object: "CSpPr.effectProps", relation: "owns", evidenceRefs: ["owners"] },
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
  return { status: "candidate", requests: [{ seed: "CInnerShdw", status: "candidate" }], context: { seed: "CInnerShdw", candidateCount: 1, symbol: { name: "CInnerShdw", filePath: "shape.js", startLine: 1 } } };
}

test("stage 1 runner builds bounded facts and parses each file once", () => {
  const set = fixtureSet();
  const facts = runStage1(request(set), { runGitNexusContext: graph });
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

test("stage 1 retains declared generic boundary candidates for later stages", () => {
  const set = fixtureSet();
  const data = request(set);
  data.boundaries = [{ id: "fixture-bridge", producerRepo: "engine", kind: "setter", symbol: "setEffectPr", relation: "sets effect property", evidenceRefs: ["owners"], ownershipRefs: ["owner"], consumerRepos: ["client"], searchTerms: ["applyEffectPr"] }];
  const facts = runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.boundaries.length, 1);
  assert.equal(facts.boundaries[0].status, "candidate");
  assert.equal(facts.quality.coverageGate.ok, true, facts.quality.coverageGate.errors.join("; "));
});

test("stage 1 gate rejects an unconfirmed promotion", () => {
  const set = fixtureSet();
  const facts = runStage1(request(set), { runGitNexusContext: graph });
  facts.ownership.groups[0].status = "confirmed";
  const gate = evaluateStage1Coverage(facts);
  assert.equal(gate.ok, false);
  assert.match(gate.errors.join("\n"), /confirmation record/);
});

test("stage 1 gate requires declared ownership branches", () => {
  const set = fixtureSet();
  const data = request(set);
  data.ownership.expectedIds.push("theme-owner");
  const facts = runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, false);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /theme-owner: expected ownership group is missing/);
});

test("stage 1 gate requires an ownership expectation set", () => {
  const set = fixtureSet();
  const data = request(set);
  delete data.ownership.expectedIds;
  const facts = runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, false);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /must declare expected ownership ids/);
});

test("stage 1 gate enforces generic categories and baseline preservation", () => {
  const set = fixtureSet();
  const data = request(set);
  data.coverageContract.categories[0].groupIds = ["missing-model"];
  data.coverageContract.baseline.ownershipIds.push("removed-owner");
  const facts = runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, false);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /direct-model: declared group missing-model is missing/);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /removed-owner: baseline ownership group is missing/);
});

test("stage 1 gate blocks an open category required before close", () => {
  const set = fixtureSet();
  const data = request(set);
  const category = data.coverageContract.categories.find((item) => item.id === "history-copy");
  category.requiredBeforeClose = true;
  const facts = runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, false);
  assert.match(facts.quality.coverageGate.errors.join("\n"), /history-copy: required-before-close coverage category remains open/);
  category.status = "not-applicable";
  const closed = runStage1(data, { runGitNexusContext: graph });
  assert.equal(closed.quality.coverageGate.ok, true, closed.quality.coverageGate.errors.join("; "));
});

test("stage 1 claim ledger requires declared groups and observations", () => {
  const set = fixtureSet();
  const data = request(set);
  data.observations = [{ id: "cross-repo", status: "candidate-negative", scope: "fixture", result: "no exact seed matches" }];
  data.claimLedger = { required: true, claims: [
    { id: "model-claim", status: "confirmed", groupIds: ["model"] },
    { id: "cross-repo-claim", status: "candidate-negative", observationIds: ["cross-repo"] },
  ] };
  const facts = runStage1(data, { runGitNexusContext: graph });
  assert.equal(facts.quality.coverageGate.ok, true, facts.quality.coverageGate.errors.join("; "));
  facts.claimLedger.claims[0].groupIds = ["missing"];
  const gate = evaluateStage1Coverage(facts);
  assert.equal(gate.ok, false);
  assert.match(gate.errors.join("\n"), /model-claim: claimed ownership group missing is missing/);
});

test("confirmed ownership uses and enforces its confirmation anchor", () => {
  const set = fixtureSet();
  const data = request(set);
  data.ownership.groups[1].status = "confirmed";
  data.ownership.groups[1].confirmation = { method: "manual-read", file: "shape.js", line: 2 };
  const facts = runStage1(data, { runGitNexusContext: graph });
  assert.deepEqual(facts.ownership.groups[1].anchor, { file: "shape.js", line: 2 });
  assert.match(facts.ownership.groups[1].confirmation.freshness.fragmentHash, /^[a-f0-9]{64}$/);
  assert.equal(facts.quality.coverageGate.ok, true, facts.quality.coverageGate.errors.join("; "));
  facts.ownership.groups[1].anchor = { file: "shape.js", line: 3 };
  const gate = evaluateStage1Coverage(facts);
  assert.equal(gate.ok, false);
  assert.match(gate.errors.join("\n"), /anchor must match confirmation/);
});

test("confirmation freshness reuses one source read for multiple anchors", () => {
  const set = fixtureSet();
  const data = request(set);
  data.ownership.groups[0].status = "confirmed";
  data.ownership.groups[0].confirmation = { method: "manual-read", file: "shape.js", line: 1 };
  data.ownership.groups[1].status = "confirmed";
  data.ownership.groups[1].confirmation = { method: "manual-read", file: "shape.js", line: 2 };
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (...args) {
    if (path.resolve(args[0]) === set.source) reads += 1;
    return original.apply(this, args);
  };
  try {
    runStage1(data, { runGitNexusContext: graph });
    assert.equal(reads, 3, "one AST read, one source-evidence read, and one shared freshness read");
  } finally {
    fs.readFileSync = original;
  }
});

test("GitNexus invocation supports local run.cjs and cmd executables", () => {
  const local = gitNexusInvocation({ runnerPath: "C:/tmp/.gitnexus/run.cjs", repo: "sdkjs", file: "a.js", seed: "CInnerShdw", limit: 5 });
  assert.equal(local.command, process.execPath);
  assert.deepEqual(local.args.slice(1, 5), ["context", "--repo", "sdkjs", "--file"]);
  const command = gitNexusInvocation({ command: "C:/bin/gitnexus.cmd", seed: "CInnerShdw" });
  assert.equal(command.shell, true);
});

test("stage 1 bundle is deterministic and refuses overwrite", () => {
  const set = fixtureSet();
  const facts = runStage1(request(set), { runGitNexusContext: graph });
  const first = path.join(set.directory, "first");
  const second = path.join(set.directory, "second");
  const firstSummary = buildStage1Bundle(facts, first);
  const secondSummary = buildStage1Bundle(facts, second);
  assert.equal(firstSummary.validation, "passed");
  assert.equal(fs.readFileSync(path.join(first, "report.md"), "utf8"), fs.readFileSync(path.join(second, "report.md"), "utf8"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first, "manifest.json"), "utf8")).artifacts.map((item) => item.sha256), JSON.parse(fs.readFileSync(path.join(second, "manifest.json"), "utf8")).artifacts.map((item) => item.sha256));
  assert.throws(() => buildStage1Bundle(facts, first), /already exists/);
});

test("stage 1 CLI emits only bounded summary when facts artifact is retained", () => {
  const set = fixtureSet();
  const requestFile = path.join(set.directory, "request.json");
  const factsFile = path.join(set.directory, "facts.json");
  fs.writeFileSync(requestFile, JSON.stringify(request(set)));
  const completed = spawnSync(process.execPath, [path.resolve(__dirname, "stage1_runner.js"), "--request", requestFile, "--output", factsFile, "--stdout", "summary"], { encoding: "utf8" });
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  const summary = JSON.parse(completed.stdout);
  assert.equal(summary.artifact, factsFile);
  assert.ok(Buffer.byteLength(completed.stdout) <= 8 * 1024);
  assert.equal(JSON.parse(fs.readFileSync(factsFile, "utf8")).stage, 1);
});
