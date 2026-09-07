const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { digest } = require("../../../shared/artifacts/src/canonical/validation.js");
const { validateStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { atomicWriteJson, withFileLock } = require("../../../state/src/file_transaction.js");

function artifactAt(directory) {
  const validation = validateStageArtifact(directory);
  if (!validation.ok) throw new Error(`Invalid stage artifact: ${validation.errors.join("; ")}`);
  const resultFile = path.join(directory, "canonical/stage-result.json");
  return { resultFile, canonical: JSON.parse(fs.readFileSync(resultFile, "utf8")) };
}

// Only this stage's prepare/archive/publish/advance transaction is journaled.
function runTransaction({ outputRoot, stage, request, stateFile, prepare, advance, validateCandidate = () => {} }) {
  const root = path.resolve(outputRoot);
  const target = path.join(root, `stage-${stage}`);
  const journalFile = path.join(root, ".transactions", `stage-${stage}.json`);
  const inputDigest = digest(request);
  const statePath = stateFile ? path.resolve(stateFile) : null;
  return withFileLock(`${journalFile}.lock`, () => {
    let journal;
    if (fs.existsSync(journalFile)) {
      journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
      if (journal.version !== 1 || journal.stage !== stage || journal.inputDigest !== inputDigest || journal.stateFile !== statePath
          || !/^[a-f0-9-]{36}$/.test(journal.id) || !/^[a-f0-9]{64}$/.test(journal.candidateDigest)) {
        throw new Error("Pending transaction does not match request/state; resume its original request before starting another attempt");
      }
    } else {
      let previous = null;
      if (fs.existsSync(target)) {
        previous = artifactAt(target);
        if (previous.canonical.status === "closed") throw new Error(`Canonical stage already closed: ${target}`);
      }
      const id = randomUUID();
      const prepared = path.join(root, ".attempts", `stage-${stage}`, id, "prepared");
      try {
        prepare(prepared, previous, path.join(path.dirname(prepared), "previous"));
        const candidate = artifactAt(prepared);
        validateCandidate(candidate);
        journal = { version: 1, id, stage, inputDigest, stateFile: statePath, phase: "prepared", candidateDigest: candidate.canonical.outputDigest };
        atomicWriteJson(journalFile, journal);
      } catch (error) {
        // The directory is constructed here under this unique attempt, never supplied by an artifact.
        fs.rmSync(path.dirname(prepared), { recursive: true, force: true });
        throw error;
      }
    }
    const attempt = path.join(root, ".attempts", `stage-${stage}`, journal.id);
    const prepared = path.join(attempt, "prepared");
    const archived = path.join(attempt, "previous");
    let published = null;
    if (fs.existsSync(target)) {
      const current = artifactAt(target);
      if (current.canonical.outputDigest === journal.candidateDigest) published = current;
    }
    if (!published) {
      const candidate = artifactAt(prepared);
      if (candidate.canonical.outputDigest !== journal.candidateDigest) throw new Error("Prepared artifact digest changed");
      validateCandidate(candidate);
      if (fs.existsSync(target)) {
        const previous = artifactAt(target);
        if (previous.canonical.status === "closed" || fs.existsSync(archived)) throw new Error("Cannot replace existing closed or conflicting stage");
        fs.renameSync(target, archived);
      }
      journal.phase = "archived";
      try {
        atomicWriteJson(journalFile, journal);
        fs.renameSync(prepared, target);
      } catch (error) {
        if (!fs.existsSync(target) && fs.existsSync(archived)) fs.renameSync(archived, target);
        throw error;
      }
      published = artifactAt(target);
    }
    validateCandidate(published);
    journal.phase = "published";
    atomicWriteJson(journalFile, journal);
    const response = advance(published);
    journal.phase = "advanced";
    atomicWriteJson(journalFile, journal);
    fs.unlinkSync(journalFile);
    if (fs.existsSync(attempt) && fs.readdirSync(attempt).length === 0) fs.rmdirSync(attempt);
    return response;
  });
}
module.exports = { runTransaction };
