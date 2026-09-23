"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildSummary, findLiteralNameCoverage, normalizeCoverage, runStage5 } = require("../src/runner");
const { writeCanonicalTransition } = require("../../../shared/dto/tests/test_helpers");

test("stage 5 retains full observations after bounded exact-name coverage", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "critical-stage5-"));
  const source = path.join(root, "model.js");
  fs.writeFileSync(source, "renderFeature();\nrenderFeature();\n");
  const transition = writeCanonicalTransition(root, 4);
  const result = await runStage5({ stage: 5, transitionArtifact: transition, checks: [{ id: "path", file: source, pattern: "renderFeature" }], nameCoverage: { id: "renderer", scope: root, terms: ["renderFeature"] } }, {
    findExactNameCoverage: () => ({ id: "renderer", engine: "fixture", scope: root, terms: ["renderFeature"], filesScanned: 4, matchingFileCount: 1, matchingFiles: [source], fileDigest: "all", matchingFileDigest: "matches", query: {} }),
  });
  assert.equal(result.nameCoverage.filesScanned, 4);
  assert.equal(result.nameCoverage.totalMatches, 2);
  assert.equal(result.nameCoverage.fullObservationCount, 2);
  assert.equal(result.sourceEvidence.checks.find((check) => check.id === "renderer").fullMatches.length, 2);
  assert.equal(result.sourceEvidence.checks.find((check) => check.id === "renderer").spec.patterns.length, 1);
  const summary = buildSummary(result, path.join(root, "facts.json"));
  assert.equal(Object.hasOwn(summary, "sourceEvidence"), false);
  assert.equal(summary.nameCoverage.fullObservationCount, 2);
});

test("automatic Stage 5 emits only incomplete candidate path fragments",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"auto-stage5-")),source=path.join(root,"view.js"); fs.writeFileSync(source,"A.B();\n");
  const transition=writeCanonicalTransition(root,4),check={id:"check-a",familyId:"family-a",boundaryId:"boundary-a",term:"A.B",file:source,patterns:[{id:"A.B",value:"A.B",caseSensitive:true}]};
  const result=await runStage5({stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[check],nameCoverages:[{id:"coverage-a",consumerRepo:"consumer",scope:root,terms:["A.B"],searchProfile:{extensions:[".js"]},mappedFiles:[source]}],pathCandidates:[{id:"path-a",familyId:"family-a",receiver:"view.js",consumerRepo:"consumer",boundaryRefs:["boundary-a"]}],pathDiscovery:{status:"complete",reasons:[],families:1}},{findLiteralNameCoverage:config=>({...config,complete:true,matchingFiles:[source],filesScanned:1,matchingFileCount:1})});
  assert.equal(result.status,"candidate"); assert.equal(result.criticalPaths.length,1); assert.equal(result.criticalPaths[0].complete,false); assert.equal(result.criticalPaths[0].status,"candidate");
});

test("automatic Stage 5 stays partial for unmapped coverage or a boundary without a match",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"partial-stage5-")),source=path.join(root,"view.js"),extra=path.join(root,"extra.js"); fs.writeFileSync(source,"other();\n"); fs.writeFileSync(extra,"A.B();\n");
  const transition=writeCanonicalTransition(root,4),request={stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[{id:"check-a",familyId:"family-a",boundaryId:"boundary-a",term:"A.B",file:source,patterns:[{id:"A.B",value:"A.B",caseSensitive:true}]}],nameCoverages:[{id:"coverage-a",consumerRepo:"consumer",scope:root,terms:["A.B"],mappedFiles:[source]}],pathCandidates:[{id:"path-a",familyId:"family-a",receiver:"view.js",consumerRepo:"consumer",boundaryRefs:["boundary-a"]}],pathDiscovery:{status:"complete",reasons:[],families:1}};
  const result=await runStage5(request,{findLiteralNameCoverage:config=>({...config,complete:true,matchingFiles:[extra]})});
  assert.equal(result.status,"partial"); assert.deepEqual(result.criticalPaths,[]); assert.match(result.summary.pathDiscovery.reasons.join("\n"),/coverage differs|no exact/);
});

