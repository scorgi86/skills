"use strict";

const crypto = require("node:crypto");

const { normalizeRepositoryScope } = require("../../../shared/dto/src/repository_scope.js");

const path = require("node:path");

const { PLANNING_COLLECTIONS: PLANNING_INPUT_COLLECTIONS, mergeRows } = require("../../../shared/dto/src/planning_contract.js");

const fs = require("node:fs");

const { validateStageArtifact, writeStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");

function slug(value) {
  return String(value || "inventory").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "inventory";
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function scopeDigest(scope) { return crypto.createHash("sha256").update(JSON.stringify(stable(scope))).digest("hex").slice(0, 12); }

function defaultOutputRoot(request, cwd = process.cwd()) {
  const scope = normalizeRepositoryScope(request.repositoryScope, { requireExisting: request.requireExistingRoots !== false });
  return path.join(path.resolve(cwd), ".codex", "inventory-artifacts", `${slug(request.target)}-${scopeDigest(scope)}`);
}

function runnerFor(stage) {
  if (stage === 0) return require("../../../steps/step-0/src/runner.js").runStage0;
  if (stage === 1) return require("../../../steps/step-1/src/runner.js").runStage1;
  if (stage === 2) return require("../../../steps/step-2/src/runner.js").runStage2;
  if (stage === 3) return require("../../../steps/step-3/src/runner.js").runStage3;
  if (stage === 4) return require("../../../steps/step-4/src/runner.js").runStage4;
  if (stage === 5) return require("../../../steps/step-5/src/runner.js").runStage5;
  if (stage === 6) return require("../../../steps/step-6/src/runner.js").runStage6;
  if (stage === 7) return (request) => require("../../../steps/step-7/src/runner.js").buildStage7(request, { artifactBase: request.artifactBase || process.cwd() });
  throw new Error("stage_pipeline supports stages 0..7; Stage 8 uses its digest-bound renderer");
}

function transactionStatus(facts) {
  if (["error", "blocked", "partial"].includes(facts?.status)) return "partial";
  if (facts?.quality?.coverageGate && facts.quality.coverageGate.ok === false) return "partial";
  return "closed";
}

function carryPlanningFacts(request, produced) {
  const result = { ...produced };
  for (const name of PLANNING_INPUT_COLLECTIONS) {
    const rows = [...(Array.isArray(request[name]) ? request[name] : []), ...(Array.isArray(produced[name]) ? produced[name] : [])];
    if (rows.length) result[name] = mergeRows(rows);
  }
  return result;
}

function runState(args) { return require("../../../state/src/stage_state.js").main(args); }

function runStagePipeline(options = {}) {
  const request = options.request;
  if (!request || !Number.isInteger(Number(request.stage))) throw new Error("Pipeline request requires stage 0..7");
  const stage = Number(request.stage);
  if (stage < 0 || stage > 7) throw new Error("Pipeline request requires stage 0..7");
  normalizeRepositoryScope(request.repositoryScope, { requireExisting: request.requireExistingRoots !== false });
  if (options.stateFile) runState(["assert", "--state", options.stateFile, "--stage", String(stage)]);
  const runnerResult = (options.runner || runnerFor(stage))(request, options.dependencies || {});
  // Stage 7 returns an already normalized and digest-bound report model. Any
  // merge or transport decoration after that point invalidates its integrity.
  const produced = stage === 7 ? runnerResult : carryPlanningFacts(request, runnerResult);
  const facts = stage === 7 ? produced : { ...produced, repositoryScope: request.repositoryScope, exclusions: request.exclusions || [], status: transactionStatus(produced), runnerStatus: produced.status || "unknown" };
  const outputRoot = options.outputRoot || defaultOutputRoot(request, options.cwd);
  const outputDir = path.join(outputRoot, `stage-${stage}`);
  if (fs.existsSync(path.join(outputDir, "canonical", "manifest.json"))) throw new Error(`Canonical stage already exists: ${outputDir}`);
  const written = writeStageArtifact({ outputDir, facts, input: request, usage: options.usage, retainRaw: options.retainRaw === true, metrics: options.metrics || {} });
  const validation = validateStageArtifact(outputDir);
  if (!validation.ok) throw new Error(`Canonical stage validation failed: ${validation.errors.join("; ")}`);
  if (facts.status !== "closed") return { status: "partial", stage, artifact: written.resultFile, manifest: written.manifestFile, stateChanged: false, runnerStatus: facts.runnerStatus };
  let state = null;
  if (options.stateFile) state = runState(["advance", "--state", options.stateFile, "--stage", String(stage), "--artifact", written.resultFile]);
  return { status: "closed", stage, artifact: written.resultFile, evidence: written.evidenceFile, manifest: written.manifestFile, rawRetained: Boolean(written.rawFile), stateChanged: Boolean(state), nextStage: stage + 1 };
}

function parseArgs(argv) {
  const options = { retainRaw: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--retain-raw") options.retainRaw = true;
    else if (["--request", "--state", "--output-root", "--usage"].includes(arg)) options[arg.slice(2)] = argv[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.request) throw new Error("Provide --request <request.json>");
  return options;
}

module.exports = { carryPlanningFacts, defaultOutputRoot, parseArgs, runStagePipeline, runnerFor, scopeDigest, slug, transactionStatus };
