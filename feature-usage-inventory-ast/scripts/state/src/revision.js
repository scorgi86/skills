"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { initialState, stage, validateState } = require("./state_model.js");
const { readJson, sha256File } = require("./persistence.js");
const { validateCanonicalArtifactForAdvance } = require("./artifacts/canonical_validation.js");
const { withFileLock } = require("./file_transaction.js");

function createRevision(state, sourceState, options) {
  const requested = stage(options.stage);
  if (requested > 7) throw new Error("revise supports closed stages 0..7; Stage 8 is a read-only rendering");
  if (!options["output-state"]) throw new Error("Missing --output-state");
  if (typeof options.reason !== "string" || !options.reason.trim()) throw new Error("Revision requires --reason");
  const output = path.resolve(options["output-state"]);
  if (output === sourceState || fs.existsSync(output)) throw new Error("Revision output-state must be a different, non-existing file");
  if (requested > state.lastCompletedStage) throw new Error(`Revision stage ${requested} is not closed in the source state`);
  const active = state.activeArtifacts;
  const canonicalStages = Math.min(state.lastCompletedStage, 7) + 1;
  if (!Array.isArray(active) || active.length !== canonicalStages) throw new Error("Revision requires the complete original activeArtifacts lineage");
  for (let index = 0; index < active.length; index++) {
    const entry = active[index];
    if (entry.stage !== index || !entry.artifact) throw new Error("Revision source has an invalid activeArtifacts sequence");
    const artifact = readJson(entry.artifact);
    if (artifact.outputDigest !== entry.outputDigest) throw new Error(`Revision source stage ${index} digest changed`);
    validateCanonicalArtifactForAdvance(state, index, entry.artifact);
  }
  if (state.lastCompletedStage < 8 && (path.resolve(state.canonicalArtifact) !== path.resolve(active.at(-1).artifact) || state.canonicalArtifactDigest !== active.at(-1).outputDigest)) throw new Error("Revision source canonical tip differs from its active lineage");
  if (state.lastCompletedStage === 8) validateCanonicalArtifactForAdvance(state, 8, state.canonicalArtifact);
  const selected = active[requested];
  const next = initialState(state.execution.mode, state.execution.driver, state.goal?.objectiveDigest);
  next.goal = state.goal;
  next.activeArtifacts = active.slice(0, requested);
  next.lastCompletedStage = requested - 1;
  next.currentStage = requested;
  next.canonicalArtifact = requested ? active[requested - 1].artifact : null;
  next.canonicalArtifactDigest = requested ? active[requested - 1].outputDigest : null;
  next.openChecks = [...(state.openChecks || [])];
  next.probes = state.probes.filter(probe => probe.parentStage < requested);
  next.revision = {
    sourceState: path.resolve(sourceState),
    sourceStateDigest: sha256File(sourceState),
    sourceArtifact: path.resolve(selected.artifact),
    sourceArtifactDigest: selected.outputDigest,
    stage: requested,
    reason: options.reason.trim(),
    supersededArtifacts: active.slice(requested),
  };
  validateState(next);
  // Validate every argument and original before creating destination directories.
  fs.mkdirSync(path.dirname(output), { recursive: true });
  withFileLock(`${output}.lock`, () => {
    const temporary = `${output}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
      // link is an atomic create-if-absent publication; it cannot overwrite a racing writer.
      fs.linkSync(temporary, output);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  });
  return { state: next, output };
}

function assertReissuedArtifact(state, requested, artifactPath) {
  const superseded = state.revision?.supersededArtifacts?.find(entry => entry.stage === requested);
  if (!superseded) return;
  if (path.resolve(artifactPath) === path.resolve(superseded.artifact) || readJson(artifactPath).outputDigest === superseded.outputDigest) {
    throw new Error(`Stage ${requested} revision must reissue an artifact in a new location with a new digest; preserve the original`);
  }
}
module.exports = { createRevision, assertReissuedArtifact };
