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
test("stage 6 worktree-diff uses the declared base", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage6-worktree-")); const transition = writeCanonicalTransition(root, 5); let args;
  const result = runStage6({ stage: 6, mode: "worktree-diff", transitionArtifact: transition, reference: { repo: root, base: "main" }, sourceSurfaces: [{ path: "src/ui.js", layer: "ui", role: "entry" }] }, { spawnSync: (_git, passed) => { args = passed; return { status: 0, stdout: "" }; } });
  assert.equal(result.mode, "worktree-diff"); assert.equal(args.at(-1), "main");
});
