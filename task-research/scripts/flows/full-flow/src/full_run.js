"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { normalizeRepositoryScope } = require("../../../shared/dto/src/repository_scope.js");
const { scopeDigest } = require("../../../shared/artifacts/src/canonical/checks.js");
const { readCanonicalStageResult } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { runStagePipeline } = require("./stage_pipeline.js");
const { initialState } = require("../../../state/src/state_model.js");
const { StateStore } = require("../../../state/src/persistence/state_store.js");
const { InventorySession } = require("../../../state/src/session/inventory_session.js");
const transitions = require("../../../state/src/model/transitions.js");
const { validateStage8Manifest } = require("../../../state/src/artifacts/stage8_validation.js");
const { run: runStage8, unwrapModel } = require("../../../steps/step-8/src/runner.js");
const { normalizeCoverageProfile, normalizeNewCoverageProfile } = require("../../../shared/report/src/model/coverage.js");

const SCHEMA = "research-package/1.0.0";
const FORBIDDEN = new Set(["target", "repositoryScope", "transitionArtifact", "priorArtifacts", "expectedArtifact", "artifactBase", "outputRoot", "output-root", "state", "stateFile"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function readPackage(value) {
  if (typeof value === "string") return JSON.parse(fs.readFileSync(path.resolve(value), "utf8"));
  return structuredClone(value);
}

function loadResearchPackage(source) {
  const value = readPackage(source);
  if (value?.schemaVersion !== SCHEMA) throw new Error(`Research package requires schemaVersion ${SCHEMA}`);
  if (typeof value.target !== "string" || !value.target.trim()) throw new Error("Research package requires target");
  const repositoryScope = normalizeRepositoryScope(value.repositoryScope);
  const keys = Object.keys(value.stages || {}).sort();
  if (keys.join(",") !== "0,1,2,3,4,5,6,7") throw new Error("Research package requires templates for stages 0 through 7");
  for (const key of keys) {
    const template = value.stages[key];
    if (!template || Array.isArray(template) || typeof template !== "object") throw new Error(`Stage ${key} template must be an object`);
    for (const field of Object.keys(template)) if (FORBIDDEN.has(field)) throw new Error(`Stage ${key} template must not contain runtime field ${field}`);
  }
  if (value.stages["0"].coverageProfile === undefined) throw new Error("Stage 0 template requires coverageProfile");
  const coverageProfile = normalizeCoverageProfile(value.stages["0"].coverageProfile);
  if (!coverageProfile.requiredCapabilities?.length) throw new Error("Stage 0 coverageProfile requires at least one requiredCapabilities id");
  if (!Array.isArray(value.stages["0"].seeds?.direct) || !value.stages["0"].seeds.direct.length || value.stages["0"].seeds.direct.some(seed => typeof seed !== "string" || !seed.trim())) throw new Error("Stage 0 template requires non-empty string seeds.direct");
  for (const selector of value.stages["7"].evidenceSelectors || []) {
    if (!Number.isInteger(Number(selector.stage)) || Number(selector.stage) < 0 || Number(selector.stage) > 6 || selector.artifact) {
      throw new Error("Stage 7 evidence selectors require stage 0..6 and must not contain artifact paths");
    }
  }
  value.stages["0"].coverageProfile = coverageProfile;
  return deepFreeze({ schemaVersion: SCHEMA, target: value.target.normalize("NFC"), repositoryScope, stages: value.stages });
}

function planNextAction(state, transactionStatus = null) {
  if (!state) return { kind: "run-stage", stage: 0 };
  if (state.execution.runStatus === "complete") return { kind: "already-complete" };
  if (state.execution.runStatus !== "running") return { kind: "stop", reason: `state-${state.execution.runStatus}` };
  if (state.currentStage >= 0 && state.currentStage <= 7) {
    return { kind: transactionStatus === "partial" ? "retry-partial" : "run-stage", stage: state.currentStage };
  }
  if (state.currentStage === 8) return { kind: "run-stage-8", stage: 8 };
  if (state.currentStage === 9 && state.lastCompletedStage === 8) return { kind: "complete-run" };
  return { kind: "stop", reason: "invalid-stage-state" };
}

function activeArtifacts(state, lastStage) {
  const rows = state?.activeArtifacts || [];
  const byStage = new Map(rows.map(row => [Number(row.stage), path.resolve(row.artifact)]));
  const result = [];
  for (let stage = 0; stage <= lastStage; stage += 1) {
    const artifact = byStage.get(stage);
    if (!artifact) throw new Error(`Active lineage is missing Stage ${stage}`);
    result.push(artifact);
  }
  return result;
}

function materializeStageRequest(pkg, stage, state = null) {
  const template = structuredClone(pkg.stages[String(stage)]);
  const request = { ...template, stage, target: pkg.target, repositoryScope: structuredClone(pkg.repositoryScope) };
  if (stage > 0) {
    if (!state?.canonicalArtifact) throw new Error(`Stage ${stage} requires an active transition artifact`);
    request.transitionArtifact = path.resolve(state.canonicalArtifact);
  }
  if (stage === 7) {
    const priorArtifacts = activeArtifacts(state, 6);
    request.priorArtifacts = priorArtifacts;
    request.expectedArtifact = priorArtifacts[6];
    if (Array.isArray(template.evidenceSelectors)) {
      request.evidenceSelectors = template.evidenceSelectors.map(({ stage: selectedStage, ...selector }) => ({ artifact: priorArtifacts[Number(selectedStage)], ...selector }));
    }
  }
  return request;
}

function readState(stateFile) {
  return fs.existsSync(stateFile) ? InventorySession.open({ stateFile }).state : null;
}

function partialStatus(outputRoot, stage) {
  const file = path.join(outputRoot, `stage-${stage}`, "canonical", "stage-result.json");
  if (!fs.existsSync(file)) return null;
  try { return readCanonicalStageResult(file).status; } catch { return null; }
}

function continuationPackage(pkg, state, outputRoot) {
  if (!state) return pkg;
  const partial = path.join(outputRoot, "stage-0", "canonical", "stage-result.json");
  const stage0 = state.lastCompletedStage >= 0 ? activeArtifacts(state, 0)[0] : fs.existsSync(partial) ? partial : null;
  if (!stage0) return pkg;
  const canonical = readCanonicalStageResult(stage0);
  if (String(canonical.summary.target || "").normalize("NFC") !== pkg.target) throw new Error("Research package target conflicts with the active run; use a new state and output root");
  const savedScope = canonical.summary.repositoryScope;
  if (scopeDigest(normalizeRepositoryScope(savedScope, { requireExisting: false })) !== scopeDigest(normalizeRepositoryScope(pkg.repositoryScope, { requireExisting: false }))) throw new Error("Research package repositoryScope conflicts with the active run; use a new state and output root");
  const expected = normalizeCoverageProfile(pkg.stages["0"].coverageProfile);
  if (scopeDigest(canonical.summary.coverageProfile) !== scopeDigest(expected)) throw new Error("Research package coverageProfile conflicts with the active run; use a new state and output root");
  // Lineage, check history and pending input digests retain the originating representation.
  return { ...pkg, repositoryScope: structuredClone(savedScope) };
}

function assertPersistedContract(pkg, state, outputRoot) {
  continuationPackage(pkg, state, outputRoot);
}

function writeMetrics(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function existingMetrics(file, target) {
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value.schemaVersion === "full-run-metrics/1.0.0" && value.target === target && Array.isArray(value.stages) ? value : null;
  } catch { return null; }
}

async function runFullResearch(options) {
  const pkg = loadResearchPackage(options.package || options.packageFile);
  const stateFile = path.resolve(options.stateFile);
  const outputRoot = path.resolve(options.outputRoot);
  const metricsFile = path.resolve(options.metricsFile || path.join(outputRoot, "full-run-metrics.json"));
  let state = readState(stateFile);
  if (!state || (state.currentStage === 0 && !state.activeArtifacts?.some(row => Number(row.stage) === 0))) normalizeNewCoverageProfile(pkg.stages["0"].coverageProfile);
  if (!state) { new StateStore(stateFile).create(initialState("continuous")); state = readState(stateFile); }
  const stagePackage = continuationPackage(pkg, state, outputRoot);
  const started = performance.now();
  const metrics = existingMetrics(metricsFile, pkg.target) || { schemaVersion: "full-run-metrics/1.0.0", target: pkg.target, startedAt: new Date().toISOString(), stages: [], wallMs: 0 };
  const priorWallMs = metrics.wallMs || 0;
  while (true) {
    const action = planNextAction(state, state.currentStage <= 7 ? partialStatus(outputRoot, state.currentStage) : null);
    if (action.kind === "already-complete") return { status: "complete", action: action.kind, stateFile, outputRoot, metrics: metricsFile };
    if (action.kind === "stop") return { status: "partial", reason: action.reason, stage: state.currentStage, stateFile, outputRoot, metrics: metricsFile };
    const stageStarted = performance.now();
    try {
      if (action.kind === "run-stage" || action.kind === "retry-partial") {
        const result = await (options.runStagePipeline || runStagePipeline)({ request: materializeStageRequest(stagePackage, action.stage, state), stateFile, outputRoot });
        metrics.stages.push({ stage: action.stage, action: action.kind, status: result.status, wallMs: performance.now() - stageStarted });
        state = readState(stateFile);
        metrics.wallMs = priorWallMs + performance.now() - started; writeMetrics(metricsFile, metrics);
        if (result.status !== "closed") return { status: "partial", stage: action.stage, artifact: result.artifact, stateFile, outputRoot, metrics: metricsFile };
      } else if (action.kind === "run-stage-8") {
        const model = unwrapModel(JSON.parse(fs.readFileSync(state.stage7Artifact, "utf8")));
        const directory = path.join(outputRoot, "stage-8");
        (options.runStage8 || runStage8)(model, directory, state.canonicalDigest);
        const manifest = path.join(directory, "manifest.json");
        const session = InventorySession.open({ stateFile });
        session.advanceStage(8, manifest);
        state = readState(stateFile);
        metrics.stages.push({ stage: 8, action: action.kind, status: "closed", wallMs: performance.now() - stageStarted });
        metrics.wallMs = priorWallMs + performance.now() - started; writeMetrics(metricsFile, metrics);
      } else if (action.kind === "complete-run") {
        const session = InventorySession.open({ stateFile });
        validateStage8Manifest(session.state, session.state.canonicalArtifact);
        session.update(transitions.completeRun); session.commit();
        state = readState(stateFile);
        if (state.lastCompletedStage !== 8 || state.execution.runStatus !== "complete") throw new Error("Full run did not reach the terminal complete state");
        metrics.wallMs = priorWallMs + performance.now() - started; metrics.completedAt = new Date().toISOString(); writeMetrics(metricsFile, metrics);
      }
    } catch (error) {
      metrics.stages.push({ stage: action.stage ?? state.currentStage, action: action.kind, status: "error", wallMs: performance.now() - stageStarted, error: error.message });
      metrics.wallMs = priorWallMs + performance.now() - started; writeMetrics(metricsFile, metrics);
      throw error;
    }
  }
}

module.exports = { assertPersistedContract, loadResearchPackage, materializeStageRequest, planNextAction, runFullResearch };
