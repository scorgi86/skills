"use strict";
const SCHEMA_VERSION = "4.0.0";
const EXECUTION_MODES = new Set([
    "strict",
    "adaptive",
    "continuous"
]);
const EXECUTION_DRIVERS = new Set([
    "interactive",
    "goal"
]);
const CANONICAL_STAGES = new Set(Array.from({
    length: 9
}, (_, index)=>index));
function fail(message) {
    throw new Error(message);
}
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
function initialState(mode = "continuous", driver = "interactive", objectiveDigest = null) {
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
            stopReason: null
        },
        goal: selectedDriver === "goal" ? {
            objectiveDigest,
            completionCondition: "stage-8-validated"
        } : null,
        resume: null,
        lastCompletedStage: -1,
        currentStage: 0,
        canonicalArtifact: null,
        canonicalDigest: null,
        stage7Artifact: null,
        stage7ArtifactDigest: null,
        stage8ArtifactDigest: null,
        probes: [],
        openChecks: []
    };
}
function validateState(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION) fail("Unsupported or invalid inventory state; schema 4.0.0 is required");
    if (!value.execution || !EXECUTION_MODES.has(value.execution.mode)) fail("State requires execution.mode: strict, adaptive, or continuous");
    if (!EXECUTION_DRIVERS.has(value.execution.driver)) fail("State requires execution.driver: interactive or goal");
    if (![
        "running",
        "stopped",
        "blocked",
        "complete"
    ].includes(value.execution.runStatus)) fail("State execution.runStatus is invalid");
    if (value.execution.driver === "goal" && (!value.goal || !value.goal.objectiveDigest)) fail("Goal state requires goal.objectiveDigest");
    if (!Array.isArray(value.execution.stagesCompletedThisRun)) fail("State execution.stagesCompletedThisRun must be an array");
    const completed = Number(value.lastCompletedStage);
    const current = Number(value.currentStage);
    if (!Number.isInteger(completed) || completed < -1 || completed > 8 || current !== completed + 1) fail("State has an invalid canonical stage sequence");
    if (value.execution.runStatus === "complete" && (completed !== 8 || current !== 9)) fail("Complete state requires a closed Stage 8 terminal state");
    if (!Array.isArray(value.probes)) fail("State probes must be an array");
    return value;
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
module.exports = {
    SCHEMA_VERSION,
    assertCanonical,
    assertProbe,
    initialState,
    validateState,
    fail,
    stage
};