test("automatic Stage 5 converts coverage errors to partial",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"error-stage5-")),source=path.join(root,"view.js"); fs.writeFileSync(source,"A.B();\n");
  const transition=writeCanonicalTransition(root,4),result=await runStage5({stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[],nameCoverages:[{id:"coverage-a",scope:root,terms:["A.B"]}],pathCandidates:[],pathDiscovery:{status:"complete",reasons:[],families:0}},{findLiteralNameCoverage(){throw new Error("boom");}});
  assert.equal(result.status,"partial"); assert.match(result.summary.pathDiscovery.reasons.join("\n"),/boom/);
});

test("automatic coverage applies nested Stage 3 exclusions and symlink policy",async()=>{
  const value=normalizeCoverage({id:"coverage",scope:process.cwd(),terms:["A.B"],searchProfile:{extensions:[".cpp"],excludeDirs:["vendor"],excludeFilePatterns:["\\.map$"],followSymlinks:true}});
  assert.deepEqual(value.excludeDirs,["vendor"]); assert.deepEqual(value.excludeFilePatterns,["\\.map$"]); assert.equal(value.followSymlinks,true);
});

test("automatic coverage marks maxFiles and maxMatches overflow incomplete",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"coverage-limits-")),spawnSync=(_command,args,options)=>{const out=options.stdio[1];if(args.includes("--files")&&!args.includes("--files-with-matches"))fs.writeSync(out,`${path.join(root,"a.js")}\n${path.join(root,"b.js")}\n`);else if(args.includes("--count-matches"))fs.writeSync(out,`${path.join(root,"a.js")}:2\n`);else fs.writeSync(out,`${path.join(root,"a.js")}\n`);return {status:0};};
  const result=findLiteralNameCoverage({id:"coverage",scope:root,terms:["A"],searchProfile:{extensions:[".js"],maxFiles:1,maxMatches:1,followSymlinks:false,excludeDirs:[],excludeFilePatterns:[]}},{spawnSync});
  assert.equal(result.complete,false); assert.match(result.errors.join("\n"),/maxFiles|maxMatches/);
});

test("automatic Stage 5 rejects stale positive match evidence",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"stale-match-")),source=path.join(root,"view.js"); fs.writeFileSync(source,"A.B();\n"); const transition=writeCanonicalTransition(root,4);
  const check={id:"check-a",familyId:"family-a",boundaryId:"boundary-a",term:"A.B",file:source,patterns:[{id:"A.B",value:"A.B",caseSensitive:true}]},request={stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[check],nameCoverages:[{id:"coverage-a",scope:root,terms:["A.B"],mappedFiles:[source]}],pathCandidates:[{id:"path-a",familyId:"family-a",receiver:"view.js",boundaryRefs:["boundary-a"]}],pathDiscovery:{status:"complete",reasons:[],families:1}};
  const result=await runStage5(request,{findLiteralNameCoverage:config=>({...config,complete:true,matchingFiles:[source]}),runEvidenceChecks:()=>({checks:[{id:"check-a",resultComplete:true,truncated:false,errors:[],totalMatches:1,fullMatches:[{file:source,line:1,sourceFragment:"A.B();",sourceHash:"stale"}]}]})});
  assert.equal(result.status,"partial"); assert.deepEqual(result.criticalPaths,[]);
});

test("automatic Stage 5 keeps a deleted positive match partial",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"deleted-match-")),source=path.join(root,"deleted.js"),transition=writeCanonicalTransition(root,4);
  const check={id:"check-a",familyId:"family-a",boundaryId:"boundary-a",term:"A.B",file:source,patterns:[{id:"A.B",value:"A.B",caseSensitive:true}]},request={stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[check],nameCoverages:[{id:"coverage-a",scope:root,terms:["A.B"],mappedFiles:[]}],pathCandidates:[{id:"path-a",familyId:"family-a",receiver:"deleted.js",boundaryRefs:["boundary-a"]}],pathDiscovery:{status:"complete",reasons:[],families:1}};
  const result=await runStage5(request,{findLiteralNameCoverage:config=>({...config,complete:true,matchingFiles:[]}),runEvidenceChecks:()=>({checks:[{id:"check-a",resultComplete:true,truncated:false,errors:[],totalMatches:1,fullMatches:[{file:source,line:1,endLine:1,sourceFragment:"A.B();",sourceHash:"0".repeat(64)}]}]})});
  assert.equal(result.status,"partial"); assert.deepEqual(result.criticalPaths,[]); assert.deepEqual(result.sourceFreshness.files,[]);
});

