"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { InventorySession } = require("../../../state/src/session/inventory_session.js");
const { normalizeRepositoryScope } = require("../../../shared/dto/src/repository_scope.js");
const { effectiveStage7Request } = require("./effective_stage7_request.js");

function preflightStageRequest(request, options = {}) {
  const stage = request?.stage;
  const outputRoot = options.outputRoot && path.resolve(options.outputRoot);
  try {
    if (!request || typeof request !== "object" || Array.isArray(request) || !Number.isInteger(Number(stage)) || Number(stage) < 0 || Number(stage) > 7) {
      throw new Error("Pipeline request requires stage 0..7");
    }
    if (!outputRoot) throw new Error("Preflight requires resolved outputRoot");
    normalizeRepositoryScope(request.repositoryScope, { requireExisting: request.requireExistingRoots !== false });
    if (Number(stage) === 0) {
      require("../../../steps/step-0/src/execution_scope.js").resolveExecutionScope(request);
      require("./coverage_profile.js").coverageProfile(request);
    }
    if (Number(stage) === 0 && !options.runnerInjected && (!Array.isArray(request.seeds?.direct) || !request.seeds.direct.length
      || request.seeds.direct.some(seed => typeof seed !== "string" || !seed.trim()))) {
      throw new Error("Stage 0 requires non-empty string seeds.direct");
    }
    if (fs.existsSync(path.join(outputRoot, ".transactions", `stage-${stage}.json`))) {
      return { status: "deferred", stage: Number(stage), outputRoot, errors: [] };
    }
    if (Number(stage) === 4 && request.searchFromStage3 !== true && (!options.runnerInjected || request.recipientFamilies !== undefined)) {
      require("../../../steps/step-4/src/runner.js").normalizeFamilies(request);
    }
    if (Number(stage) === 6 && Array.isArray(request.sourceSurfaces)) {
      const repositories = request.repositoryScope.repositories;
      for (const [index, surface] of request.sourceSurfaces.entries()) {
        const known = repositories.some(repository => repository.id === surface?.repository);
        if (!known && !(surface?.repository == null && repositories.length === 1)) {
          throw new Error(`sourceSurfaces[${index}].repository must identify a repository in repositoryScope; multiple roots cannot be guessed`);
        }
      }
    }
    if (Number(stage) === 7 && (!options.runnerInjected || Array.isArray(request.priorArtifacts))) {
      const session = InventorySession.open(options.stateFile ? { stateFile: options.stateFile } : {});
      const effective = effectiveStage7Request(session, request, options.stateFile);
      require("../../../steps/step-7/src/runner.js").buildStage7(effective.request,
        { artifactBase: effective.artifactBase, expectedArtifact: effective.request.expectedArtifact }, effective.context);
    }
    return { status: "ok", stage: Number(stage), outputRoot, errors: [] };
  } catch (error) {
    return { status: "error", stage: Number.isInteger(Number(stage)) ? Number(stage) : null, outputRoot: outputRoot || null,
      errors: [{ code: "request-invalid", path: "$", message: error.message }] };
  }
}

module.exports = { preflightStageRequest };
