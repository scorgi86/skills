"use strict";
const { validateCanonicalStageResult } = require("../../../shared/artifacts/src/canonical/validation.js");
const { normalizeRepositoryScope } = require("../../../shared/dto/src/repository_scope.js");
const { scopeDigest } = require("../../../shared/artifacts/src/canonical/checks.js");

function deriveStage3Search(stage2, repositoryScope, profiles = []) {
  if (!validateCanonicalStageResult(stage2).ok || stage2.stage !== 2 || stage2.status !== "closed") throw new Error("Stage 3 search requires a valid closed Stage 2 artifact");
  const scope = normalizeRepositoryScope(repositoryScope, { requireExisting: false });
  if (scopeDigest(scope) !== scopeDigest(normalizeRepositoryScope(stage2.summary.repositoryScope, { requireExisting: false }))) throw new Error("Stage 3 search repository scope differs from Stage 2");
  const allowed = new Set(["id","languages","extensions","maxFiles","maxMatches","followSymlinks","excludeDirs","excludeFilePatterns"]);
  const configured = new Map((profiles || []).map(profile => {
    if (!profile?.id || Object.keys(profile).some(key => !allowed.has(key))) throw new Error("consumerSearchProfiles contains an unsupported field");
    if (scope.repositories.every(repo => repo.id !== profile.id || repo.role !== "consumer")) throw new Error(`consumerSearchProfiles references non-consumer repository ${profile.id}`);
    return [profile.id, profile];
  }));
  return { consumerScopes: scope.repositories.filter(repo => repo.role === "consumer").map(repo => ({ id: repo.id, scope: repo.root, ...(configured.get(repo.id) || {}) })) };
}
module.exports = { deriveStage3Search };
