"use strict";

const { assertCanonical, assertProbe, validateState } = require("../state_model.js");

function copy(state) {
  return structuredClone(validateState(state));
}

function finish(state) {
  return validateState(state);
}

function continueRun(state, options = {}) {
  const next = copy(state);
  if (next.execution.runStatus === "complete") throw new Error("Completed inventory cannot continue");
  if (next.execution.runStatus === "blocked" && options.acknowledgeBlocker !== true) {
    throw new Error("Blocked inventory requires explicit acknowledgement after user input or an external-state change");
  }
  if (next.execution.driver === "goal" && options.objectiveDigest !== next.goal.objectiveDigest) {
    throw new Error("Goal objective digest changed; user confirmation is required");
  }
  next.execution.runStatus = "running";
  next.execution.continuationCount += 1;
  next.execution.stagesCompletedThisRun = [];
  next.execution.stopReason = null;
  if (options.acknowledgeBlocker === true) next.execution.sameBlockerCount = 0;
  return finish(next);
}

function checkpointRun(state, checkpoint) {
  const next = copy(state);
  next.resume = {
    stage: next.currentStage,
    status: "partial",
    artifact: checkpoint.artifact,
    progressDigest: checkpoint.progressDigest,
    nextAction: checkpoint.nextAction
  };
  next.execution.lastProgressDigest = checkpoint.progressDigest;
  next.execution.runStatus = "stopped";
  next.execution.stopReason = checkpoint.reason || "partial-checkpoint";
  return finish(next);
}

function stopRun(state, stop) {
  const next = copy(state);
  const repeated = next.execution.stopReason === stop.reason
    && next.execution.lastProgressDigest === stop.progressDigest;
  next.execution.sameBlockerCount = repeated ? next.execution.sameBlockerCount + 1 : 1;
  next.execution.lastProgressDigest = stop.progressDigest;
  next.execution.stopReason = stop.reason;
  next.execution.runStatus = next.execution.driver === "goal" && next.execution.sameBlockerCount >= 3
    ? "blocked" : "stopped";
  return finish(next);
}

function completeRun(state) {
  const next = copy(state);
  if (next.lastCompletedStage !== 8 || next.currentStage !== 9) {
    throw new Error("Inventory cannot complete before a closed Stage 8");
  }
  next.execution.runStatus = "complete";
  next.execution.stopReason = "stage-8-validated";
  next.resume = null;
  return finish(next);
}

function attachProbe(state, probe) {
  const next = copy(state);
  assertProbe(next, probe.parentStage);
  if (next.probes.some((item) => item.id === probe.id)) throw new Error(`Probe id already exists: ${probe.id}`);
  next.probes.push({ id: probe.id, parentStage: probe.parentStage, artifact: probe.artifact });
  return finish(next);
}

function advanceStage(state, command) {
  const next = copy(state);
  assertCanonical(next, command.stage);
  next.lastCompletedStage = command.stage;
  next.currentStage = command.stage + 1;
  next.canonicalArtifact = command.artifact;
  next.canonicalArtifactDigest = command.artifactDigest;
  if (command.activeArtifacts) next.activeArtifacts = structuredClone(command.activeArtifacts);
  next.execution.stagesCompletedThisRun.push(command.stage);
  next.execution.sameBlockerCount = 0;
  next.execution.stopReason = null;
  next.resume = null;
  if (command.stage === 7) {
    next.canonicalDigest = command.reportModelDigest;
    next.stage7Artifact = command.artifact;
    next.stage7ArtifactDigest = command.artifactDigest;
  }
  if (command.stage === 8) next.stage8ArtifactDigest = command.artifactDigest;
  return finish(next);
}

module.exports = { advanceStage, attachProbe, checkpointRun, completeRun, continueRun, stopRun };
