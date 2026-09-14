"use strict";
const path = require("node:path");
const { createHash } = require("node:crypto");
const { planningError } = require("./planning_contract.js");

function sourceSurfaceIdentity(surface, repositoryScope) {
  const repositories = repositoryScope?.repositories || [];
  const repository = surface.repository == null && repositories.length === 1 ? repositories[0] : repositories.find(row => row.id === surface.repository);
  if (!repository?.root) planningError("referencePaths", surface.id, "repository", "Declare a surface repository inside repositoryScope; multiple roots cannot be guessed");
  const root = path.resolve(repository.root);
  if (typeof surface.path !== "string" || !surface.path.length) planningError("referencePaths", surface.id, "path", "Provide a source path");
  const relative = path.relative(root, path.resolve(root, surface.path));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) planningError("referencePaths", surface.id, "path", "Surface path must stay inside its repository root");
  if (!surface.layer || !surface.role) planningError("referencePaths", surface.id, "layer/role", "Provide a layer and role");
  const normalizedPath = relative.split(path.sep).join("/");
  const identity = [repository.id, normalizedPath, surface.layer, surface.role];
  const id = surface.id === undefined ? `source-surface:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}` : surface.id;
  if (typeof id !== "string" || !id.length) planningError("referencePaths", id, "id", "Provide a non-empty explicit id or omit it for generated surface identity");
  return { ...surface, id, repository: repository.id, path: normalizedPath };
}

module.exports = { sourceSurfaceIdentity };
