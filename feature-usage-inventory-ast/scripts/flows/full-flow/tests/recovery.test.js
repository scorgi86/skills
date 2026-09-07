"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), test = require("node:test");
const {spawnSync} = require("node:child_process");
const {runStagePipeline} = require("../src/stage_pipeline.js");
const {main: stateCommand} = require("../../../state/src/stage_state.js");
const {scopeDigest} = require("../../../shared/artifacts/src/canonical/checks.js");
function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-recovery-"));
 t.after(() => fs.rmSync(root, {recursive:true,force:true}));
 const outputRoot=path.join(root,"artifacts"), stateFile=path.join(root,"state.json"), target=path.join(outputRoot,"stage-0"), journal=path.join(outputRoot,".transactions","stage-0.json");
 stateCommand(["init","--state",stateFile]);
 const request={stage:0,coverageProfile:{},target:"FeatureValue",repositoryScope:{repositories:[{id:"source",root,role:"source",exclusions:["out"]}]}};
 return {root,outputRoot,stateFile,target,journal,request};
}
function execute(f,runner) {return runStagePipeline({...f,runner});}
function candidate() {return {stage:0,status:"candidate"};}
function partial(f) { execute(f,()=>({stage:0,status:"partial"})); return fs.readFileSync(path.join(f.target,"canonical/stage-result.json"),"utf8"); }
function inject(t,method,predicate) {const original=fs[method]; let fired=false; const mock=t.mock.method(fs,method,(...args)=>{if(!fired && predicate(...args)){fired=true; throw new Error(`injected ${method}`);}return original(...args);});return ()=>{mock.mock.restore();assert.equal(fired,true);};}
test("closed preflight and foreign transaction lock reject before runner",t=>{
 const f=fixture(t);execute(f,candidate);let calls=0;
 assert.throws(()=>execute(f,()=>{calls++;return candidate();}),/already closed/);assert.equal(calls,0);
 const other=fixture(t);fs.mkdirSync(path.dirname(other.journal),{recursive:true});fs.writeFileSync(`${other.journal}.lock`,"foreign-owner");
 assert.throws(()=>execute(other,()=>{calls++;return candidate();}),/locked/);assert.equal(calls,0);assert.equal(fs.readFileSync(`${other.journal}.lock`,"utf8"),"foreign-owner");
});
test("failed preparation leaves partial bytes and no pending journal",t=>{
 const f=fixture(t), before=partial(f);
 assert.throws(()=>execute(f,()=>{throw new Error("prepare failed");}),/prepare failed/);
 assert.equal(fs.readFileSync(path.join(f.target,"canonical/stage-result.json"),"utf8"),before);assert.equal(fs.existsSync(f.journal),false);assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).currentStage,0);
});
test("publish rename failure restores partial then resumes prepared work without runner repeat",t=>{
 const f=fixture(t), before=partial(f);let calls=0;const runner=()=>{calls++;return candidate();};
 const restore=inject(t,"renameSync",(from,to)=>path.basename(String(from))==="prepared" && path.resolve(to)===f.target);
 assert.throws(()=>execute(f,runner),/injected renameSync/);restore();
 assert.equal(fs.readFileSync(path.join(f.target,"canonical/stage-result.json"),"utf8"),before);assert.equal(fs.existsSync(f.journal),true);
 assert.equal(execute(f,runner).status,"closed");assert.equal(calls,1);assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).currentStage,1);
});
test("publication before failed state save resumes without rerunning producer",t=>{
 const f=fixture(t);let calls=0;const runner=()=>{calls++;return candidate();};
 const restore=inject(t,"renameSync",(_from,to)=>path.resolve(to)===f.stateFile);
 assert.throws(()=>execute(f,runner),/injected renameSync/);restore();
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.target,"canonical/stage-result.json"))).status,"closed");assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).currentStage,0);
 assert.equal(execute(f,runner).status,"closed");assert.equal(calls,1);assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).currentStage,1);
});
test("state advanced before failed journal deletion resumes idempotently",t=>{
 const f=fixture(t);let calls=0;const runner=()=>{calls++;return candidate();};
 const restore=inject(t,"unlinkSync",file=>path.resolve(file)===f.journal);
 assert.throws(()=>execute(f,runner),/injected unlinkSync/);restore();
 const before=fs.readFileSync(f.stateFile,"utf8");assert.equal(JSON.parse(before).currentStage,1);
 assert.equal(execute(f,runner).status,"closed");assert.equal(calls,1);assert.equal(fs.readFileSync(f.stateFile,"utf8"),before);assert.equal(fs.existsSync(f.journal),false);
});
test("real CLI partial omission retains check and explicit scope receipt closes same stage",t=>{
 const f=fixture(t), requestFile=path.join(f.root,"request.json"), cli=path.resolve(__dirname,"../../../cli/src/commands/stage_pipeline.js");
 const base={...f.request,scope:"source",scanSeeds:false,repos:[{id:"source",path:f.root}],repositoryState:[{id:"source",state:"fixture"}],tooling:[{id:"rg",status:"available"}],seeds:{direct:["FeatureValue"],aliases:["featureState"]},expectedLayers:["model","owner","tests"],exclusions:["out"]};
 function run(request){fs.writeFileSync(requestFile,JSON.stringify(request));const child=spawnSync(process.execPath,[cli,"--request",requestFile,"--state",f.stateFile,"--output-root",f.outputRoot],{encoding:"utf8"});assert.equal(child.status,0,child.stderr||child.stdout);return JSON.parse(fs.readFileSync(path.join(f.target,"canonical/stage-result.json")));}
 const first=run({...base,openChecks:["check out"]});assert.equal(first.status,"partial");
 const omitted=run(base);assert.deepEqual(omitted.openChecks,["check out"]);assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).currentStage,0);
 const closed=run({...base,checkResolutions:[{kind:"check-resolution",check:"check out",originDigest:first.outputDigest,reason:"Explicitly excluded",disposition:"not-applicable",scopeDigest:scopeDigest(base.repositoryScope),repository:"source",exclusion:"out",scopeJustification:"The question concerns only the excluded out directory"}]});
 assert.equal(closed.status,"closed");assert.deepEqual(closed.openChecks,[]);assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).currentStage,1);assert.equal(closed.facts.some(row=>row.kind==="check-resolution"),true);
});
