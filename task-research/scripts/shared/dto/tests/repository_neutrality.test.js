"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { normalizeRepositoryScope } = require("../src/repository_scope");

const root = path.resolve(require("node:path").resolve(__dirname, "../../.."), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("skill requires caller-declared search roots without a built-in repository layout", () => {
  const skill = read("SKILL.md");
  const scopeReference = read(path.join("references", "repository-scope.md"));
  assert.match(skill, /require explicit search roots/i);
  assert.match(skill, /ask the user for the folders to search/i);
  assert.match(scopeReference, /do not infer repository names/i);
  assert.throws(() => normalizeRepositoryScope({}, { requireExisting: false }), /Search roots are required/);
});

test("portable instructions do not embed host-specific absolute paths", () => {
  const files = [
    "SKILL.md",
    path.join("references", "repository-scope.md"),
    path.join("references", "ast-workflow.md"),
    path.join("references", "gitnexus-workflow.md"),
  ];
  for (const file of files) {
    const contents = read(file);
    assert.doesNotMatch(contents, /[A-Za-z]:[\\/]/, file);
    assert.doesNotMatch(contents, /\/(?:home|Users|workspace)\//, file);
  }
});

test("undeclared layers stay unclassified", () => {
  const inventorySearch = read(path.join("scripts", "shared", "search", "src", "inventory_search.js"));
  const searchMatrix = read(path.join("scripts", "shared", "search", "src", "feature_search_matrix.js"));
  assert.match(inventorySearch, /return "unclassified"/);
  assert.match(searchMatrix, /return "unclassified"/);
});
