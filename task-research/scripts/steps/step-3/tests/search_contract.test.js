const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const {runStage3}=require('../src/runner'); const {writeCanonicalTransition}=require('../../../shared/dto/tests/test_helpers');
test('native consumer language profile searches C++ and records performed scope',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-consumer-'));try{fs.writeFileSync(path.join(root,'consumer.cpp'),'NativeBridge();');const transition=writeCanonicalTransition(root,2);const artifact=JSON.parse(fs.readFileSync(transition));artifact.facts.push({id:'boundary-native',kind:'boundary',boundaryKind:'native',consumerRepos:['native'],searchTerms:['NativeBridge']});fs.writeFileSync(transition,JSON.stringify(artifact));const result=runStage3({stage:3,transitionArtifact:transition,consumerScopes:[{id:'native',scope:root,languages:['cpp'],excludeFilePatterns:['\\.json$']}]});assert.equal(result.sourceEvidence.checks[0].totalMatches,1);assert.ok(result.consumerCoverage[0].searchProfile.extensions.includes('.cpp'));assert.equal(result.consumerCoverage[0].filesScanned,1);}finally{fs.rmSync(root,{recursive:true,force:true});}});

test('Stage 3 preserves the complete performed consumer search profile',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'consumer-profile-'));try{fs.writeFileSync(path.join(root,'a.js'),'Term');const transition=writeCanonicalTransition(root,2);const artifact=JSON.parse(fs.readFileSync(transition));artifact.facts.push({id:'b',kind:'boundary',boundaryKind:'paired-source-term',consumerRepos:['c'],searchTerms:['Term']});fs.writeFileSync(transition,JSON.stringify(artifact));const result=runStage3({stage:3,transitionArtifact:transition,consumerScopes:[{id:'c',scope:root,extensions:['.js'],maxFiles:9,maxMatches:7,followSymlinks:true,excludeDirs:['vendor'],excludeFilePatterns:['\\.map$']}]});assert.deepEqual(result.consumerCoverage[0].searchProfile,{languages:[],extensions:['.js'],maxFiles:9,maxMatches:7,followSymlinks:true,excludeDirs:['vendor'],excludeFilePatterns:['\\.map$']});}finally{fs.rmSync(root,{recursive:true,force:true});}});

test('consumer failures stay partial with recorded scope instead of negative evidence',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'missing-consumer-'));try{const transition=writeCanonicalTransition(root,2);const artifact=JSON.parse(fs.readFileSync(transition));artifact.facts.push({id:'boundary-native',kind:'boundary',boundaryKind:'native',consumerRepos:['native'],searchTerms:['NativeBridge']});fs.writeFileSync(transition,JSON.stringify(artifact));const result=runStage3({stage:3,transitionArtifact:transition,consumerScopes:[{id:'native',scope:path.join(root,'unavailable'),extensions:['.cpp']}]});assert.equal(result.status,'partial');assert.equal(result.consumerCoverage[0].resultComplete,false);assert.equal(result.consumerCoverage[0].absenceClaim,false);assert.ok(result.consumerCoverage[0].errors.length);}finally{fs.rmSync(root,{recursive:true,force:true});}});

test("BDD: consumer search coverage survives canonical-only output without becoming a scenario", t => {
  const { writeStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
  const { canonicalFacts } = require("../../../shared/artifacts/src/canonical/facts.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "consumer-coverage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "consumer.cpp"), "NativeBridge();");
  const transition = writeCanonicalTransition(root, 2, { facts: { boundaries: [{ id: "native", kind: "native", consumerRepos: ["native"], searchTerms: ["NativeBridge"] }] } });
  const result = runStage3({ stage: 3, transitionArtifact: transition, consumerScopes: [{ id: "native", scope: root, languages: ["cpp"] }] });
  assert.equal(result.consumerCoverage.length, 1);
  assert.equal(canonicalFacts(result).some(row => row.kind === "scenario"), false);
  const written = writeStageArtifact({ outputDir: path.join(root, "output"), facts: result, input: {} });
  assert.equal(written.manifest.retainRaw, false);
  assert.deepEqual(written.canonical.summary.consumerCoverage, result.consumerCoverage);
  assert.equal(written.canonical.summary.consumerCoverage[0].totalMatches, 1);
  assert.equal(written.canonical.facts.some(row => row.kind === "scenario"), false);
});

test("empty Stage 3 closes only after canonical Stage 2 boundary exhaustion", t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"empty-boundary-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const transition=writeCanonicalTransition(root,2); const artifact=JSON.parse(fs.readFileSync(transition));
  artifact.summary.boundaryDiscovery={status:"exhausted"}; fs.writeFileSync(transition,JSON.stringify(artifact));
  const closed=runStage3({stage:3,transitionArtifact:transition,consumerScopes:[]});
  assert.equal(closed.status,"candidate"); assert.equal(closed.summary.boundaryStatus,"exhausted");
  delete artifact.summary.boundaryDiscovery; fs.writeFileSync(transition,JSON.stringify(artifact));
  assert.equal(runStage3({stage:3,transitionArtifact:transition,consumerScopes:[],searchFromStage2:true}).status,"partial");
});

test("consumer search exception remains partial", t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"stage3-error-")); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const transition=writeCanonicalTransition(root,2); const artifact=JSON.parse(fs.readFileSync(transition));
  artifact.facts.push({id:"b",kind:"boundary",boundaryKind:"paired-source-term",consumerRepos:["c"],searchTerms:["Term"]}); fs.writeFileSync(transition,JSON.stringify(artifact));
  const result=runStage3({stage:3,transitionArtifact:transition,consumerScopes:[{id:"c",scope:root}]},{runEvidenceChecks(){throw new Error("boom");}});
  assert.equal(result.status,"partial"); assert.ok(result.limitations.some(row=>row.includes("boom")));
});
