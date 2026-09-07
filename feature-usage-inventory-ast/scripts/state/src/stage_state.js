"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { fail, initialState, stage, assertCanonical, assertProbe } = require("./state_model.js");
const { writeJson, loadState, sha256File, readJson } = require("./persistence.js");
const { validateStage8Manifest } = require("./artifacts/stage8_validation.js");
const { validateCanonicalArtifactForAdvance } = require("./artifacts/canonical_validation.js");
function required(options, key) {
    if (!options[key]) fail(`Missing --${key}`);
    return options[key];
}
function parseArgs(argv) {
    const [command, ...rest] = argv;
    const options = {};
    for(let index = 0; index < rest.length; index += 1){
        const item = rest[index];
        if (!item.startsWith("--")) fail(`Unexpected argument: ${item}`);
        const key = item.slice(2);
        const value = rest[index + 1];
        if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
        options[key] = value;
        index += 1;
    }
    if (!command || ![
        "init",
        "revise",
        "status",
        "assert",
        "advance",
        "attach-probe",
        "continue-run",
        "checkpoint",
        "stop-run",
        "complete-run"
    ].includes(command)) {
        fail("Usage: node scripts/cli/src/commands/stage_state.js <init|revise|status|assert|advance|attach-probe|continue-run|checkpoint|stop-run|complete-run> --state <inventory-state.json> [...]");
    }
    return {
        command,
        options
    };
}
function artifact(file, label) {
    const resolved = path.resolve(required(file.options, "artifact"));
    if (!fs.existsSync(resolved)) fail(`${label} artifact does not exist: ${resolved}`);
    return resolved;
}
function summary(state, changed, kind) {
    return {
        status: "ok",
        kind,
        stateChanged: changed,
        currentStage: state.currentStage,
        lastCompletedStage: state.lastCompletedStage,
        canonicalArtifact: state.canonicalArtifact,
        canonicalDigest: state.canonicalDigest || null,
        execution: state.execution,
        goal: state.goal,
        resume: state.resume,
        probes: state.probes.map((probe)=>({
                id: probe.id,
                parentStage: probe.parentStage,
                artifact: probe.artifact
            })),
        revision: state.revision || null,
        openChecks: state.openChecks
    };
}
function runCommand(argv) {
    const parsed = parseArgs(argv);
    const stateFile = path.resolve(required(parsed.options, "state"));
    if (parsed.command === "init") {
        if (fs.existsSync(stateFile)) fail(`State already exists: ${stateFile}`);
        fs.mkdirSync(path.dirname(stateFile), {
            recursive: true
        });
        const objectiveDigest = parsed.options["objective-digest"] || null;
        const value = initialState(parsed.options.mode || "continuous", parsed.options.driver || (objectiveDigest ? "goal" : "interactive"), objectiveDigest);
        writeJson(stateFile, value);
        return summary(value, true, "init");
    }
    const state = loadState(stateFile);
    if (parsed.command === "revise") {
        const revised = require("./revision.js").createRevision(state, stateFile, parsed.options);
        return { ...summary(revised.state, true, "revision"), state: revised.output };
    }
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
        writeJson(stateFile, state);
        return summary(state, true, "continue-run");
    }
    if (parsed.command === "checkpoint") {
        const artifactPath = artifact(parsed, "checkpoint");
        const progressDigest = required(parsed.options, "progress-digest");
        state.resume = {
            stage: state.currentStage,
            status: "partial",
            artifact: artifactPath,
            progressDigest,
            nextAction: required(parsed.options, "next-action")
        };
        state.execution.lastProgressDigest = progressDigest;
        state.execution.runStatus = "stopped";
        state.execution.stopReason = parsed.options.reason || "partial-checkpoint";
        writeJson(stateFile, state);
        return summary(state, true, "checkpoint");
    }
    if (parsed.command === "stop-run") {
        const reason = required(parsed.options, "reason");
        const progressDigest = required(parsed.options, "progress-digest");
        const repeated = state.execution.stopReason === reason && state.execution.lastProgressDigest === progressDigest;
        state.execution.sameBlockerCount = repeated ? state.execution.sameBlockerCount + 1 : 1;
        state.execution.lastProgressDigest = progressDigest;
        state.execution.stopReason = reason;
        state.execution.runStatus = state.execution.driver === "goal" && state.execution.sameBlockerCount >= 3 ? "blocked" : "stopped";
        writeJson(stateFile, state);
        return summary(state, true, "stop-run");
    }
    if (parsed.command === "complete-run") {
        if (state.lastCompletedStage !== 8 || state.currentStage !== 9) fail("Inventory cannot complete before a closed Stage 8");
        if (!state.stage8ArtifactDigest || sha256File(state.canonicalArtifact) !== state.stage8ArtifactDigest) fail("Stage 8 manifest changed after canonical advance");
        validateStage8Manifest(state, state.canonicalArtifact);
        state.execution.runStatus = "complete";
        state.execution.stopReason = "stage-8-validated";
        state.resume = null;
        writeJson(stateFile, state);
        return summary(state, true, "complete-run");
    }
    const kind = parsed.options.kind || (parsed.command === "attach-probe" ? "bounded-probe" : "canonical-stage");
    if (![
        "canonical-stage",
        "bounded-probe"
    ].includes(kind)) fail("--kind must be canonical-stage or bounded-probe");
    const requested = stage(required(parsed.options, kind === "bounded-probe" ? "parent-stage" : "stage"), kind === "bounded-probe" ? "parent-stage" : "stage");
    if (kind === "canonical-stage" && parsed.command === "advance" && requested === state.lastCompletedStage
        && path.resolve(parsed.options.artifact || "") === state.canonicalArtifact && state.canonicalArtifactDigest) {
        const current = requested === 8 ? sha256File(state.canonicalArtifact) : readJson(state.canonicalArtifact).outputDigest;
        if (current !== state.canonicalArtifactDigest) fail("Previously advanced artifact changed");
        validateCanonicalArtifactForAdvance(state, requested, state.canonicalArtifact);
        return summary(state, false, kind);
    }
    if (kind === "canonical-stage") assertCanonical(state, requested);
    else assertProbe(state, requested);
    if (parsed.command === "assert") return summary(state, false, kind);
    const artifactPath = artifact(parsed, kind);
    if (kind === "bounded-probe") {
        const id = parsed.options.id || `probe-${state.probes.length + 1}`;
        if (state.probes.some((probe)=>probe.id === id)) fail(`Probe id already exists: ${id}`);
        state.probes.push({
            id,
            parentStage: requested,
            artifact: artifactPath
        });
        writeJson(stateFile, state);
        return summary(state, true, kind);
    }
    if (parsed.command !== "advance") fail("Only assert or advance are valid for canonical-stage");
    require("./revision.js").assertReissuedArtifact(state, requested, artifactPath);
    validateCanonicalArtifactForAdvance(state, requested, artifactPath);
    state.lastCompletedStage = requested;
    state.currentStage = requested + 1;
    state.canonicalArtifact = artifactPath;
    state.canonicalArtifactDigest = requested === 8 ? sha256File(artifactPath) : readJson(artifactPath).outputDigest;
    if (requested < 8) {
        const current = readJson(artifactPath);
        state.activeArtifacts = [...current.summary.lineage, { stage: requested, artifact: artifactPath, outputDigest: current.outputDigest }];
    }
    state.execution.stagesCompletedThisRun.push(requested);
    state.execution.sameBlockerCount = 0;
    state.execution.stopReason = null;
    state.resume = null;
    if (requested === 7) {
        const artifactValue = readJson(artifactPath);
        state.canonicalDigest = artifactValue.summary.reportModelDigest;
        state.stage7Artifact = artifactPath;
        state.stage7ArtifactDigest = artifactValue.outputDigest;
    }
    if (requested === 8) state.stage8ArtifactDigest = sha256File(artifactPath);
    writeJson(stateFile, state);
    return summary(state, true, kind);
}
function main(argv = process.argv.slice(2)) {
    const parsed = parseArgs(argv);
    if (["status", "assert"].includes(parsed.command)) return runCommand(argv);
    const file = path.resolve(required(parsed.options, "state"));
    return require("./file_transaction.js").withFileLock(`${file}.lock`, () => runCommand(argv));
}
module.exports = {
    main,
    parseArgs
};
