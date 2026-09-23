"use strict";
const path = require("node:path");
const { validateCanonicalStageResult } = require("../../../shared/artifacts/src/canonical/validation.js");
const { normalizeRepositoryScope } = require("../../../shared/dto/src/repository_scope.js");
const { scopeDigest } = require("../../../shared/artifacts/src/canonical/checks.js");

const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const MAX_FILES_PER_REPOSITORY = 200;

function deriveStage1Search(stage0, repositoryScope) {
  const validation = validateCanonicalStageResult(stage0);
  if (!validation.ok || stage0.stage !== 0 || stage0.status !== "closed") throw new Error("Stage 1 search requires a valid closed Stage 0 artifact");
  const scope = normalizeRepositoryScope(repositoryScope, { requireExisting: false });
  const priorScope = normalizeRepositoryScope(stage0.summary.repositoryScope, { requireExisting: false });
  if (scopeDigest(scope) !== scopeDigest(priorScope)) throw new Error("Stage 1 search repository scope differs from Stage 0");
  if (stage0.summary.executionScope?.scanSeeds !== true) throw new Error("Stage 1 search requires Stage 0 scanSeeds: true");
  const seeds = stage0.summary.seeds;
  if (!Array.isArray(seeds) || !seeds.length || seeds.some(seed => typeof seed !== "string" || !seed.trim())) throw new Error("Stage 0 direct seeds are missing");
  if (seeds.some(seed => seed.includes(","))) throw new Error("Stage 1 automatic search does not support a direct seed containing a comma");
  const scans = stage0.summary.repos;
  if (!Array.isArray(scans) || scans.length !== scope.repositories.length) throw new Error("Stage 0 repository scan summary is incomplete");
  const candidates = stage0.facts.filter(row => row.kind === "candidate-file");
  const astQueries = [], sourceChecks = [];
  let seenCandidates = 0;
  for (const [index, repo] of scope.repositories.entries()) {
    const scan = scans[index];
    if (scan.id !== repo.id || scan.status !== "candidate") throw new Error(`Stage 0 ${repo.id} scan is ${scan.status || "missing"}; no automatic Stage 1 search`);
    const allFiles = candidates.filter(row => row.repository === repo.id).map(row => row.file);
    if (!allFiles.length || scan.files !== allFiles.length) throw new Error(`Stage 0 ${repo.id} has no candidate files or an inconsistent file count`);
    if (new Set(allFiles).size !== allFiles.length) throw new Error(`Stage 0 ${repo.id} contains duplicate candidate files`);
    seenCandidates += allFiles.length;
    for (const file of allFiles) {
      if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error(`Stage 0 ${repo.id} candidate file is not absolute`);
      const relative = path.relative(repo.root, file);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Stage 0 ${repo.id} candidate file is outside repository scope`);
    }
    const files = allFiles.filter(file => EXTENSIONS.has(path.extname(file).toLowerCase()));
    if (files.length > MAX_FILES_PER_REPOSITORY) throw new Error(`Stage 0 ${repo.id} exceeds the automatic Stage 1 file limit of ${MAX_FILES_PER_REPOSITORY}`);
    if (!files.length) continue;
    files.sort();
    const id = `stage0-seeds-${repo.id}`;
    astQueries.push({ id, command: "find", files, options: { terms: seeds.join(",") } });
    sourceChecks.push({ id, repository: repo.id, files, extensions: [...EXTENSIONS], maxFiles: files.length,
      patterns: seeds.map(value => ({ value, regex: false })) });
  }
  if (candidates.length !== seenCandidates) throw new Error("Stage 0 has candidate files outside the declared repository scope");
  if (!astQueries.length) throw new Error("Stage 0 has no JS/TS candidate files for automatic Stage 1 search");
  return { ast: { queries: astQueries }, evidence: { checks: sourceChecks } };
}

module.exports = { deriveStage1Search };
