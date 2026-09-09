#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("node:child_process");
const { runStage0, render } = require("../steps/step-0/src/runner.js");

function parseArgs(argv) {
  const result = { runs: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--request") result.request = argv[++index];
    else if (argv[index] === "--runs") result.runs = Number(argv[++index]);
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (!result.request || !Number.isInteger(result.runs) || result.runs < 1) throw new Error("Usage: --request <stage0.json> [--runs <positive integer>]");
  return result;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? String(result.stdout).trim() : "unavailable";
}

function projection(facts) {
  return JSON.stringify({ scans: facts.scans, summary: facts.summary, transition: facts.transition, report: render(facts) });
}

async function sample(request, concurrency) {
  const started = performance.now();
  const facts = await runStage0({ ...request, searchConcurrency: concurrency });
  return { elapsedMs: performance.now() - started, projection: projection(facts) };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const request = JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8"));
  await sample(request, 1);
  await sample(request, 4);
  const modes = {};
  let expected;
  for (const concurrency of [1, 4]) {
    const samples = [];
    for (let run = 0; run < options.runs; run += 1) {
      const current = await sample(request, concurrency);
      expected ||= current.projection;
      if (current.projection !== expected) throw new Error("Stage 0 semantic projection changed between benchmark runs");
      samples.push(current.elapsedMs);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    modes[concurrency] = { samplesMs: samples, medianMs: sorted[Math.floor(sorted.length / 2)] };
  }
  const speedupPercent = ((modes[1].medianMs - modes[4].medianMs) / modes[1].medianMs) * 100;
  const repositories = request.repositoryScope.repositories.map((repo) => ({ id: repo.id, root: path.resolve(repo.root), revision: commandOutput("git", ["-C", path.resolve(repo.root), "rev-parse", "HEAD"]) }));
  const result = { node: process.version, os: `${os.platform()} ${os.release()} ${os.arch()}`, rg: commandOutput("rg", ["--version"]).split(/\r?\n/)[0], runs: options.runs,
    repositories, seeds: request.seeds, modes, speedupPercent, recommendedDefault: speedupPercent >= 20 ? "min(4, repositoryCount)" : 1 };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) void main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
module.exports = { main, parseArgs, projection, sample };
