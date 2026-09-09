const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateStage2Coverage } = require("../src/coverage_gate.js");
const { applySafeBudget } = require("../../../shared/output/src/measure_context.js");
const { prepareFacts } = require("../../../shared/artifacts/src/canonical/facts.js");

test("Stage2 ownership failure blocks the composed gate even if a previous flag said passed", () => {
  const gate = evaluateStage2Coverage({ stage: 2, ast: { stats: {}, plan: { compiledBeforeParse: true } },
    quality: { ownershipGraph: { ok: false, errors: ["orphan owner"] } } }, { requirePlan: true });
  assert.equal(gate.ok, false);
  assert.equal(gate.status, "blocked");
  assert.ok(gate.errors.some(error => error.includes("orphan")));
});

test("real Stage2 keeps orphan ownership blocked after budget projection", t => {
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = require("../../../shared/dto/tests/test_helpers.js").writeCanonicalTransition(root, 1);
  const facts = require("../src/runner.js").runStage2({ stage: 2, transitionArtifact: previous,
    ownershipGraph: { nodes: [{ id: "seed", entity: "Seed", order: 0 }, { id: "orphan", entity: "Owner", order: 1 }], edges: [] },
    budgets: { factsBytes: 8192 } }, {
    runAstBatch: () => ({ status: "candidate", stats: { parseCounts: {}, failed: 0 }, plan: { compiledBeforeParse: true, lateQueries: 0 }, results: [] }),
    runEvidenceChecks: () => ({ checks: [] })
  });
  assert.equal(facts.quality.ownershipGraph.ok, false);
  assert.equal(facts.quality.coverageGate.ok, false);
  assert.equal(facts.quality.coverageGate.status, "blocked");
  assert.equal(facts.status, "partial");
  assert.equal(require("../../../flows/full-flow/src/stage_pipeline.js").transactionStatus(facts), "partial");
});

test("Stage2 instrumentation preserves the direct and deferred results", t => {
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-observe-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const transitionArtifact = require("../../../shared/dto/tests/test_helpers.js").writeCanonicalTransition(root, 1);
  const request = { stage: 2, transitionArtifact, budgets: { factsBytes: 8192 } };
  const base = {
    runAstBatch: () => ({ status: "candidate", stats: { parseCounts: {}, failed: 0 }, plan: { compiledBeforeParse: true, lateQueries: 0 }, results: [] }),
    runEvidenceChecks: () => ({ checks: [] })
  };
  const ordinary = require("../src/runner.js").runStage2(request, base);
  const calls = { coverage: 0, budget: 0, prepare: 0 };
  const observed = require("../src/runner.js").runStage2(request, { ...base,
    evaluateStage2Coverage(...args) { calls.coverage += 1; return evaluateStage2Coverage(...args); },
    applySafeBudget(...args) { calls.budget += 1; return applySafeBudget(...args); },
    prepareFacts(...args) { calls.prepare += 1; return prepareFacts(...args); }
  });
  assert.deepEqual(observed, ordinary);
  assert.deepEqual(calls, { coverage: 1, budget: 1, prepare: 1 });
  calls.coverage = calls.budget = calls.prepare = 0;
  require("../src/runner.js").runStage2(request, { ...base, deferCanonicalization: true,
    evaluateStage2Coverage(...args) { calls.coverage += 1; return evaluateStage2Coverage(...args); },
    applySafeBudget(...args) { calls.budget += 1; return applySafeBudget(...args); },
    prepareFacts(...args) { calls.prepare += 1; return prepareFacts(...args); }
  });
  assert.deepEqual(calls, { coverage: 1, budget: 1, prepare: 0 });
});

test("one coverage and budget pass preserves Stage2 boundary scenarios", t => {
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-one-pass-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const transitionArtifact = require("../../../shared/dto/tests/test_helpers.js").writeCanonicalTransition(root, 1);
  const ast = overrides => ({ status: "candidate", stats: { parseCounts: {}, failed: 0 }, plan: { compiledBeforeParse: true, lateQueries: 0 }, results: [], ...overrides });
  const scenarios = [
    { name: "candidate", request: {}, ast: ast(), evidence: { checks: [] } },
    { name: "coverage-blocked partial", request: {}, ast: ast({ plan: null }), evidence: { checks: [] } },
    { name: "auto-raised", request: { budgets: { factsBytes: 8192 } }, ast: ast({ padding: "x".repeat(12000) }), evidence: { checks: [] } },
    { name: "candidate-empty", request: {}, ast: ast(), evidence: { checks: [{ id: "empty", status: "candidate-empty" }] } }
  ];
  for (const scenario of scenarios) {
    const request = { stage: 2, transitionArtifact, ...scenario.request };
    const base = { runAstBatch: () => scenario.ast, runEvidenceChecks: () => scenario.evidence };
    const current = require("../src/runner.js").runStage2(request, base);
    let gate;
    let coverageCalls = 0;
    let budgetCalls = 0;
    const onePass = require("../src/runner.js").runStage2(request, { ...base,
      evaluateStage2Coverage(...args) { coverageCalls += 1; if (!gate) gate = evaluateStage2Coverage(...args); return structuredClone(gate); },
      applySafeBudget(...args) { budgetCalls += 1; return budgetCalls === 1 ? applySafeBudget(...args) : args[0].output; }
    });
    assert.deepEqual(onePass, current, scenario.name);
    if (scenario.name === "coverage-blocked partial") { assert.equal(onePass.quality.coverageGate.ok, false); assert.equal(onePass.status, "partial"); }
    if (scenario.name === "auto-raised") assert.equal(onePass.output.autoRaised, true);
    if (scenario.name === "candidate-empty") { assert.equal(onePass.quality.emptyChecksAreCandidates, 1); assert.ok(onePass.quality.coverageGate.warnings.some(item => item.includes("empty"))); }
    assert.equal(coverageCalls, 1);
    assert.equal(budgetCalls, 1);
  }
});
