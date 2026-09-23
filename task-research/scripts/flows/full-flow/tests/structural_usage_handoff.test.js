"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runStage5 } = require("../../../steps/step-5/src/runner");
const { canonicalFacts } = require("../../../shared/artifacts/src/canonical/facts.js");
const { buildPlanningProjection } = require("../../../shared/dto/src/planning_contract.js");
const { writeStageArtifact, readCanonicalStageResult } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { buildLineageFromPrevious } = require("../../../shared/artifacts/src/canonical/lineage.js");
const { writeCanonicalTransition } = require("../../../shared/dto/tests/test_helpers");
const { deriveStage7Input } = require("../src/derive_stage7_input.js");

test("a structural Stage 5 usage projects into confirmedUsages without path refs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-handoff-"));
  t_after(root);
  const source = path.join(root, "view.js");
  fs.writeFileSync(source, "api.apply(model.value);\n");
  const transition = writeCanonicalTransition(root, 4), hash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  const result = await runStage5({ stage: 5, transitionArtifact: transition, searchFromStage4: true, checks: [{ id: "check-a", familyId: "family-a", boundaryId: "boundary-a", term: "apply", file: source, patterns: [{ id: "apply", value: "apply", caseSensitive: true }] }], structuralChecks: [{ id: "check-a", familyId: "family-a", boundaryId: "boundary-a", term: "apply", file: source, sourceHash: hash, obligationRefs: [] }], nameCoverages: [], pathCandidates: [], pathDiscovery: { status: "complete", reasons: [], families: 0 } }, { runEvidenceChecks: () => ({ checks: [{ id: "check-a", resultComplete: true, truncated: false, errors: [], totalMatches: 1, fullMatches: [{ file: source, line: 1, endLine: 1, sourceFragment: "api.apply(model.value);", sourceHash: hash }] }] }) });
  const usage = result.confirmedUsages.find(row => !(row.pathRefs || []).length);
  assert.equal(Boolean(usage), true, "structural usage expected without path candidates");
  const projection = buildPlanningProjection([{ stage: 5, facts: canonicalFacts(result) }]);
  const projected = projection.confirmedUsages.find(row => row.id === usage.id);
  assert.equal(Boolean(projected), true);
  assert.equal(projected.status, "confirmed");
  assert.equal((projected.evidenceRefs || []).length, 1);
  assert.equal(projected.pathRefs, undefined);
});

function t_after(root) { process.on("exit", () => fs.rmSync(root, { recursive: true, force: true })); }

test("buildFromStage6 handoff selects evidence for a structural usage fact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-handoff-auto-"));
  t_after(root);
  const repositoryScope = { repositories: [{ id: "repository-a", root, role: "source" }] };
  const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  for (const name of ["a.js", "view.js"]) fs.writeFileSync(path.join(root, name), `const ${name.replace(/\W/g, "_")} = true;\n`);
  const usageEvidence = { id: "ev-usage", status: "source-confirmed", repository: "repository-a", file: "view.js", sourceHash: hash(path.join(root, "view.js")), line: 1, endLine: 1, sourceFragment: fs.readFileSync(path.join(root, "view.js"), "utf8").trimEnd() };
  const capabilityEvidence = { id: "ev-cap", status: "source-confirmed", repository: "repository-a", file: "a.js", sourceHash: hash(path.join(root, "a.js")), line: 1, endLine: 1, sourceFragment: fs.readFileSync(path.join(root, "a.js"), "utf8").trimEnd() };
  const files = [];
  for (const stage of [0, 1, 2, 3, 4, 5, 6]) {
    const artifact = path.join(root, `stage-${stage}`);
    const evidence = stage === 5 ? [usageEvidence, capabilityEvidence] : [capabilityEvidence];
    const facts = { stage, status: "closed", target: "feature", repositoryScope, summary: { target: "feature", lineage: stage ? buildLineageFromPrevious(files.at(-1), stage, repositoryScope, root) : [] }, capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-cap"] }], canonicalEvidence: evidence };
    if (stage === 5) facts.confirmedUsages = [{ id: "usage-ev-usage", name: "apply", statement: "Confirmed structural call/callee of apply in view.js", status: "confirmed", evidenceRefs: ["ev-usage"] }];
    const written = writeStageArtifact({ outputDir: artifact, facts, input: { stage } });
    files.push(written.resultFile);
  }
  const stage6 = readCanonicalStageResult(files[6]);
  const derived = deriveStage7Input(stage6, files, repositoryScope, "feature");
  assert.equal(derived.status, "complete");
  const stage5 = readCanonicalStageResult(files[5]);
  const usageFact = stage5.facts.find(row => row.kind === "confirmed-usage");
  assert.equal(Boolean(usageFact), true);
  assert.equal(usageFact.evidenceRefs.length, 1);
  const stage5Selector = derived.evidenceSelectors.find(row => path.resolve(row.artifact) === path.resolve(files[5]));
  assert.equal(Boolean(stage5Selector), true, "stage 5 artifact must be selected for the usage evidence");
  assert.deepEqual(stage5Selector.ids, usageFact.evidenceRefs);
  const stage0Selector = derived.evidenceSelectors.find(row => path.resolve(row.artifact) === path.resolve(files[0]));
  assert.equal(Boolean(stage0Selector), true, "stage 0 artifact must be selected for the capability evidence");
});