test("automatic Stage 5 exhaustion performs no search",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"empty-stage5-")),transition=writeCanonicalTransition(root,4);
  const result=await runStage5({stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[],nameCoverages:[],pathCandidates:[],pathDiscovery:{status:"exhausted",reasons:[],families:0}},{runEvidenceChecks:()=>{throw new Error("must not run");},findLiteralNameCoverage:()=>{throw new Error("must not run");}});
  assert.equal(result.status,"candidate"); assert.deepEqual(result.criticalPaths,[]);
});

test("full value-flow leaves become separate confirmed paths and usages",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"flow-stage5-")),transition=writeCanonicalTransition(root,4);
  const request={stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[],nameCoverages:[],pathCandidates:[
    {id:"path-a",internal:true,receiver:"ResultA",edgeRefs:["edge-a"],obligationRefs:["leaf-a"],evidenceRefs:["ev-a"]},
    {id:"path-b",internal:true,receiver:"ResultB",edgeRefs:["edge-b"],obligationRefs:["leaf-b"],evidenceRefs:["ev-b"]}
  ],pathObligations:[{id:"root",edgeRefs:["edge-root"],frontier:"Fork",status:"open"},{id:"leaf-a",parentObligationRef:"root",edgeRefs:["edge-root","edge-a"],frontier:"ResultA",status:"open"},{id:"leaf-b",parentObligationRef:"root",edgeRefs:["edge-root","edge-b"],frontier:"ResultB",status:"open"}],valueFlowEdges:[{id:"edge-root",status:"source-confirmed"},{id:"edge-a",status:"source-confirmed"},{id:"edge-b",status:"source-confirmed"}],pathDiscovery:{status:"complete",reasons:[],families:2}};
  const result=await runStage5(request,{runEvidenceChecks:()=>({checks:[]})});
  assert.equal(result.status,"confirmed"); assert.equal(result.criticalPaths.length,2); assert.equal(result.confirmedUsages.length,2); assert.deepEqual(result.criticalPaths.map(row=>row.obligationRefs[0]).sort(),["leaf-a","leaf-b"]);
});

test("internal path stays unresolved when an ancestry edge is missing or unconfirmed",async()=>{
  for(const valueFlowEdges of [[],[{id:"edge-a",status:"candidate"}]]){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"invalid-internal-stage5-")),transition=writeCanonicalTransition(root,4);
    const result=await runStage5({stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[],nameCoverages:[],pathCandidates:[{id:"path-a",internal:true,receiver:"ResultA",edgeRefs:["edge-a"],obligationRefs:["leaf-a"],evidenceRefs:["ev-a"]}],pathObligations:[{id:"leaf-a",edgeRefs:["edge-a"],frontier:"ResultA",status:"open"}],valueFlowEdges,pathDiscovery:{status:"complete",reasons:[],families:1}},{runEvidenceChecks:()=>({checks:[]})});
    assert.equal(result.status,"partial");assert.equal(result.confirmedUsages.length,0);assert.equal(result.pathObligations[0].status,"unresolved");
  }
});

test("automatic Stage 5 summary supports plural name coverages",()=>{
  const summary=buildSummary({schemaVersion:"1.0.0",stage:5,status:"partial",nameCoverages:[{id:"coverage-a",filesScanned:1,matchingFileCount:1,totalMatches:2,matchingFileDigest:"digest"}],sourceEvidence:{checks:[{id:"check-a",totalMatches:1,fullMatches:[]}]},reusableForNextStage:{sourceEvidence:true}},"facts.json");
  assert.equal(summary.nameCoverages[0].id,"coverage-a");assert.equal(summary.targetedChecks[0].fullObservationCount,0);
});

