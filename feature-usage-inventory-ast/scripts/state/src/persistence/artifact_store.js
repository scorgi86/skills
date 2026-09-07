"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");

function readArtifact(directory) {
  const validation = validateStageArtifact(directory);
  if (!validation.ok) throw new Error(`Invalid stage artifact: ${validation.errors.join("; ")}`);
  const resultFile = path.join(directory, "canonical/stage-result.json");
  return { resultFile, canonical: JSON.parse(fs.readFileSync(resultFile, "utf8")) };
}

class ArtifactStore {
  read(directory) { return readArtifact(directory); }
  exists(directory) { return fs.existsSync(directory); }
  move(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); }
  remove(directory) { fs.rmSync(directory, { recursive: true, force: true }); }
  isEmpty(directory) { return fs.existsSync(directory) && fs.readdirSync(directory).length === 0; }
  removeEmpty(directory) { if (this.isEmpty(directory)) fs.rmdirSync(directory); }
}

module.exports = { ArtifactStore, readArtifact };
