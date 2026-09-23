"use strict";

const path = require("node:path");
const { canonicalResultPath } = require("../../../shared/artifacts/src/artifact_location.js");

function effectiveStage7Request(session, request, stateFile, previous = null) {
  const active = stateFile ? session.assertStage(7).state : null;
  const artifactBase = request.artifactBase || process.cwd();
  const transitionArtifact = request.transitionArtifact
    ? canonicalResultPath(path.resolve(artifactBase, request.transitionArtifact))
    : active?.canonicalArtifact;
  if (active?.canonicalArtifact && transitionArtifact && transitionArtifact !== active.canonicalArtifact) {
    throw new Error("Transition artifact is not the active state revision");
  }
  const context = session.loadStageContext({
    stage: 7, previous, repositoryScope: request.repositoryScope,
    transitionArtifact: active?.canonicalArtifact || request.transitionArtifact,
    artifactBase: request.artifactBase
  });
  return {
    request: { ...request, ...(transitionArtifact ? { transitionArtifact } : {}), expectedArtifact: active?.canonicalArtifact },
    context,
    artifactBase
  };
}

module.exports = { effectiveStage7Request };
