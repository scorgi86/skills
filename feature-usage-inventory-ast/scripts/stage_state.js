"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "3.0.0";
const LEGACY_SCHEMA_VERSIONS = new Set(["1.0.0", "2.0.0"]);
const EXECUTION_MODES = new Set(["strict", "adaptive", "continuous"]);
const EXECUTION_DRIVERS = new Set(["interactive", "goal"]);
const CANONICAL_STAGES = new Set(Array.from({ length: 9 }, (_, index) => index));

function fail(message) { throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }
function writeJson(file, value) { fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`); }
function required(options, key) { if (!options[key]) fail(`Missing --${key}`); return options[key]; }
function stage(value, label = "stage") {
  const number = Number(value);
  if (!Number.isInteger(number) || !CANONICAL_STAGES.has(number)) fail(`${label} must be an integer from 0 to 8`);
  return number;
}
function executionMode(value) {
  if (!EXECUTION_MODES.has(value)) fail("mode must be strict, adaptive, or continuous");
  return value;
}
function executionDriver(value) {
  if (!EXECUTION_DRIVERS.has(value)) fail("driver must be interactive or goal");
  return value;
}
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) fail(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  if (!command || !["init", "adopt", "status", "assert", "advance", "attach-probe", "continue-run", "checkpoint", "stop-run", "complete-run"].includes(command)) {
    fail("Usage: stage_state.js <init|adopt|status|assert|advance|attach-probe|continue-run|checkpoint|stop-run|complete-run> --state <inventory-state.json> [...]");
  }
  return { command, options };
}
function initialState(mode, driver = "interactive", objectiveDigest = null) {
  if (!mode) fail("A full inventory requires an explicit execution mode: strict, adaptive, or continuous");
  const selectedDriver = executionDriver(driver);
  if (selectedDriver === "goal" && !objectiveDigest) fail("Goal execution requires --objective-digest");
  return {
    schemaVersion: SCHEMA_VERSION,
    execution: {
      mode: executionMode(mode),
      driver: selectedDriver,
      runStatus: "running",
      stagesCompletedThisRun: [],
      continuationCount: 0,
      lastProgressDigest: null,
      sameBlockerCount: 0,
      stopReason: null,
    },
    goal: selectedDriver === "goal" ? {
      objectiveDigest,
      completionCondition: "stage-8-validated",
    } : null,
    resume: null,
    lastCompletedStage: -1,
    currentStage: 0,
    canonicalArtifact: null,
    canonicalDigest: null,
    probes: [],
    openChecks: [],
  };
}
function validateState(value) {
  if (!value || (value.schemaVersion !== SCHEMA_VERSION && !LEGACY_SCHEMA_VERSIONS.has(value.schemaVersion))) fail("Unsupported or invalid inventory state");
  if (LEGACY_SCHEMA_VERSIONS.has(value.schemaVersion)) {
    const legacyMode = value.execution && EXECUTION_MODES.has(value.execution.mode) ? value.execution.mode : "strict";
    value.schemaVersion = SCHEMA_VERSION;
    value.execution = {
      mode: legacyMode,
      driver: "interactive",
      runStatus: "running",
      stagesCompletedThisRun: [],
      continuationCount: 0,
      lastProgressDigest: null,
      sameBlockerCount: 0,
      stopReason: "migrated-legacy-state",
    };
    value.goal = null;
    value.resume = null;
  }
  if (!value.execution || !EXECUTION_MODES.has(value.execution.mode)) fail("State requires execution.mode: strict, adaptive, or continuous");
  if (!EXECUTION_DRIVERS.has(value.execution.driver)) fail("State requires execution.driver: interactive or goal");
  if (!["running", "stopped", "blocked", "complete"].includes(value.execution.runStatus)) fail("State execution.runStatus is invalid");
  if (value.execution.driver === "goal" && (!value.goal || !value.goal.objectiveDigest)) fail("Goal state requires goal.objectiveDigest");
  if (!Array.isArray(value.execution.stagesCompletedThisRun)) fail("State execution.stagesCompletedThisRun must be an array");
  const completed = Number(value.lastCompletedStage);
  const current = Number(value.currentStage);
  if (!Number.isInteger(completed) || completed < -1 || completed > 8 || current !== completed + 1) fail("State has an invalid canonical stage sequence");
  if (value.execution.runStatus === "complete" && (completed !== 8 || current !== 9)) fail("Complete state requires a closed Stage 8 terminal state");
  if (!Array.isArray(value.probes)) fail("State probes must be an array");
  return value;
}
function loadState(file) {
  const value = readJson(file);
  const legacy = value && LEGACY_SCHEMA_VERSIONS.has(value.schemaVersion);
  const validated = validateState(value);
  if (legacy) writeJson(file, validated);
  return validated;
}
function assertCanonical(state, requestedStage) {
  if (requestedStage !== state.currentStage || requestedStage !== state.lastCompletedStage + 1) {
    fail(`Canonical stage ${requestedStage} is blocked: current stage is ${state.currentStage}, last completed stage is ${state.lastCompletedStage}`);
  }
}
function assertProbe(state, parentStage) {
  if (parentStage !== state.currentStage) {
    fail(`Bounded probe for parent stage ${parentStage} is blocked: current canonical stage is ${state.currentStage}`);
  }
}
function artifact(file, label) {
  const resolved = path.resolve(required(file.options, "artifact"));
  if (!fs.existsSync(resolved)) fail(`${label} artifact does not exist: ${resolved}`);
  return resolved;
}
function validateCanonicalArtifactForAdvance(state, stageNumber, artifactPath) {
  if (![7, 8].includes(stageNumber)) return;
  if (stageNumber === 8) {
    let manifest;
    try { manifest = readJson(artifactPath); } catch { fail("Stage 8 canonical artifact must be a JSON manifest"); }
    if (Number(manifest.stage) !== 8 || manifest.status !== "closed") fail("Stage 8 manifest must record stage 8 with closed status");
    if (!state.canonicalDigest || manifest.input?.canonicalDigest !== state.canonicalDigest) fail("Stage 8 manifest input digest must match the trusted Stage 7 digest");
    return;
  }
  let model;
  try { model = readJson(artifactPath); } catch { fail("Stage 7 canonical artifact must be a JSON report model"); }
  const { validateReportModel } = require("./report_model");
  const result = validateReportModel(model);
  if (!result.ok) fail(`Stage 7 cannot advance: ${result.errors.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
}
function summary(state, changed, kind) {
  return {
    status: "ok", kind, stateChanged: changed,
    currentStage: state.currentStage,
    lastCompletedStage: state.lastCompletedStage,
    canonicalArtifact: state.canonicalArtifact,
    canonicalDigest: state.canonicalDigest || null,
    execution: state.execution,
    goal: state.goal,
    resume: state.resume,
    probes: state.probes.map((probe) => ({ id: probe.id, parentStage: probe.parentStage, artifact: probe.artifact })),
    openChecks: state.openChecks,
  };
}
function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const stateFile = path.resolve(required(parsed.options, "state"));
  if (parsed.command === "init") {
    if (fs.existsSync(stateFile)) fail(`State already exists: ${stateFile}`);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const value = initialState(parsed.options.mode, parsed.options.driver || "interactive", parsed.options["objective-digest"] || null); writeJson(stateFile, value); return summary(value, true, "init");
  }
  if (parsed.command === "adopt") {
    if (fs.existsSync(stateFile)) fail(`State already exists: ${stateFile}`);
    const completed = stage(required(parsed.options, "completed-stage"), "completed-stage");
    const artifactPath = artifact(parsed, "adopted canonical");
    let facts;
    try { facts = readJson(artifactPath); } catch { fail("Adoption requires a JSON facts artifact"); }
    if (Number(facts.stage) !== completed) fail(`Adopted artifact stage ${facts.stage} does not match completed stage ${completed}`);
    const value = initialState(parsed.options.mode, parsed.options.driver || "interactive", parsed.options["objective-digest"] || null);
    value.lastCompletedStage = completed;
    value.currentStage = completed + 1;
    value.canonicalArtifact = artifactPath;
    value.adopted = true;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    writeJson(stateFile, value); return summary(value, true, "adopt");
  }
  const state = loadState(stateFile);
  if (parsed.command === "status") return summary(state, false, "status");
  if (parsed.command === "continue-run") {
    if (state.execution.runStatus === "complete") fail("Completed inventory cannot continue");
    if (state.execution.runStatus === "blocked" && parsed.options["acknowledge-blocker"] !== "true") {
      fail("Blocked inventory requires explicit --acknowledge-blocker true after user input or an external-state change");
    }
    if (state.execution.driver === "goal") {
      const currentDigest = required(parsed.options, "objective-digest");
      if (currentDigest !== state.goal.objectiveDigest) fail("Goal objective digest changed; user confirmation is required");
    }
    state.execution.runStatus = "running";
    state.execution.continuationCount += 1;
    state.execution.stagesCompletedThisRun = [];
    state.execution.stopReason = null;
    if (parsed.options["acknowledge-blocker"] === "true") state.execution.sameBlockerCount = 0;
    writeJson(stateFile, state); return summary(state, true, "continue-run");
  }
  if (parsed.command === "checkpoint") {
    const artifactPath = artifact(parsed, "checkpoint");
    const progressDigest = required(parsed.options, "progress-digest");
    state.resume = {
      stage: state.currentStage,
      status: "partial",
      artifact: artifactPath,
      progressDigest,
      nextAction: required(parsed.options, "next-action"),
    };
    state.execution.lastProgressDigest = progressDigest;
    state.execution.runStatus = "stopped";
    state.execution.stopReason = parsed.options.reason || "partial-checkpoint";
    writeJson(stateFile, state); return summary(state, true, "checkpoint");
  }
  if (parsed.command === "stop-run") {
    const reason = required(parsed.options, "reason");
    const progressDigest = required(parsed.options, "progress-digest");
    const repeated = state.execution.stopReason === reason && state.execution.lastProgressDigest === progressDigest;
    state.execution.sameBlockerCount = repeated ? state.execution.sameBlockerCount + 1 : 1;
    state.execution.lastProgressDigest = progressDigest;
    state.execution.stopReason = reason;
    state.execution.runStatus = state.execution.driver === "goal" && state.execution.sameBlockerCount >= 3 ? "blocked" : "stopped";
    writeJson(stateFile, state); return summary(state, true, "stop-run");
  }
  if (parsed.command === "complete-run") {
    if (state.lastCompletedStage !== 8 || state.currentStage !== 9) fail("Inventory cannot complete before a closed Stage 8");
    state.execution.runStatus = "complete";
    state.execution.stopReason = "stage-8-validated";
    state.resume = null;
    writeJson(stateFile, state); return summary(state, true, "complete-run");
  }
  const kind = parsed.options.kind || (parsed.command === "attach-probe" ? "bounded-probe" : "canonical-stage");
  if (!["canonical-stage", "bounded-probe"].includes(kind)) fail("--kind must be canonical-stage or bounded-probe");
  const requested = stage(required(parsed.options, kind === "bounded-probe" ? "parent-stage" : "stage"), kind === "bounded-probe" ? "parent-stage" : "stage");
  if (kind === "canonical-stage") assertCanonical(state, requested); else assertProbe(state, requested);
  if (parsed.command === "assert") return summary(state, false, kind);
  const artifactPath = artifact(parsed, kind);
  if (kind === "bounded-probe") {
    const id = parsed.options.id || `probe-${state.probes.length + 1}`;
    if (state.probes.some((probe) => probe.id === id)) fail(`Probe id already exists: ${id}`);
    state.probes.push({ id, parentStage: requested, artifact: artifactPath });
    writeJson(stateFile, state); return summary(state, true, kind);
  }
  if (parsed.command !== "advance") fail("Only assert or advance are valid for canonical-stage");
  validateCanonicalArtifactForAdvance(state, requested, artifactPath);
  state.lastCompletedStage = requested;
  state.currentStage = requested + 1;
  state.canonicalArtifact = artifactPath;
  state.execution.stagesCompletedThisRun.push(requested);
  state.execution.sameBlockerCount = 0;
  state.execution.stopReason = null;
  state.resume = null;
  if (requested === 7) state.canonicalDigest = readJson(artifactPath).integrity.canonicalDigest;
  writeJson(stateFile, state);
  return summary(state, true, kind);
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main())}\n`); }
  catch (error) { process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`); process.exitCode = 2; }
}

module.exports = { SCHEMA_VERSION, assertCanonical, assertProbe, initialState, main, parseArgs, validateState };
