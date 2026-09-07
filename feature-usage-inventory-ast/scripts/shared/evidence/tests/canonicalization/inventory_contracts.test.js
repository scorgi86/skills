"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto"), test = require("node:test");
const root = process.env.EVIDENCE_TEST_BASE || path.resolve(__dirname, "../../../..");
const { canonicalizeStage2Candidates } = require(path.join(root, "shared/evidence/src/canonicalization/canonicalize.js"));
const { prepareFacts } = require(path.join(root, "shared/artifacts/src/canonical/facts.js"));
const { runEvidenceChecks } = require(path.join(root, "shared/evidence/src/collection/source_evidence.js"));
function fixture(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-contract-")); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); const a = path.join(dir,"a"), b = path.join(dir,"b"); fs.mkdirSync(a); fs.mkdirSync(b); for(const r of [a,b]) fs.writeFileSync(path.join(r,"file.js"), "  feature();  \r\nfeature();\r\n"); return {a,b,scope:{repositories:[{id:"a",root:a,exclusions:["ignored"]},{id:"b",root:b,exclusions:[]}]}}; }
test("different claims on one anchor retain separate proof and candidate strength", t => {
  const f = fixture(t), file = path.join(f.a, "file.js");
  const confirmation = { status: "source-confirmed", sourceHash: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), sourceFragment: "feature();", line: 2, endLine: 2, evidenceRefs: ["manual"] };
  const base = { repository: "a", file, line: 2, endLine: 2, confirmation };
  const result = canonicalizeStage2Candidates([{ ...base, id: "a", claimRef: "first" }, { ...base, id: "b", claimRef: "second" }, { ...base, id: "c", claimRef: "unverified", confirmation: { status: "candidate" } }], { repositoryScope: f.scope });
  assert.equal(result.evidence.length, 3);
  assert.equal(result.evidence.find(row => row.claimRef === "second").confirmation.status, "source-confirmed");
  assert.equal(result.evidence.find(row => row.claimRef === "unverified").confirmation.status, "candidate");
  assert.deepEqual(canonicalizeStage2Candidates(result.evidence, { repositoryScope: f.scope }).evidence, result.evidence);
});
test("source scan preserves raw SHA and exact anchor but requires explicit confirmation", t=>{const f=fixture(t), file=path.join(f.a,"file.js"); const result=runEvidenceChecks({checks:[{id:"check",file,pattern:"feature"}],retainAllMatches:true}); const row=result.checks[0].matches[0]; assert.equal(row.sourceFragment,"  feature();  "); assert.equal(row.endLine,1); assert.equal(row.sourceHash,crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")); assert.notEqual(row.confirmation?.status,"source-confirmed");});
test("canonical evidence retains check aliases, idempotence and all check references", t=>{const f=fixture(t); const sourceEvidence=runEvidenceChecks({checks:[{id:"check",file:path.join(f.a,"file.js"),pattern:"feature"}],retainAllMatches:true}); const facts=prepareFacts({stage:2,repositoryScope:f.scope,sourceEvidence,ownership:{groups:[{id:"owner",evidenceRefs:["check"]}]}}); assert.equal(facts.canonicalEvidence.length,2); assert.ok(facts.canonicalEvidence.every(e=>e.repository==="a")); assert.deepEqual(facts.ownership.groups[0].evidenceRefs,facts.canonicalEvidence.map(e=>e.id).sort()); const twice=prepareFacts(facts); assert.deepEqual(twice.canonicalEvidence,facts.canonicalEvidence);});
test("repository exclusions are local and ambiguous roots diagnosed", t=>{const f=fixture(t); const result=canonicalizeStage2Candidates([{repository:"b",file:"ignored/file.js",line:1}],{repositoryScope:f.scope}); assert.equal(result.evidence.length,1); const ambiguous=canonicalizeStage2Candidates([{file:"file.js",line:1}],{repositoryScope:f.scope}); assert.ok(ambiguous.diagnostics.some(d=>d.code==="ambiguous-repository"));});
test("invalid explicit source confirmation reports exact-anchor error early", t=>{const f=fixture(t), file=path.join(f.a,"file.js"); const result=canonicalizeStage2Candidates([{repository:"a",file,line:1,endLine:1,sourceFragment:"feature();",confirmation:{status:"source-confirmed",sourceHash:crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),evidenceRefs:["check"]}}],{repositoryScope:f.scope}); assert.ok(result.diagnostics.some(d=>d.code==="source-anchor"));});

test("one explicit source confirmation does not promote other check matches", t=>{const f=fixture(t),file=path.join(f.a,"file.js"), sourceHash=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); const sourceEvidence=runEvidenceChecks({retainAllMatches:true,checks:[{id:"check",file,pattern:"feature",confirmation:{status:"source-confirmed",line:2,endLine:2,sourceFragment:"feature();",sourceHash}}]}); const facts=prepareFacts({stage:2,repositoryScope:f.scope,sourceEvidence}); assert.equal(facts.canonicalEvidence.filter(e=>e.confirmation.status==="source-confirmed").length,1); assert.equal(facts.canonicalEvidence.find(e=>e.confirmation.status==="source-confirmed").range.startLine,2); });
test("Stage2 producer inherits repository scope and preserves source proof into serialization", t=>{const f=fixture(t),file=path.join(f.a,"file.js"); const {writeCanonicalTransition}=require(path.join(root,"shared/dto/tests/test_helpers.js")); const {runStage2}=require(path.join(root,"steps/step-2/src/runner.js")); const {createCanonicalStageResult}=require(path.join(root,"shared/artifacts/src/canonical/result.js")); const transitionArtifact=writeCanonicalTransition(f.a,1,{facts:{repositoryScope:f.scope}}); const result=runStage2({stage:2,transitionArtifact,evidence:{checks:[{id:"check",file,pattern:"feature",confirmation:{status:"source-confirmed",line:2,endLine:2,sourceFragment:"feature();",sourceHash:crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}}]}},{runAstBatch:()=>({results:[],stats:{parseCounts:{}},plan:{compiledBeforeParse:true,lateQueries:0}})}); assert.deepEqual(result.repositoryScope,f.scope); assert.equal(result.canonicalEvidence.find(e=>e.range.startLine===2).confirmation.status,"source-confirmed"); const canonical=createCanonicalStageResult({facts:result}); assert.ok(result.canonicalEvidence.every(e=>canonical.evidenceRefs.includes(e.id))); });
test("Stage6 feature-reference accepts attached proof and keeps unrelated surfaces candidate",t=>{const f=fixture(t),file=path.join(f.a,"file.js");const {writeCanonicalTransition}=require(path.join(root,"shared/dto/tests/test_helpers.js")), {runStage6}=require(path.join(root,"steps/step-6/src/runner.js"));const transitionArtifact=writeCanonicalTransition(f.a,5,{facts:{repositoryScope:f.scope}});const result=runStage6({stage:6,transitionArtifact,mode:"feature-reference",featureReference:{target:"new",referenceEntity:"old",capabilities:[{id:"definition",status:"unchecked",evidenceRefs:[]}]},sourceSurfaces:[{path:file,layer:"model",role:"storage",evidenceRefs:["proof"]},{path:"unrelated.js",layer:"model",role:"storage"}],canonicalEvidence:[{id:"proof",repository:"a",file,line:2,endLine:2,sourceFragment:"feature();",confirmation:{status:"source-confirmed",sourceHash:crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),evidenceRefs:["manual"]}}]});assert.equal(result.sourceSurfaces[0].confirmed,true);assert.equal(result.sourceSurfaces[1].confirmed,false);assert.equal(result.sourceSurfaces[0].evidenceRefs[0],result.canonicalEvidence[0].id);});
test("evidence ID collision is diagnosed without merging distinct locations",t=>{const f=fixture(t);const result=canonicalizeStage2Candidates([{id:"same",repository:"a",file:"file.js",line:1},{id:"same",repository:"a",file:"file.js",line:2}],{repositoryScope:f.scope});assert.equal(result.evidence.length,2);assert.ok(result.diagnostics.some(d=>d.code==="evidence-id-collision"));});
test("declared case-sensitive repository keeps differently cased files distinct",t=>{const f=fixture(t); f.scope.repositories[0].caseSensitive=true;const result=canonicalizeStage2Candidates([{repository:"a",file:"File.js",line:1},{repository:"a",file:"file.js",line:1}],{repositoryScope:f.scope});assert.equal(result.evidence.length,2);});
test("missing scan input is partial, never complete candidate-empty",t=>{const f=fixture(t);const result=runEvidenceChecks({checks:[{id:"missing",file:path.join(f.a,"missing.js"),pattern:"feature"}]});assert.equal(result.checks[0].status,"partial");assert.equal(result.checks[0].resultComplete,false);assert.ok(result.checks[0].errors.length);});

