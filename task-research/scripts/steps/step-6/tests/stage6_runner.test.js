"use strict";
const assert = require("node:assert/strict"); const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const test = require("node:test"); const { buildSummary, runStage6 } = require("../src/runner");
const { writeCanonicalTransition } = require("../../../shared/dto/tests/test_helpers");
test("stage 6 keeps full patch facts and returns bounded summary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage6-")); const transition = writeCanonicalTransition(root, 5);
  const replies = ["abc\u0000parent\u0000subject", ":100644 100644 aaaaaa bbbbbb M\tsrc/ui.js\ndiff --git a/src/ui.js b/src/ui.js\n@@ -1 +1 @@\n-old\n+new"];
  const result = runStage6({ stage: 6, transitionArtifact: transition, reference: { repo: root, ref: "ref" }, sourceSurfaces: [{ path: "src/ui.js", layer: "ui", role: "entry" }], openChecks: ["renderer"] }, { spawnSync: () => ({ status: 0, stdout: `${replies.shift()}\n` }) });
  assert.equal(result.reference.changedFiles, 1); assert.equal(result.sourceSurfaces[0].anchors.length, 1); const summary = buildSummary(result, path.join(root, "facts.json")); assert.equal(Object.hasOwn(summary, "transition"), false); assert.equal(summary.sourceSurfaces.changed, 1); assert.equal(summary.openChecks[0], "renderer");
});
test("stage 6 feature-reference does not require Git diff", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage6-ref-")); const transition = writeCanonicalTransition(root, 5);
  const result = runStage6({ stage: 6, mode: "feature-reference", transitionArtifact: transition, featureReference: { target: "new", referenceEntity: "known", capabilities: [{ id: "definition", status: "unchecked", evidenceRefs: [] }] }, sourceSurfaces: [{ path: "src/model.js", layer: "model", role: "storage" }] });
  assert.equal(result.mode, "feature-reference"); assert.equal(result.reference.referenceEntity, "known"); assert.equal(result.sourceSurfaces[0].confirmed, false);
});

test("stage 6 skip closes without reference inputs or fabricated paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage6-skip-"));
  const transition = writeCanonicalTransition(root, 5);
  const result = runStage6({ stage: 6, mode: "skip", transitionArtifact: transition });
  assert.equal(result.mode, "skip");
  assert.equal(result.transition.fields["next stage"], "7");
  assert.deepEqual(result.sourceSurfaces, []);
  assert.deepEqual(result.capabilities, [{ id: "reference", status: "not-applicable", reasonCode: "task-scope", explanation: "Reference comparison was not requested for this research", requiredForFinalReport: true }]);
  assert.equal(result.openChecks.length, 0);
  assert.equal(buildSummary(result, path.join(root, "facts.json")).sourceSurfaces.declared, 0);
});
test("stage 6 worktree-diff uses the declared base", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage6-worktree-")); const transition = writeCanonicalTransition(root, 5); let args;
  const result = runStage6({ stage: 6, mode: "worktree-diff", transitionArtifact: transition, reference: { repo: root, base: "main" }, sourceSurfaces: [{ path: "src/ui.js", layer: "ui", role: "entry" }] }, { spawnSync: (_git, passed) => { args = passed; return { status: 0, stdout: "" }; } });
  assert.equal(result.mode, "worktree-diff"); assert.equal(args.at(-1), "main");
});

test("reference surface identity includes repository, layer and role, not anchors", () => {
  const { canonicalFacts } = require("../../../shared/artifacts/src/canonical/facts.js");
  const root = path.resolve(os.tmpdir(), "surface-identity");
  const repositoryScope = { repositories: [{ id: "a", root: path.join(root, "a") }, { id: "b", root: path.join(root, "b") }] };
  const surfaces = [
    { repository: "a", path: "src/./file.js", layer: "model", role: "read" },
    { repository: "a", path: "src/file.js", layer: "model", role: "write" },
    { repository: "b", path: "src/file.js", layer: "model", role: "read" },
    { repository: "a", path: "src/file.js", layer: "ui", role: "read" }
  ];
  const facts = canonicalFacts({ stage: 6, repositoryScope, sourceSurfaces: surfaces });
  assert.equal(new Set(facts.map(row => row.id)).size, 4);
  const repeat = canonicalFacts({ stage: 6, repositoryScope, sourceSurfaces: [{ ...surfaces[0], path: "src/file.js", line: 90, status: "confirmed" }] })[0];
  assert.equal(repeat.id, facts[0].id);
  assert.equal(facts[0].path, "src/file.js");
  assert.throws(() => canonicalFacts({ stage: 6, repositoryScope, sourceSurfaces: [{ ...surfaces[0], repository: undefined }] }), /repository/);
  assert.throws(() => canonicalFacts({ stage: 6, repositoryScope, sourceSurfaces: [{ ...surfaces[0], path: "../outside.js" }] }), /path/);
});
