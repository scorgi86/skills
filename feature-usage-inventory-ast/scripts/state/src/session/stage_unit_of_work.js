"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { digest } = require("../../../shared/artifacts/src/canonical/validation.js");
const { withFileLock } = require("../file_transaction.js");
const { ArtifactStore } = require("../persistence/artifact_store.js");
const { JournalStore } = require("../persistence/journal_store.js");

class StageUnitOfWork {
  constructor(options) {
    Object.assign(this, options);
    this.root = path.resolve(options.outputRoot);
    this.target = path.join(this.root, `stage-${this.stage}`);
    this.journal = new JournalStore(path.join(this.root, ".transactions", `stage-${this.stage}.json`));
    this.artifacts = options.artifactStore || new ArtifactStore();
    this.inputDigest = digest(this.request);
    this.statePath = this.stateFile ? path.resolve(this.stateFile) : null;
    this.inventoryLock = this.statePath ? `${this.statePath}.lock` : null;
  }

  run() {
    return withFileLock(`${this.journal.file}.lock`, () => this.runLocked());
  }

  runLocked() {
    const journal = this.loadOrPrepare();
    const attempt = path.join(this.root, ".attempts", `stage-${this.stage}`, journal.id);
    const prepared = path.join(attempt, "prepared");
    const archived = journal.archivePath || path.join(attempt, "previous");
    const commit = () => {
      let published = this.currentCandidate(journal);
      if (!published) published = this.publish(journal, prepared, archived);
      this.validateCandidate(published);
      journal.phase = "state-prepared";
      this.journal.write(journal);
      const response = this.advance(published, { lockHeld: Boolean(this.inventoryLock) });
      journal.phase = response.status === "partial" ? "artifact-committed" : "state-committed";
      this.journal.write(journal);
      this.journal.remove();
      if (!path.resolve(archived).startsWith(`${path.resolve(attempt)}${path.sep}`)) {
        this.artifacts.remove(attempt);
        this.artifacts.removeEmpty(path.dirname(attempt));
      }
      return response;
    };
    return this.inventoryLock ? withFileLock(this.inventoryLock, commit) : commit();
  }

  loadOrPrepare() {
    if (this.journal.exists()) {
      const journal = this.journal.read();
      const legacy = journal.version === 1;
      const phases = new Set(["prepared", "artifact-archived", "artifact-published", "state-prepared", "state-committed", "artifact-committed"]);
      if (legacy) {
        journal.version = 2;
        journal.phase = ({ archived: "artifact-archived", published: "artifact-published", advanced: "state-committed" })[journal.phase] || journal.phase;
        delete journal.archivePath;
      }
      if (journal.version !== 2 || journal.stage !== this.stage || journal.inputDigest !== this.inputDigest
          || journal.stateFile !== this.statePath || !/^[a-f0-9-]{36}$/.test(journal.id)
          || !/^[a-f0-9]{64}$/.test(journal.candidateDigest) || !phases.has(journal.phase)) {
        throw new Error("Pending transaction does not match request/state; resume its original request before starting another attempt");
      }
      const expectedArchive = path.join(this.root, ".history", `stage-${this.stage}`, journal.id);
      if (!legacy && path.resolve(journal.archivePath || "") !== path.resolve(expectedArchive)) {
        throw new Error("Pending transaction has an invalid archive path; preserve it for inspection and do not resume");
      }
      return journal;
    }
    let previous = null;
    if (this.artifacts.exists(this.target)) {
      previous = this.artifacts.read(this.target);
      if (previous.canonical.status === "closed") throw new Error(`Canonical stage already closed: ${this.target}`);
    }
    const id = randomUUID();
    const prepared = path.join(this.root, ".attempts", `stage-${this.stage}`, id, "prepared");
    const archived = path.join(this.root, ".history", `stage-${this.stage}`, id);
    try {
      this.prepare(prepared, previous, archived);
      const candidate = this.artifacts.read(prepared);
      this.validateCandidate(candidate);
      const journal = { version: 2, id, stage: this.stage, inputDigest: this.inputDigest,
        stateFile: this.statePath, phase: "prepared", candidateDigest: candidate.canonical.outputDigest, archivePath: archived };
      this.journal.write(journal);
      return journal;
    } catch (error) {
      this.artifacts.remove(path.dirname(prepared));
      throw error;
    }
  }

  currentCandidate(journal) {
    if (!this.artifacts.exists(this.target)) return null;
    const current = this.artifacts.read(this.target);
    return current.canonical.outputDigest === journal.candidateDigest ? current : null;
  }

  publish(journal, prepared, archived) {
    const candidate = this.artifacts.read(prepared);
    if (candidate.canonical.outputDigest !== journal.candidateDigest) throw new Error("Prepared artifact digest changed");
    this.validateCandidate(candidate);
    if (this.artifacts.exists(this.target)) {
      const previous = this.artifacts.read(this.target);
      if (previous.canonical.status === "closed" || this.artifacts.exists(archived)) throw new Error("Cannot replace existing closed or conflicting stage");
      this.artifacts.move(this.target, archived);
    }
    journal.phase = "artifact-archived";
    try {
      this.journal.write(journal);
      this.artifacts.move(prepared, this.target);
    } catch (error) {
      if (!this.artifacts.exists(this.target) && this.artifacts.exists(archived)) this.artifacts.move(archived, this.target);
      throw error;
    }
    journal.phase = "artifact-published";
    this.journal.write(journal);
    return this.artifacts.read(this.target);
  }
}

function runStageUnitOfWork(options) { return new StageUnitOfWork(options).run(); }

module.exports = { StageUnitOfWork, runStageUnitOfWork };
