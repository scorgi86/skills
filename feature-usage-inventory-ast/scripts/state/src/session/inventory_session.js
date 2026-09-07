"use strict";

const path = require("node:path");
const { validateState } = require("../state_model.js");
const { NullStateStore, StateStore } = require("../persistence/state_store.js");
const { deepFreeze } = require("./session_snapshot.js");
const transitions = require("../model/transitions.js");
const { readJson, sha256File } = require("../persistence.js");
const { validateCanonicalArtifactForAdvance } = require("../artifacts/canonical_validation.js");

class InventorySession {
  static open(options = {}) {
    const store = options.store || (options.stateFile
      ? new StateStore(options.stateFile)
      : new NullStateStore(options.initialState));
    return new InventorySession(store, store.load());
  }

  constructor(store, snapshot) {
    this.store = store;
    this.snapshot = snapshot;
    this.draft = structuredClone(snapshot.state);
    this.isDirty = false;
  }

  get state() {
    return this.snapshot.state;
  }

  createStageContext(metadata = {}) {
    return deepFreeze({ ...structuredClone(metadata), state: structuredClone(this.snapshot.state) });
  }

  assertStage(stage) {
    require("../state_model.js").assertCanonical(this.snapshot.state, stage);
    return this.createStageContext({ stage });
  }

  advanceStage(stage, artifact, options = {}) {
    const artifactPath = path.resolve(artifact);
    const state = this.snapshot.state;
    if (stage === state.lastCompletedStage && artifactPath === state.canonicalArtifact && state.canonicalArtifactDigest) {
      const current = stage === 8 ? sha256File(artifactPath) : readJson(artifactPath).outputDigest;
      if (current !== state.canonicalArtifactDigest) throw new Error("Previously advanced artifact changed");
      validateCanonicalArtifactForAdvance(state, stage, artifactPath);
      return { snapshot: this.snapshot, changed: false };
    }
    require("../revision.js").assertReissuedArtifact(state, stage, artifactPath);
    validateCanonicalArtifactForAdvance(state, stage, artifactPath);
    const artifactDigest = stage === 8 ? sha256File(artifactPath) : readJson(artifactPath).outputDigest;
    let activeArtifacts;
    let reportModelDigest;
    if (stage < 8) {
      const current = readJson(artifactPath);
      activeArtifacts = [...current.summary.lineage, { stage, artifact: artifactPath, outputDigest: current.outputDigest }];
      if (stage === 7) reportModelDigest = current.summary.reportModelDigest;
    }
    this.update(transitions.advanceStage, { stage, artifact: artifactPath, artifactDigest, activeArtifacts, reportModelDigest });
    return { snapshot: this.commit(options), changed: true };
  }

  update(transition, ...args) {
    if (typeof transition !== "function") throw new TypeError("Session update requires a transition function");
    this.draft = validateState(transition(this.draft, ...args));
    this.isDirty = true;
    return structuredClone(this.draft);
  }

  commit(options = {}) {
    if (!this.isDirty) return this.snapshot;
    this.snapshot = options.lockHeld ? this.store.commitLocked(this.snapshot, this.draft) : this.store.commit(this.snapshot, this.draft);
    this.draft = structuredClone(this.snapshot.state);
    this.isDirty = false;
    return this.snapshot;
  }

  discard() {
    this.draft = structuredClone(this.snapshot.state);
    this.isDirty = false;
  }
}

module.exports = { InventorySession };