test("candidate path leaves close as unresolved instead of terminal usage",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"candidate-flow-stage5-")),source=path.join(root,"view.js");fs.writeFileSync(source,"A.B();\n");const transition=writeCanonicalTransition(root,4),hash=require("node:crypto").createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  const result=await runStage5({stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[{id:"check-a",familyId:"family-a",boundaryId:"boundary-a",term:"A.B"}],nameCoverages:[{id:"coverage-a",scope:root,terms:["A.B"],mappedFiles:[source]}],pathCandidates:[{id:"path-a",familyId:"family-a",receiver:"view.js",boundaryRefs:["boundary-a"],obligationRefs:["leaf-a"]}],pathObligations:[{id:"leaf-a",frontier:"view.js",status:"open"}],pathDiscovery:{status:"complete",reasons:[],families:1}},{findLiteralNameCoverage:config=>({...config,complete:true,matchingFiles:[source]}),runEvidenceChecks:()=>({checks:[{id:"check-a",resultComplete:true,truncated:false,errors:[],totalMatches:1,fullMatches:[{file:source,line:1,endLine:1,sourceFragment:"A.B();",sourceHash:hash,confirmation:{status:"candidate"}}]}]})});
  assert.equal(result.status,"partial");assert.equal(result.criticalPaths[0].status,"candidate");assert.equal(result.pathObligations[0].status,"unresolved");assert.equal(result.confirmedUsages.length,0);assert.equal(result.summary.pathDiscovery.reasons.some(reason=>reason.includes("leaf requires")),false);
});

test("structural Stage 5 match confirms one open leaf and parses its file once",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"structural-stage5-")),source=path.join(root,"view.js");fs.writeFileSync(source,"api.apply(model.value);\n");const transition=writeCanonicalTransition(root,4),hash=require("node:crypto").createHash("sha256").update(fs.readFileSync(source)).digest("hex"),parseCounts=[];
  const realBatch=require("../../../shared/ast/src/batch/batch.js").runAstBatch,result=await runStage5({stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[{id:"check-a",familyId:"family-a",boundaryId:"boundary-a",term:"apply",file:source,patterns:[{id:"apply",value:"apply",caseSensitive:true}]}],structuralChecks:[{id:"check-a",familyId:"family-a",boundaryId:"boundary-a",term:"apply",file:source,sourceHash:hash,obligationRefs:["leaf-a"]}],nameCoverages:[{id:"coverage-a",scope:root,terms:["apply"],mappedFiles:[source]}],pathCandidates:[{id:"path-a",familyId:"family-a",receiver:"view.js",boundaryRefs:["boundary-a"],obligationRefs:["leaf-a"]}],pathObligations:[{id:"leaf-a",frontier:"view.js",edgeRefs:["edge-a"],status:"open"}],valueFlowEdges:[{id:"edge-a",status:"source-confirmed"}],pathDiscovery:{status:"complete",reasons:[],families:1}},{findLiteralNameCoverage:config=>({...config,complete:true,matchingFiles:[source]}),runAstBatch:async request=>{const value=await realBatch(request);parseCounts.push(...Object.values(value.stats.parseCounts));return value;}});
  assert.equal(result.status,"confirmed");assert.equal(result.criticalPaths[0].status,"confirmed");assert.equal(result.confirmedUsages.length,1);assert.deepEqual(parseCounts,[1]);
});

