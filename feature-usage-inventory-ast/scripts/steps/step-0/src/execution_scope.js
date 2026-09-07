"use strict";

const path = require("node:path");
const { normalizeRepositoryScope } = require("../../../shared/dto/src/repository_scope");

function nonemptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a nonempty string`);
}

function exclusionRules(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of nonempty strings`);
  for (const rule of value) nonemptyString(rule, field);
  return [...new Set(value)];
}

function resolveExecutionScope(request) {
  if (!request?.repositoryScope) {
    throw new Error('Stage 0 requires repositoryScope. Migrate the request to include "repositoryScope":{"repositories":[{"id":"repo","root":"/path/to/repo","role":"source","exclusions":[]}]}; repos is optional and must match this scope.');
  }
  const rows = request.repositoryScope.repositories;
  if (!Array.isArray(rows) || !rows.length) throw new Error("repositoryScope.repositories must be a nonempty array");
  for (const row of rows) {
    for (const field of ["id", "root", "role"]) nonemptyString(row?.[field], `repositoryScope repository ${field}`);
    exclusionRules(row.exclusions, `repository ${row.id} exclusions`);
  }
  const repositories = normalizeRepositoryScope(request.repositoryScope, { requireExisting: request.requireExistingRoots !== false }).repositories;
  if (request.repos !== undefined) {
    if (!Array.isArray(request.repos) || request.repos.length !== repositories.length) throw new Error("repos must match repositoryScope exactly by id and root");
    const ids = new Set();
    for (const repo of request.repos) {
      nonemptyString(repo?.id, "repos id");
      nonemptyString(repo?.path, "repos path");
      const canonical = repositories.find((row) => row.id === repo.id);
      if (ids.has(repo.id) || !canonical || path.resolve(repo.path) !== canonical.root) throw new Error("repos must match repositoryScope exactly by unique id and root");
      ids.add(repo.id);
    }
  }
  const exclusions = exclusionRules(request.exclusions, "exclusions");
  for (const rule of exclusions) {
    if (repositories.some((repo) => !repo.exclusions.includes(rule))) throw new Error(`Global exclusion ${rule} must occur in every repositoryScope repository`);
  }
  return {
    repositories,
    repos: repositories.map(({ id, root, exclusions }) => ({ id, path: root, exclusions })),
    exclusions,
    descriptor: { version: 1, scanSeeds: request.scanSeeds !== false, repositories: repositories.map(({ id, root, exclusions }) => ({ id, root, exclusions })) },
  };
}

module.exports = { resolveExecutionScope };
