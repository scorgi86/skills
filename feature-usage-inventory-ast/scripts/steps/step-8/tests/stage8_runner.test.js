"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const { normalizeReportModel } = require("../../../shared/report/src/model/normalization.js");
const { run } = require("../src/runner.js");
const { validateInventoryBundle } = require("../../../shared/report/src/bundle/validation.js");
function model() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-source-")); const source = path.join(root, "a.js"); const content = "const A = 1;\n"; fs.writeFileSync(source, content); return normalizeReportModel({ target: "X", scope: { repositories: [{ id: "repository-a", root, role: "source" }] }, capabilities: [{ id: "ownership", status: "confirmed", evidenceRefs: ["ev-1"] }], evidenceIndex: [{ id: "ev-1", status: "source-confirmed", repository: "repository-a", file: "a.js", line: 1, endLine: 1, sourceFragment: "const A = 1;", sourceHash: crypto.createHash("sha256").update(content).digest("hex"), symbol: "A", result: "confirmed" }], confirmedUsages: [{ id: "use-1", title: "Use", evidenceRefs: ["ev-1"] }], checkedNoUsage: [], recipientFamilies: [{ id: "recipient-1", name: "Consumers", evidenceRefs: ["ev-1"] }], criticalPaths: [{ id: "path-1", name: "Persistence", evidenceRefs: ["ev-1"] }], transition: { "next stage": "8" } }); }
test("stage 8 renders deterministic documents without changing model", () => { const value = model(), before = JSON.stringify(value), a = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-a-")), b = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-b-")); const one = run(value, a, value.integrity.canonicalDigest), two = run(value, b, value.integrity.canonicalDigest); assert.deepEqual(one.outputs, two.outputs); assert.equal(JSON.stringify(value), before); assert.deepEqual(fs.readdirSync(a).sort(), ["decision-report.md", "evidence.md", "implementation-map.md", "manifest.json"]); });
test("stage 8 blocks a mutated model", () => { const value = model(), closedDigest = value.integrity.canonicalDigest; value.target = "mutated"; assert.throws(() => run(value, fs.mkdtempSync(path.join(os.tmpdir(), "stage8-bad-")), closedDigest), /input validation failed/); });
test("stage 8 blocks a rehashed replacement model", () => { const value = model(), closedDigest = value.integrity.canonicalDigest; const replacement = normalizeReportModel({ ...value, target: "replacement" }); assert.throws(() => run(replacement, fs.mkdtempSync(path.join(os.tmpdir(), "stage8-rehash-")), closedDigest), /differs from closed Stage 7 digest/); });
test("strict bundle validation treats the three documents as one report", () => {
  const value = model();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-bundle-"));
  const manifest = run(value, directory, value.integrity.canonicalDigest);
  assert.equal(manifest.validation.strictBundle, "passed");
  assert.deepEqual(manifest.outputs.map((item) => item.path), ["decision-report.md", "evidence.md", "implementation-map.md"]);
  const documents = Object.fromEntries(manifest.outputs.map((item) => [item.path, fs.readFileSync(path.join(directory, item.path), "utf8")]));
  assert.equal(validateInventoryBundle(documents, { strict: true, model: value }).ok, true);
  delete documents["evidence.md"];
  const invalid = validateInventoryBundle(documents, { strict: true, model: value });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /evidence\.md/);
});
test("strict bundle validation does not confuse an id with its longer prefix match", () => {
  const value = model();
  value.confirmedUsages[0].id = "use-10";
  value.integrity = normalizeReportModel(value).integrity;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-prefix-"));
  const manifest = run(value, directory, value.integrity.canonicalDigest);
  const documents = Object.fromEntries(manifest.outputs.map((item) => [item.path, fs.readFileSync(path.join(directory, item.path), "utf8")]));
  documents["decision-report.md"] = documents["decision-report.md"].replaceAll("use-10", "use-1");
  const invalid = validateInventoryBundle(documents, { strict: true, model: value });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /missing use-10/);
});
test("strict bundle preserves the complete checked-no-usage protocol", () => { const value = model(), protocol = { id: "absence-1", status: "checked-no-usage", expectedNames: ["setX"], reason: "peer API", repository: "repository-a", searchScope: "src", performedChecks: ["text", "AST"], ordersChecked: ["second"], linkingMethodsChecked: ["factory"], resultComplete: true, resultTruncated: false, consequence: "path absent", evidenceRefs: ["ev-absence"] }; value.checkedNoUsage = [protocol]; value.evidenceIndex.push({ ...protocol, id: "ev-absence", evidenceKind: "absence", evidenceRefs: ["ev-absence"] }); value.integrity.canonicalDigest = require("../../../shared/report/src/model/serialization.js").digest(require("../../../shared/report/src/model/serialization.js").withoutIntegrity(value)); const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-absence-")), manifest = run(value, directory, value.integrity.canonicalDigest), documents = Object.fromEntries(manifest.outputs.map((item) => [item.path, fs.readFileSync(path.join(directory, item.path), "utf8")])); const evidence = documents["evidence.md"]; for (const token of ["text", "AST", "second", "factory", "complete", "untruncated", "checked-no-usage"]) assert.ok(evidence.includes(token)); documents["evidence.md"] = evidence.replace("factory", "removed-linking-method"); assert.equal(validateInventoryBundle(documents, { strict: true, model: value }).ok, false); });
test("strict bundle preserves capability and generic absence protocols", () => { const value = model(), base = { status: "checked-no-usage", expectedNames: ["setX"], reason: "peer API", repository: "repository-a", searchScope: "src", performedChecks: ["text"], ordersChecked: ["N/A"], linkingMethodsChecked: ["factory"], resultComplete: true, resultTruncated: false, consequence: "path absent" }, capability = { id: "input", ...base, requiredForFinalReport: true, evidenceRefs: ["ev-cap"] }, ownership = { id: "owner-absence", ...base, expectedNames: ["ownerX"], evidenceRefs: ["ev-owner"] }; value.capabilities = [capability]; value.ownership = [ownership]; value.evidenceIndex.push({ ...capability, id: "ev-cap", evidenceKind: "absence", evidenceRefs: ["ev-cap"] }, { ...ownership, id: "ev-owner", evidenceKind: "absence", evidenceRefs: ["ev-owner"] }); value.integrity.canonicalDigest = require("../../../shared/report/src/model/serialization.js").digest(require("../../../shared/report/src/model/serialization.js").withoutIntegrity(value)); const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-all-absence-")), manifest = run(value, directory, value.integrity.canonicalDigest), documents = Object.fromEntries(manifest.outputs.map((item) => [item.path, fs.readFileSync(path.join(directory, item.path), "utf8")])), evidence = documents["evidence.md"]; for (const token of ["capabilities", "ownership", "setX", "ownerX", "factory"]) assert.ok(evidence.includes(token)); documents["evidence.md"] = evidence.replace("ev-cap", "removed-capability-ref"); assert.equal(validateInventoryBundle(documents, { strict: true, model: value }).ok, false); });
test("strict bundle preserves absence association references", () => { const value = model(), protocol = { status: "checked-no-usage", expectedNames: ["setX"], reason: "peer API", repository: "repository-a", searchScope: "src", performedChecks: ["text"], ordersChecked: ["N/A"], linkingMethodsChecked: ["factory"], resultComplete: true, resultTruncated: false, consequence: "path absent", scenarioRefs: ["scenario-1"], recipientRefs: ["recipient-1"], pathRefs: ["path-1"], gapRefs: ["gap-1"], capabilityRefs: ["ownership"], testSurfaceRefs: ["test-1"], evidenceRefs: ["ev-absence"] }; value.scenarios = [{ id: "scenario-1", status: "not-applicable" }]; value.gaps = [{ id: "gap-1", status: "not-applicable", expectedName: "setX" }]; value.referenceOnly = [{ id: "test-1", status: "reference-only" }]; value.ownership = [{ id: "owner-absence", ...protocol }]; value.evidenceIndex.push({ ...protocol, id: "ev-absence", evidenceKind: "absence", evidenceRefs: ["ev-absence"] }); value.integrity.canonicalDigest = require("../../../shared/report/src/model/serialization.js").digest(require("../../../shared/report/src/model/serialization.js").withoutIntegrity(value)); const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-associations-")), manifest = run(value, directory, value.integrity.canonicalDigest), documents = Object.fromEntries(manifest.outputs.map((item) => [item.path, fs.readFileSync(path.join(directory, item.path), "utf8")])), evidence = documents["evidence.md"]; for (const token of ["scenario-1", "recipient-1", "path-1", "gap-1", "ownership", "test-1"]) assert.ok(evidence.includes(token)); documents["evidence.md"] = evidence.replace("test-1", "removed-test-surface"); assert.equal(validateInventoryBundle(documents, { strict: true, model: value }).ok, false); });
test("stage 8 rejects an unexpected Markdown document in its output directory", () => { const value = model(), directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-extra-")); fs.writeFileSync(path.join(directory, "legacy-report.md"), "legacy\n"); assert.throws(() => run(value, directory, value.integrity.canonicalDigest), /unexpected Markdown/); });
test("stage 8 rejects a nested unexpected Markdown document", () => { const value = model(), directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-nested-extra-")), nested = path.join(directory, "legacy"); fs.mkdirSync(nested); fs.writeFileSync(path.join(nested, "extra.md"), "legacy\n"); assert.throws(() => run(value, directory, value.integrity.canonicalDigest), /legacy\/extra\.md/); });
test("stage 8 rejects Markdown reached through a junction", () => { const value = model(), directory = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-junction-")), outside = fs.mkdtempSync(path.join(os.tmpdir(), "stage8-junction-target-")); fs.writeFileSync(path.join(outside, "extra.md"), "legacy\n"); fs.symlinkSync(outside, path.join(directory, "linked"), "junction"); assert.throws(() => run(value, directory, value.integrity.canonicalDigest), /linked\/extra\.md/); });

test("semantic report fields, candidates, source labels, and product readiness survive rendering",()=>{
 const value=model();value.confirmedUsages=[{id:"candidate-use",status:"candidate",statement:"Candidate meaning",detail:"Unproven detail",evidenceRefs:["ev-1"]}];
 value.dictionary=[{id:"words",terms:["BeforeName","AfterName"],status:"reference-only"}];value.criticalPaths=[{id:"save",steps:["Serialize","Write bytes"],status:"candidate"}];value.gaps=[{id:"g",statement:"Setter absent",detail:"UI cannot update",expectedPath:"setX",category:"product-gap",status:"confirmed",evidenceRefs:["ev-1"]}];value.coverage={status:"complete",productReadiness:"blocked"};
 const closed=normalizeReportModel(value);const directory=fs.mkdtempSync(path.join(os.tmpdir(),"stage8-meaning-"));run(closed,directory,closed.integrity.canonicalDigest);
 const decision=fs.readFileSync(path.join(directory,"decision-report.md"),"utf8"),implementation=fs.readFileSync(path.join(directory,"implementation-map.md"),"utf8"),evidence=fs.readFileSync(path.join(directory,"evidence.md"),"utf8");
 for(const phrase of ["Candidate meaning","Unproven detail","Setter absent","UI cannot update","product-gap","blocked"])assert.ok(decision.includes(phrase),phrase);
 assert.ok(!decision.includes("## Подтверждённые использования"));assert.ok(!evidence.includes("## Подтверждённые выводы"));
 for(const phrase of ["BeforeName","AfterName","Serialize","Write bytes"])assert.ok(implementation.includes(phrase),phrase);
 assert.match(decision,/a\.js:1/);assert.match(evidence,/source-confirmed/);
});

test("RRZA minimal saved-model regression cannot render a partial investigation",()=>{
 const input=JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/rrza-incomplete.json"),"utf8"));const value=normalizeReportModel(input);const directory=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"rrza-gate-")),"must-not-exist");
 assert.equal(value.decisionStatus,"confirmed");assert.equal(value.gaps.length,6);
 assert.throws(()=>run(value,directory,value.integrity.canonicalDigest),/Research coverage is partial.*Required collection dictionary.*Mandatory lifecycle path open/);
 assert.equal(fs.existsSync(directory),false);
});
test("mixed model golden reports are deterministic and preserve semantic distinctions",()=>{
 const input=JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/mixed-model-input.json"),"utf8"));const value=normalizeReportModel(input),before=JSON.stringify(value);
 for(const [name,fn]of [["decision","renderDecision"],["implementation","renderImplementation"],["evidence","renderEvidence"]]){
  const render=require(`../src/rendering/${name}.js`)[fn];assert.equal(render(value),fs.readFileSync(path.join(__dirname,`fixtures/mixed-${name}.md`),"utf8"));assert.equal(render(JSON.parse(before)),render(value));
 }
 assert.equal(JSON.stringify(value),before);
});

test("empty N/A coverage is explained rather than indistinguishable from a missing table",()=>{
 const input=JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/mixed-model-input.json"),"utf8"));const value=normalizeReportModel(input);
 assert.match(require("../src/rendering/implementation.js").renderImplementation(value),/dictionary.*Неприменимо.*Names remain unchanged/);
});

test("implementation report retains receiver labels and reference path roles",()=>{
 const value=model();
 value.recipientFamilies=[{id:"native-recipient",receiver:"Native persistence",status:"candidate"}];
 value.referencePaths=[{id:"native-entry",path:"bridge.cpp",role:"save entry",roles:["save entry","native dispatch"],status:"reference-only"}];
 const rendered=require("../src/rendering/implementation.js").renderImplementation(value);
 assert.match(rendered,/\| native-recipient \| Native persistence \|/);
 assert.match(rendered,/\| native-entry \|[^\n]*bridge\.cpp \| save entry; native dispatch \|/);
});
test("reference path role column renders declared role without a name",()=>{
 const value=model();value.referencePaths=[{id:"entry",path:"bridge.cpp",role:"save entry",status:"reference-only"}];
 assert.match(require("../src/rendering/implementation.js").renderImplementation(value),/\| entry \|[^\n]*bridge\.cpp \| save entry \|/);
});
