const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateStage2Coverage } = require("../src/coverage_gate.js");

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
