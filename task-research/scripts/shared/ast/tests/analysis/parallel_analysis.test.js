"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { analyzeFiles } = require("../../src/analysis/analysis.js");
const { analyzeInWorkers, normalizeConcurrency } = require("../../src/analysis/parallel_analysis.js");
const { runStage1 } = require("../../../../steps/step-1/src/runner.js");
const { runStage2 } = require("../../../../steps/step-2/src/runner.js");
const { writeCanonicalTransition } = require("../../../dto/tests/test_helpers.js");
const { createCanonicalStageResult } = require("../../../artifacts/src/canonical/result.js");

test("AST concurrency validates before analysis and caps to unique work", async () => {
  assert.equal(normalizeConcurrency(undefined, 4), 1);
  assert.equal(normalizeConcurrency(8, 3), 3);
  assert.equal(normalizeConcurrency(2, 0), 1);
  for (const value of [0, -1, 1.5, "2"]) assert.throws(() => normalizeConcurrency(value, 3), /positive integer/);
  let created = 0;
  await assert.rejects(analyzeFiles(["missing.js"], { concurrency: 0 }, { createWorker() { created += 1; } }), /positive integer/);
  assert.equal(created, 0);
  const sequential = await analyzeFiles(["missing.js"], { concurrency: 1 }, { createWorker() { created += 1; } });
  assert.equal(sequential.stats.failed, 1);
  assert.equal(created, 0);
});

test("bounded workers preserve input order when tasks finish out of order", async () => {
  let active = 0, peak = 0, created = 0;
  class FakeWorker extends EventEmitter {
    postMessage(message) {
      active += 1; peak = Math.max(peak, active);
      setTimeout(() => { active -= 1; this.emit("message", { index: message.index, analyzed: { result: { file: message.filename }, cache: "disabled" } }); }, (4 - message.index) * 5);
    }
    terminate() { return Promise.resolve(0); }
  }
  const files = ["a.js", "b.js", "c.js", "d.js"];
  const results = await analyzeInWorkers(files, { concurrency: 2 }, { createWorker() { created += 1; return new FakeWorker(); } });
  assert.equal(created, 2);
  assert.equal(peak, 2);
  assert.deepEqual(results.map(row => row.result.file), files);
});

test("real workers preserve sequential AST semantics", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parallel-ast-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = [path.join(root, "a.js"), path.join(root, "b.ts")];
  fs.writeFileSync(files[0], "class Alpha {}\n");
  fs.writeFileSync(files[1], "interface Bravo { value: number }\n");
  const sequential = await analyzeFiles(files, { concurrency: 1 });
  const parallel = await analyzeFiles(files, { concurrency: 2 });
  const semantic = value => JSON.parse(JSON.stringify(value, (key, item) => key === "elapsedMs" ? undefined : item));
  assert.deepEqual(semantic(parallel), semantic(sequential));
});

test("BDD: Stage 1 and Stage 2 preserve canonical semantics and phase order", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parallel-stage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = [path.join(root, "a.js"), path.join(root, "b.js")];
  fs.writeFileSync(files[0], "class Alpha {}\n"); fs.writeFileSync(files[1], "class Bravo {}\n");
  const scope = { repositories: [{ id: "source", root, role: "source" }] };
  const initial = writeCanonicalTransition(root, 0, { facts: { repositoryScope: scope } });
  const run = async concurrency => {
    const phases = [];
    const dependencies = {
      async runAstBatch(request) { phases.push("ast"); return await require("../../src/batch/batch.js").runAstBatch(request); },
      runEvidenceChecks() { phases.push("evidence"); return { checks: [] }; },
      runGitNexusContext: () => ({ status: "candidate", requests: [] }),
    };
    const ast = { concurrency, queries: [{ id: "symbols", command: "symbols", files }] };
    const first = await runStage1({ stage: 1, transitionArtifact: initial, repositoryScope: scope, ast, evidence: { checks: [] } }, dependencies);
    phases.push("canonicalization");
    const transition = path.join(root, `stage1-${concurrency}.json`);
    fs.writeFileSync(transition, JSON.stringify(createCanonicalStageResult({ facts: first, factsPrepared: true })));
    const second = await runStage2({ stage: 2, transitionArtifact: transition, repositoryScope: scope, ast, evidence: { checks: [] } }, dependencies);
    return { phases, first, second };
  };
  const sequential = await run(1), parallel = await run(2);
  assert.deepEqual(parallel.phases, ["ast", "evidence", "canonicalization", "ast", "evidence"]);
  assert.deepEqual(parallel.phases, sequential.phases);
  const semantic = value => JSON.parse(JSON.stringify(value, (key, item) => ["elapsedMs", "cacheHits", "cacheMisses", "output", "summary", "measurements"].includes(key) ? undefined : item));
  assert.deepEqual(semantic(parallel.first), semantic(sequential.first));
  assert.deepEqual(semantic(parallel.second), semantic(sequential.second));
});

test("every worker infrastructure failure rejects and settles the pool", async t => {
  const cases = ["startup", "error", "exit", "message"];
  for (const scenario of cases) await t.test(scenario, async () => {
    const workers = [];
    class FakeWorker extends EventEmitter {
      constructor(id) { super(); this.id = id; this.terminated = false; this.assignments = 0; }
      postMessage(message) {
        this.assignments += 1;
        queueMicrotask(() => {
          if (scenario === "error") this.emit("error", new Error("worker error"));
          else if (scenario === "exit") this.emit("exit", 1);
          else this.emit("message", { index: message.index });
        });
      }
      terminate() { this.terminated = true; return Promise.resolve(0); }
    }
    let calls = 0;
    const createWorker = () => {
      calls += 1;
      if (scenario === "startup" && calls === 2) throw new Error("startup failed");
      const worker = new FakeWorker(calls); workers.push(worker); return worker;
    };
    await assert.rejects(analyzeInWorkers(["a", "b", "c", "d"], { concurrency: 2 }, { createWorker }), /startup|worker|exited|invalid/);
    assert.ok(workers.every(worker => worker.terminated));
    assert.ok(workers.reduce((sum, worker) => sum + worker.assignments, 0) <= 2);
  });
});