test("automatic Stage 5 emits a neutral confirmed usage for a structural match outside confirmed paths",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"structural-usage-")),source=path.join(root,"view.js");fs.writeFileSync(source,"api.apply(model.value);\n");const transition=writeCanonicalTransition(root,4),hash=require("node:crypto").createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  const result=await runStage5({stage:5,transitionArtifact:transition,searchFromStage4:true,checks:[{id:"check-a",familyId:"family-a",boundaryId:"boundary-a",term:"apply",file:source,patterns:[{id:"apply",value:"apply",caseSensitive:true}]}],structuralChecks:[{id:"check-a",familyId:"family-a",boundaryId:"boundary-a",term:"apply",file:source,sourceHash:hash,obligationRefs:["leaf-a"]}],nameCoverages:[{id:"coverage-a",scope:root,terms:["apply"],mappedFiles:[source]}],pathCandidates:[{id:"path-a",familyId:"family-a",receiver:"view.js",boundaryRefs:["boundary-a"],obligationRefs:["leaf-a"]}],pathObligations:[{id:"leaf-a",frontier:"view.js",edgeRefs:["edge-a"],status:"unresolved",reason:"unconfirmed-edge"}],valueFlowEdges:[{id:"edge-a",status:"unresolved"}],pathDiscovery:{status:"complete",reasons:[],families:1}},{findLiteralNameCoverage:config=>({...config,complete:true,matchingFiles:[source]})});
  const structuralUsage=result.confirmedUsages.find(usage=>!(usage.pathRefs||[]).length);
  assert.equal(Boolean(structuralUsage),true,"structural match must surface as a neutral confirmed usage");
  assert.equal(structuralUsage.status,"confirmed");
  assert.equal(structuralUsage.evidenceRefs.length,1);
  assert.equal(structuralUsage.evidenceRefs[0],result.canonicalEvidence.find(row=>row.usageKind==="structural-ast").id);
  assert.match(structuralUsage.statement,/apply/);
});

test("manual Stage 5 records a declared complete zero-match check as absence evidence",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"absence-stage5-")),source=path.join(root,"model.js");fs.writeFileSync(source,"const other = 1;\n");
  const transition=writeCanonicalTransition(root,4);
  const absence={id:"absence-a",absenceClaim:true,file:source,pattern:"putInnerShadow",repository:"repo-a",searchScope:"src/**/*.js",reason:"No mutation API is expected for the target field",consequence:"Mutation capability stays closed as checked absence",expectedNames:["putInnerShadow","setInnerShadow"],performedChecks:["text"],ordersChecked:["first"],linkingMethodsChecked:["direct"]};
  const result=await runStage5({stage:5,transitionArtifact:transition,checks:[absence],nameCoverage:{id:"coverage-a",scope:root,terms:["putInnerShadow"]}},{findExactNameCoverage:config=>({id:config.id,engine:"fixture",scope:root,terms:config.terms,filesScanned:3,matchingFileCount:0,matchingFiles:[],fileDigest:"x",matchingFileDigest:"y",query:{}})});
  const row=(result.canonicalEvidence||[]).find(item=>item.id==="absence-a");
  assert.equal(Boolean(row),true,"declared complete zero-match check must produce absence evidence");
  assert.equal(row.id,"absence-a");
  assert.equal(row.status,"checked-no-usage");
  assert.equal(row.evidenceKind,"absence");
  assert.equal(row.repository,"repo-a");
  assert.deepEqual(row.expectedNames,["putInnerShadow","setInnerShadow"]);
  assert.equal(row.resultComplete,true);
  const positive={...absence,id:"absence-b",pattern:"other"};
  const conflicted=await runStage5({stage:5,transitionArtifact:transition,checks:[positive],nameCoverage:{id:"coverage-a",scope:root,terms:["putInnerShadow"]}},{findExactNameCoverage:config=>({id:config.id,engine:"fixture",scope:root,terms:config.terms,filesScanned:3,matchingFileCount:1,matchingFiles:[source],fileDigest:"x",matchingFileDigest:"y",query:{}}),runEvidenceChecks:request=>({checks:request.checks.map(check=>({id:check.id,resultComplete:true,truncated:false,errors:[],totalMatches:1,fullMatches:[{file:source,line:1,endLine:1,sourceFragment:"const other = 1;",sourceHash:require("node:crypto").createHash("sha256").update(fs.readFileSync(source)).digest("hex")}]}))})});
  assert.equal((conflicted.canonicalEvidence||[]).some(item=>item.id==="absence-b"),false,"a check with matches must not produce absence evidence");
});
