"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildStage7, buildSummary, formatFacts } = require("../src/runner");
const { compareStage7Facts } = require("../src/stage7_equivalence_gate");
const { writeStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4");
function fixture(coverageProfile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage7-"));
  const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  for (const name of ["a.js", "b.js", "plan.js"]) fs.writeFileSync(path.join(root, name), `const ${name.replace(/\W/g, "_")} = true;\n`);
  const sourceEvidence = ["a.js", "b.js"].map((file, index) => ({ id: `ev-${index + 1}`, status: "source-confirmed", repository: "repository-a", file, sourceHash: hash(path.join(root, file)), line: 1, endLine: 1, sourceFragment: fs.readFileSync(path.join(root, file), "utf8").trimEnd(), symbol: file[0].toUpperCase() }));
  const absence = { id: "ev-absence", status: "checked-no-usage", evidenceKind: "absence", repository: "repository-a", searchScope: "tests/**/*.js", expectedNames: ["setFeature"], reason: "peer API requires a setter", performedChecks: ["text", "AST"], ordersChecked: ["second", "third"], linkingMethodsChecked: ["factory"], resultComplete: true, resultTruncated: false, consequence: "test coverage gap remains" };
  const stages = [0, 1, 2, 3, 4, 5, 6], files = [], artifacts = [];
  const repositoryScope = { repositories: [{ id: "repository-a", root, role: "source" }] };
  for (const stage of stages) {
    const artifact = path.join(root, `stage-${stage}`), evidence = [...sourceEvidence, absence];
    const written = writeStageArtifact({ outputDir: artifact, facts: { stage, status: "closed", repositoryScope, summary: { ...(coverageProfile ? { coverageProfile } : {}), lineage: stage ? require("../../../shared/artifacts/src/canonical/lineage.js").buildLineageFromPrevious(files.at(-1),stage,repositoryScope) : [] }, capabilities: stage === 2 ? [] : [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-1"] }], canonicalEvidence: stage === 2 ? [] : evidence }, input: { stage } });
    files.push(written.resultFile); artifacts.push(artifact);
  }
  return { root, files, request: { stage: 7, target: "feature", scope: { repositories: [{ id: "repository-a", root, role: "source" }] }, priorArtifacts: files, evidenceSelectors: [{ artifact: artifacts[0], limit: 10 }], confirmedUsages: [{ id: "use-2", evidenceRefs: ["ev-2"] }, { id: "use-1", evidenceRefs: ["ev-1"] }], checkedNoUsage: [{ id: "absence-1", status: "checked-no-usage", evidenceRefs: ["ev-absence"], expectedNames: ["setFeature"], reason: "peer API requires a setter", repository: "repository-a", searchScope: "tests/**/*.js", performedChecks: ["text", "AST"], ordersChecked: ["second", "third"], linkingMethodsChecked: ["factory"], resultComplete: true, resultTruncated: false, consequence: "test coverage gap remains" }], referenceOnly: [], noise: [], openChecks: [], transition: { "next stage": "8" } } };
}
test("stage 7 emits a closed canonical report model", () => { const { root, request } = fixture(), model = buildStage7(request); assert.equal(model.modelType, "inventory-report-model"); assert.equal(model.status, "closed"); assert.equal(buildSummary(model, path.join(root, "model.json")).counts.retainedArtifacts, 7); assert.equal(compareStage7Facts(model, JSON.parse(JSON.stringify(model))).status, "equivalent"); });
test("stage 7 is deterministic for shuffled input", () => { const { request } = fixture(); const first = buildStage7(request); const second = buildStage7({ ...request, confirmedUsages: [...request.confirmedUsages].reverse() }); assert.equal(formatFacts(first), formatFacts(second)); assert.equal(first.integrity.canonicalDigest, second.integrity.canonicalDigest); });
test("stage 7 rejects evidence-free confirmed usage", () => { const { request } = fixture(); assert.throws(() => buildStage7({ ...request, confirmedUsages: [{ id: "bad" }] }), /evidenceRefs/); });
test("stage 7 rejects a full evidence index in its request", () => { const { request } = fixture(); assert.throws(() => buildStage7({ ...request, evidenceIndex: [{ id: "ev-direct" }] }), /bounded canonical evidence selectors/); });
test("stage 7 rejects incomplete chains, wrong active tip, and unresolved questions",()=>{
 const {request,files}=fixture();
 assert.throws(()=>buildStage7({...request,priorArtifacts:files.slice(1)}),/reissue/);
 assert.throws(()=>buildStage7({...request,expectedArtifact:files[5]}),/active state/);
 assert.throws(()=>buildStage7({...request,openChecks:["pending"]}),/unresolved openChecks/);
});
test("stage 7 does not reuse a validated context for different prior artifacts",()=>{
 const {files,request}=fixture();
 const context=require("../../../state/src/session/inventory_session.js").InventorySession.open().loadStageContext({stage:7,transitionArtifact:files[6],repositoryScope:request.scope});
 assert.throws(()=>buildStage7({...request,priorArtifacts:["bogus-only-one"]},{},context),/reissue|cannot read|requires exactly/);
 const descriptors=files.map((artifact,stage)=>({artifact,stage,outputDigest:"0".repeat(64),scopeDigest:"0".repeat(64)}));
 assert.throws(()=>buildStage7({...request,priorArtifacts:descriptors},{},context),/descriptor stage\/digest\/scope/);
 assert.throws(()=>buildStage7(request,{expectedArtifact:files[5]},context),/active state/);
 assert.throws(()=>buildStage7(request,{expectedArtifacts:files.slice(0,6)},context),/active state revision/);
});
test("stage 7 preserves an inherited checked-no-usage capability", () => { const { root, files, request } = fixture(); const absenceCapability = { id: "input", status: "checked-no-usage", expectedNames: ["setFeature"], reason: "peer API requires a setter", repository: "repository-a", searchScope: "tests/**/*.js", performedChecks: ["text", "AST"], ordersChecked: ["second", "third"], linkingMethodsChecked: ["factory"], resultComplete: true, resultTruncated: false, consequence: "test coverage gap remains", evidenceRefs: ["ev-absence"] }; const written = writeStageArtifact({ outputDir: path.join(root, "stage-absence-capability"), facts: { stage: 6, status: "closed", repositoryScope: request.scope, summary: { lineage: require("../../../shared/artifacts/src/canonical/lineage.js").buildLineageFromPrevious(files[5],6,request.scope) }, capabilities: [absenceCapability], canonicalEvidence: [{ id: "ev-absence", status: "checked-no-usage", repository: "repository-a", searchScope: "tests/**/*.js", performedChecks: ["text", "AST"], ordersChecked: ["second", "third"], linkingMethodsChecked: ["factory"], resultComplete: true, resultTruncated: false }] }, input: { stage: 6 } }); const model = buildStage7({ ...request, priorArtifacts: [...files.slice(0,6), written.resultFile] }); assert.deepEqual(model.capabilities.find((row) => row.id === "input").performedChecks, ["AST", "text"]); });
test("stage 7 inherits planning facts from canonical prior stages", () => { const { root, files, request } = fixture(); const artifact = path.join(root, "stage-planning"), planFile = path.join(root, "plan.js"), sourceHash = crypto.createHash("sha256").update(fs.readFileSync(planFile)).digest("hex"); const written = writeStageArtifact({ outputDir: artifact, facts: { stage: 6, status: "closed", repositoryScope: request.scope, summary: { lineage: require("../../../shared/artifacts/src/canonical/lineage.js").buildLineageFromPrevious(files[5],6,request.scope) }, canonicalFacts: [{ kind: "scenario", id: "scenario-render", status: "source-confirmed", evidenceRefs: ["ev-plan"] }, { kind: "critical-path", id: "path-render", status: "source-confirmed", scenarioRefs: ["scenario-render"], evidenceRefs: ["ev-plan"] }, { kind: "gap", id: "gap-export", status: "partial", expectedPath: "export", pathRefs: ["path-render"] }, { kind: "implementation-entry", id: "entry-render", status: "confirmed", path: "plan.js", pathRefs: ["path-render"], gapRefs: ["gap-export"], evidenceRefs: ["ev-plan"] }], canonicalEvidence: [{ id: "ev-plan", status: "source-confirmed", repository: "repository-a", file: "plan.js", sourceHash, line: 1, endLine: 1, sourceFragment: fs.readFileSync(planFile, "utf8").trimEnd(), symbol: "draw" }] }, input: {} }); const model = buildStage7({ ...request, priorArtifacts: [...files.slice(0,6), written.resultFile], evidenceSelectors: [...request.evidenceSelectors, { artifact, limit: 10 }] }); assert.equal(model.scenarios[0].id, "scenario-render"); assert.equal(model.gaps[0].id, "gap-export"); assert.equal(model.implementationEntryPoints[0].evidenceRefs[0], model.evidenceIndex.find((row) => row.id === "ev-plan" || row.aliases?.includes("ev-plan")).id); assert.equal(model.coverage.retainedCoverage.planning.implementationEntryPoints, 1); });

test("stage 7 uses authoritative repositoryScope and rejects conflicting dual scope",()=>{
 const {request}=fixture(); const {scope,...rest}=request;assert.deepEqual(buildStage7({...rest,repositoryScope:scope}).scope,scope);
 assert.throws(()=>buildStage7({...request,repositoryScope:scope,scope:{repositories:[{...scope.repositories[0],role:"reference"}]}}),/conflicting.*scope/i);
});

test("stage 7 inherits the Stage 0 coverage profile and prohibits a weaker override",()=>{
 const coverageProfile={requiredCollections:["criticalPaths"],notApplicable:{},requiredCriticalPaths:["save"],notApplicableCriticalPaths:{}};const {request}=fixture(coverageProfile);
 assert.throws(()=>buildStage7(request),/Required collection criticalPaths.*Mandatory lifecycle path save/);
 assert.throws(()=>buildStage7({...request,coverageProfile:{requiredCollections:[]}}),/coverageProfile conflicts with Stage 0/);
});

test("direct Stage 7 cannot introduce a coverage profile into legacy lineage",()=>{
 const {request}=fixture();
 assert.throws(()=>buildStage7({...request,coverageProfile:{requiredCollections:[],notApplicable:{}}}),/coverageProfile.*Stage 0.*reissue/i);
 assert.throws(()=>buildStage7({...request,coverage:{profile:{requiredCollections:[]}}}),/coverage\.profile.*coverageProfile/);
 assert.throws(()=>buildStage7({...request,coverageProfile:{requiredCollections:[]},coverage:{profile:{requiredCollections:["dictionary"]}}}),/coverage\.profile.*coverageProfile/);
});
