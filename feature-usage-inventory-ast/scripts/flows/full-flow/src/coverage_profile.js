"use strict";
const fs = require("node:fs");
const { normalizeCoverageProfile } = require("../../../shared/report/src/model/coverage.js");
const { scopeDigest } = require("../../../shared/artifacts/src/canonical/checks.js");
function coverageProfile(request, lineage = []) {
  if (Number(request.stage) === 0) {
    if (request.coverageProfile === undefined) throw new Error("Stage 0 requires an explicit coverageProfile: declare requiredCollections and lifecycle requiredCriticalPaths before research");
    return normalizeCoverageProfile(request.coverageProfile);
  }
  const original = lineage[0] && JSON.parse(fs.readFileSync(lineage[0].artifact, "utf8")).summary?.coverageProfile;
  if (original === undefined) {
    if (request.coverageProfile !== undefined) throw new Error("Legacy Stage 0 has no coverageProfile; reissue Stage 0 to establish coverage requirements");
    return undefined;
  }
  const profile = normalizeCoverageProfile(original);
  if (request.coverageProfile !== undefined && scopeDigest(normalizeCoverageProfile(request.coverageProfile)) !== scopeDigest(profile)) throw new Error("coverageProfile conflicts with Stage 0; reissue the run to change requirements");
  return profile;
}
module.exports = { coverageProfile };
