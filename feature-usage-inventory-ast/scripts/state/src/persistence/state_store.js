"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteJson, withFileLock } = require("../file_transaction.js");
const { initialState, validateState } = require("../state_model.js");
const { SessionSnapshot } = require("../session/session_snapshot.js");

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readSnapshot(file) {
  const bytes = fs.readFileSync(file);
  const state = validateState(JSON.parse(bytes.toString("utf8")));
  return new SessionSnapshot(state, digest(bytes));
}

class StateStore {
  constructor(stateFile) {
    if (!stateFile) throw new Error("StateStore requires a state file");
    this.stateFile = path.resolve(stateFile);
    this.lockFile = `${this.stateFile}.lock`;
  }

  load() {
    return readSnapshot(this.stateFile);
  }

  commit(snapshot, draft) {
    if (!(snapshot instanceof SessionSnapshot) || !snapshot.digest) {
      throw new Error("StateStore commit requires a persisted SessionSnapshot");
    }
    return withFileLock(this.lockFile, () => this.commitLocked(snapshot, draft));
  }

  commitLocked(snapshot, draft) {
    const validated = validateState(structuredClone(draft));
    const current = readSnapshot(this.stateFile);
    if (current.digest !== snapshot.digest) {
      throw new Error(`State conflict: ${this.stateFile} changed after the session snapshot was loaded`);
    }
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    atomicWriteJson(this.stateFile, validated);
    return readSnapshot(this.stateFile);
  }
}

class NullStateStore {
  constructor(state = initialState()) {
    this.snapshot = new SessionSnapshot(validateState(state), null);
  }

  load() {
    return this.snapshot;
  }

  commit(_snapshot, draft) {
    this.snapshot = new SessionSnapshot(validateState(structuredClone(draft)), null);
    return this.snapshot;
  }
  commitLocked(snapshot, draft) { return this.commit(snapshot, draft); }
}

module.exports = { NullStateStore, StateStore, digest, readSnapshot };
