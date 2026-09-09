"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { fail, initialState, stage, assertCanonical, assertProbe } = require("./state_model.js");
const { sha256File } = require("./persistence.js");
const { StateStore } = require("./persistence/state_store.js");
const { InventorySession } = require("./session/inventory_session.js");
const transitions = require("./model/transitions.js");
const { validateStage8Manifest } = require("./artifacts/stage8_validation.js");
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
        const objectiveDigest = parsed.options["objective-digest"] || null;
        const value = initialState(parsed.options.mode || "continuous", parsed.options.driver || (objectiveDigest ? "goal" : "interactive"), objectiveDigest);
        const created = new StateStore(stateFile).create(value);
        return summary(created.state, true, "init");
    }
    const session = InventorySession.open({ stateFile });
    const state = session.state;
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
        const next = session.update(transitions.continueRun, {
            acknowledgeBlocker: parsed.options["acknowledge-blocker"] === "true",
            objectiveDigest: parsed.options["objective-digest"]
        });
        session.commit();
        return summary(next, true, "continue-run");
    }
    if (parsed.command === "checkpoint") {
        const artifactPath = artifact(parsed, "checkpoint");
        const progressDigest = required(parsed.options, "progress-digest");
        const next = session.update(transitions.checkpointRun, { artifact: artifactPath, progressDigest,
            nextAction: required(parsed.options, "next-action"), reason: parsed.options.reason });
        session.commit();
        return summary(next, true, "checkpoint");
    }
    if (parsed.command === "stop-run") {
        const reason = required(parsed.options, "reason");
        const progressDigest = required(parsed.options, "progress-digest");
        const next = session.update(transitions.stopRun, { reason, progressDigest });
        session.commit();
        return summary(next, true, "stop-run");
    }
    if (parsed.command === "complete-run") {
        if (state.lastCompletedStage !== 8 || state.currentStage !== 9) fail("Inventory cannot complete before a closed Stage 8");
        if (!state.stage8ArtifactDigest || sha256File(state.canonicalArtifact) !== state.stage8ArtifactDigest) fail("Stage 8 manifest changed after canonical advance");
        validateStage8Manifest(state, state.canonicalArtifact);
        const next = session.update(transitions.completeRun);
        session.commit();
        return summary(next, true, "complete-run");
    }
    const kind = parsed.options.kind || (parsed.command === "attach-probe" ? "bounded-probe" : "canonical-stage");
    if (![
        "canonical-stage",
        "bounded-probe"
    ].includes(kind)) fail("--kind must be canonical-stage or bounded-probe");
    const requested = stage(required(parsed.options, kind === "bounded-probe" ? "parent-stage" : "stage"), kind === "bounded-probe" ? "parent-stage" : "stage");
    if (kind === "canonical-stage" && parsed.command === "advance" && requested === state.lastCompletedStage
        && path.resolve(parsed.options.artifact || "") === state.canonicalArtifact && state.canonicalArtifactDigest) {
        const advanced = session.advanceStage(requested, state.canonicalArtifact);
        return summary(advanced.snapshot.state, advanced.changed, kind);
    }
    if (kind === "canonical-stage") assertCanonical(state, requested);
    else assertProbe(state, requested);
    if (parsed.command === "assert") return summary(state, false, kind);
    const artifactPath = artifact(parsed, kind);
    if (kind === "bounded-probe") {
        const id = parsed.options.id || `probe-${state.probes.length + 1}`;
        if (state.probes.some((probe)=>probe.id === id)) fail(`Probe id already exists: ${id}`);
        const next = session.update(transitions.attachProbe, { id, parentStage: requested, artifact: artifactPath });
        session.commit();
        return summary(next, true, kind);
    }
    if (parsed.command !== "advance") fail("Only assert or advance are valid for canonical-stage");
    const advanced = session.advanceStage(requested, artifactPath);
    return summary(advanced.snapshot.state, advanced.changed, kind);
}
function main(argv = process.argv.slice(2)) {
    return runCommand(argv);
}
module.exports = {
    main,
    parseArgs
};
