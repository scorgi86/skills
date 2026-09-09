"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), test = require("node:test");
const { normalizeRepositoryScope } = require("../src/repository_scope");
test("repository scope requires explicit roots and roles", () => { assert.throws(() => normalizeRepositoryScope({}), /Ask the user/); const root = fs.mkdtempSync(path.join(os.tmpdir(), "repository-scope-")); const value = normalizeRepositoryScope({ repositories: [{ id: "repository-a", root, role: "producer" }] }); assert.equal(value.repositories[0].root, root); });