test("explicit ownership and boundary anchors acquire their own validated evidence links",t=>{const f=fixture(t),file=path.join(f.a,"file.js"),confirmation={status:"source-confirmed",file,line:2,endLine:2,sourceFragment:"feature();",sourceHash:crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")};const facts=prepareFacts({stage:1,repositoryScope:f.scope,ownership:{groups:[{id:"owner",object:"owner",confirmation}]},boundaries:[{id:"boundary",producerRepo:"a",confirmation,symbol:"api"}]});assert.equal(facts.canonicalEvidence.length,2);for(const row of [facts.ownership.groups[0],facts.boundaries[0]]){assert.equal(row.evidenceRefs.length,1);assert.equal(facts.canonicalEvidence.find(e=>e.id===row.evidenceRefs[0]).confirmation.status,"source-confirmed");}assert.deepEqual(prepareFacts(facts).canonicalEvidence,facts.canonicalEvidence);});

test("repository-relative escape is diagnosed for candidates and explicit confirmations", t => {
    const f = fixture(t), outside = path.join(path.dirname(f.a), "outside.js"); fs.writeFileSync(outside, "outside();\n");
    const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(outside)).digest("hex");
    for (const status of ["candidate", "source-confirmed"]) {
        const result = canonicalizeStage2Candidates([{ repository: "a", file: "../outside.js", line: 1, endLine: 1, sourceFragment: "outside();", status, sourceHash }], { repositoryScope: f.scope });
        assert.ok(result.diagnostics.some(row => row.code === "repository-attribution"), status);
        assert.notEqual(result.evidence[0].confirmation.status, "source-confirmed");
    }
});
test("relative containment preserves valid paths and diagnoses nested-root ambiguity", t => {
    const f = fixture(t);
    for (const file of ["file.js", "nested/../file.js", "..metadata.js"]) {
        const result = canonicalizeStage2Candidates([{ repository: "a", file, line: 1 }], { repositoryScope: f.scope });
        assert.equal(result.diagnostics.length, 0, file); assert.equal(result.evidence[0].repository, "a");
    }
    const nested = path.join(f.a, "nested"); fs.mkdirSync(nested); fs.writeFileSync(path.join(nested, "source.js"), "nested();\n");
    const result = canonicalizeStage2Candidates([{ repository: "a", file: "nested/source.js", line: 1 }], { repositoryScope: { repositories: [...f.scope.repositories, { id: "nested", root: nested }] } });
    assert.ok(result.diagnostics.some(row => row.code === "ambiguous-repository"));
});

test("same-claim candidate and exact proof merge without contradictory or order-dependent status", t => {
    const f = fixture(t), file = path.join(f.a, "file.js");
    const candidate = { repository: "a", file, line: 2, endLine: 2, claimRef: "owner", status: "candidate", sourceFragment: "old fragment", sourceHash: "0".repeat(64) };
    const proof = { ...candidate, status: "source-confirmed", sourceFragment: "feature();", sourceHash: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), confirmation: { status: "source-confirmed", evidenceRefs: ["manual"] } };
    for (const rows of [[candidate, proof], [proof, candidate]]) {
        const result = canonicalizeStage2Candidates(rows, { repositoryScope: f.scope });
        assert.equal(result.evidence.length, 1);
        assert.equal(result.evidence[0].status, "source-confirmed");
        assert.equal(result.evidence[0].confirmation.status, "source-confirmed");
        assert.deepEqual(canonicalizeStage2Candidates(result.evidence, { repositoryScope: f.scope }).evidence, result.evidence);
    }
    const separate = canonicalizeStage2Candidates([candidate, { ...proof, claimRef: "other" }], { repositoryScope: f.scope });
    assert.equal(separate.evidence.length, 2);
    assert.equal(separate.evidence.find(row => row.claimRef === "owner").status, "candidate");
});
