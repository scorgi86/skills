"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {analyzeFile}=require("../../src/analysis/analysis.js");

test("relations expose only their structural AST participants",t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"ast-participants-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,"neutral.js");fs.writeFileSync(file,'const x = new Alpha();\nbox.value = x;\napi.use(box.value, "value");\nreturnBox = () => this.value;\n');
  const result=analyzeFile(file).result,find=(relation)=>result.relations.find(row=>row.relation===relation);
  assert.deepEqual(find("construct").participants.map(row=>[row.role,row.value]),[["callee","Alpha"]]);
  assert.deepEqual(find("field-write").participants.map(row=>[row.role,row.value]),[["target-field","value"],["source-value","x"]]);
  assert.deepEqual(find("field-to-call-argument").participants.map(row=>[row.role,row.value]),[["source-field","value"]]);
  const call=find("call");assert.deepEqual(call.participants.map(row=>[row.role,row.value]),[["callee","use"]]);
  assert.equal(call.participants.some(row=>row.value==="value"),false);
  for(const relation of result.relations)for(const participant of relation.participants||[]){const occurrence=result.occurrences.find(row=>row.value===participant.value&&row.file===participant.file&&row.range.start.offset===participant.range.start.offset&&row.range.end.offset===participant.range.end.offset);assert.ok(occurrence,`${relation.relation}/${participant.role}`);}
});
