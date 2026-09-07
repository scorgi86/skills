"use strict";

const path = require("node:path");
const { validateState, assertCanonical } = require("../state_model.js");
const { NullStateStore, StateStore } = require("../persistence/state_store.js");
const { deepFreeze } = require("./session_snapshot.js");
const { StageUnitOfWork } = require("./stage_unit_of_work.js");
const transitions = require("../model/transitions.js");
const { readJson, sha256File } = require("../persistence.js");
const { validateCanonicalArtifactForAdvance } = require("../artifacts/canonical_validation.js");

const internals = new WeakMap();
const stageContexts = new WeakSet();

function isStageContext(value) { return Boolean(value && stageContexts.has(value)); }

function transitionForRequest(context, request, artifactBase = process.cwd()) {
  if (!isStageContext(context) || Number(request?.stage) !== context.stage || !context.transition || !request.transitionArtifact) return null;
  const canonicalResultPath = require("../../../shared/artifacts/src/artifact_location.js").canonicalResultPath;
  const requested = canonicalResultPath(path.resolve(artifactBase, request.transitionArtifact));
  return requested === context.readers.transitionArtifact ? context.transition : null;
}

function lineageForRequest(context, request, artifactBase = process.cwd()) {
  if (!isStageContext(context) || Number(request?.stage) !== context.stage || !Array.isArray(request?.priorArtifacts)) return null;
  if (request.priorArtifacts.some(item => typeof item !== "string")) return null;
  const canonicalResultPath = require("../../../shared/artifacts/src/artifact_location.js").canonicalResultPath;
  const requested = request.priorArtifacts.map(item => canonicalResultPath(path.resolve(artifactBase, typeof item === "string" ? item : item.artifact))).sort();
  const retained = context.readers.validatedPrior || [];
  const retainedFiles = retained.map(item => item.file).sort();
  if (requested.length !== retainedFiles.length || requested.some((file, index) => file !== retainedFiles[index])) return null;
  if (request.expectedArtifact && canonicalResultPath(path.resolve(artifactBase, request.expectedArtifact)) !== retained.at(-1)?.file) return null;
  const scopeDigest = require("../../../shared/artifacts/src/canonical/checks.js").scopeDigest;
  if (scopeDigest(request.repositoryScope || request.scope) !== scopeDigest(context.repositoryScope)) return null;
  return { prior: retained, lineage: context.lineage };
}

function stateProjection(state) {
  return {
    currentStage: state.currentStage,
    lastCompletedStage: state.lastCompletedStage,
    canonicalArtifact: state.canonicalArtifact,
    canonicalArtifactDigest: state.canonicalArtifactDigest,
    execution: state.execution,
    revision: state.revision || null
  };
}

function details(session) {
  const value = internals.get(session);
  if (!value) throw new TypeError("Invalid InventorySession receiver");
  return value;
}

function makeStageContext(session, metadata = {}) {
  const current = details(session);
  const context = deepFreeze({
    mode: current.stateless ? "stateless" : "stateful",
    stage: metadata.stage,
    state: current.stateless ? null : structuredClone(stateProjection(current.snapshot.state)),
    transition: metadata.transition === undefined ? null : structuredClone(metadata.transition),
    lineage: structuredClone(metadata.lineage || []),
    repositoryScope: structuredClone(metadata.repositoryScope || []),
    previous: metadata.previous === undefined ? null : structuredClone(metadata.previous),
    readers: { ...(metadata.readers || {}) }
  });
  stageContexts.add(context);
  return context;
}

class InventorySession {
  static open(options = {}) {
    const store = options.store || (options.stateFile
      ? new StateStore(options.stateFile)
      : new NullStateStore(options.initialState));
    return new InventorySession(store, store.load(), store instanceof NullStateStore);
  }

  constructor(store, snapshot, stateless = store instanceof NullStateStore) {
    internals.set(this, { store, snapshot, draft: structuredClone(snapshot.state), dirty: false, stateless });
  }

  get state() { return details(this).snapshot.state; }

  createStageContext(metadata = {}) {
    return makeStageContext(this, { stage: metadata.stage, repositoryScope: metadata.repositoryScope, previous: metadata.previous });
  }

  loadStageContext(metadata = {}) {
    const stage = Number(metadata.stage);
    const loaded = stage === 0 ? { prior: [], lineage: [], transition: null }
      : require("../../../shared/artifacts/src/canonical/lineage.js").loadLineageFromPrevious(metadata.transitionArtifact, stage, metadata.repositoryScope, metadata.artifactBase);
    return makeStageContext(this, { ...metadata, transition: loaded.transition, lineage: loaded.lineage,
      readers: { validatedPrior: loaded.prior, transitionArtifact: loaded.prior.at(-1)?.file || null } });
  }

  assertStage(stage) {
    assertCanonical(details(this).snapshot.state, stage);
    return this.createStageContext({ stage });
  }

  beginStage(options) { return new StageUnitOfWork(options).run(); }

  advanceStage(stage, artifact, options = {}) {
    const artifactPath = path.resolve(artifact);
    const current = details(this);
    const state = current.snapshot.state;
    if (stage === state.lastCompletedStage && artifactPath === state.canonicalArtifact && state.canonicalArtifactDigest) {
      const digest = stage === 8 ? sha256File(artifactPath) : readJson(artifactPath).outputDigest;
      if (digest !== state.canonicalArtifactDigest) throw new Error("Previously advanced artifact changed");
      validateCanonicalArtifactForAdvance(state, stage, artifactPath);
      return { snapshot: current.snapshot, changed: false };
    }
    require("../revision.js").assertReissuedArtifact(state, stage, artifactPath);
    validateCanonicalArtifactForAdvance(state, stage, artifactPath);
    const artifactDigest = stage === 8 ? sha256File(artifactPath) : readJson(artifactPath).outputDigest;
    let activeArtifacts;
    let reportModelDigest;
    if (stage < 8) {
      const artifactState = readJson(artifactPath);
      activeArtifacts = [...artifactState.summary.lineage, { stage, artifact: artifactPath, outputDigest: artifactState.outputDigest }];
      if (stage === 7) reportModelDigest = artifactState.summary.reportModelDigest;
    }
    this.update(transitions.advanceStage, { stage, artifact: artifactPath, artifactDigest, activeArtifacts, reportModelDigest });
    return { snapshot: this.commit(options), changed: true };
  }

  update(transition, ...args) {
    if (typeof transition !== "function") throw new TypeError("Session update requires a transition function");
    const current = details(this);
    current.draft = validateState(transition(current.draft, ...args));
    current.dirty = true;
    return structuredClone(current.draft);
  }

  commit(options = {}) {
    const current = details(this);
    if (!current.dirty) return current.snapshot;
    current.snapshot = options.lockHeld
      ? current.store.commitLocked(current.snapshot, current.draft)
      : current.store.commit(current.snapshot, current.draft);
    current.draft = structuredClone(current.snapshot.state);
    current.dirty = false;
    return current.snapshot;
  }

  discard() {
    const current = details(this);
    current.draft = structuredClone(current.snapshot.state);
    current.dirty = false;
  }
}

module.exports = { InventorySession, isStageContext, lineageForRequest, stateProjection, transitionForRequest };
