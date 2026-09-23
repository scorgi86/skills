"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { buildObligationTree, buildValueFlow, splitObligation, validateObligationTree } = require("../src/value_flow.js");
function fixture(t, names = ["Alpha", "Beta", "Gamma"]) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "value-flow-")); t.after(() => fs.rmSync(root, { recursive:true, force:true })); const file=path.join(root,"neutral.js"), text=`const x = new ${names[0]}();\nbox.value = x;\nuse(box.value);\n`;fs.writeFileSync(file,text);const hash=crypto.createHash("sha256").update(text).digest("hex"),ev=line=>[{file,range:{start:{line},end:{line}},confidence:"exact"}];return{root,relations:[{relation:"construct",targetQualifiedName:names[0],sourceSymbol:names[1],evidence:ev(1),analysisSourceHash:hash},{relation:"field-write",ownerQualifiedName:names[1],field:"value",targetQualifiedName:names[0],evidence:ev(2),analysisSourceHash:hash},{relation:"field-to-call-argument",ownerQualifiedName:names[1],field:"value",targetQualifiedName:names[2],evidence:ev(3),analysisSourceHash:hash}]};}
test("neutral topology survives symbol rename",t=>{const a=fixture(t),b=fixture(t,["One","Two","Three"]),scope=x=>({repositories:[{id:"repo",root:x.root}]});const left=buildValueFlow(a.relations,["Alpha"],scope(a)),right=buildValueFlow(b.relations,["One"],scope(b));assert.deepEqual(left.map(x=>x.relation).sort(),right.map(x=>x.relation).sort());assert.equal(left.every(x=>x.status==="source-confirmed"),true);});
test("obligation tree keeps late forks as separate leaves",t=>{const f=fixture(t),edges=buildValueFlow(f.relations,["Alpha"],{repositories:[{id:"repo",root:f.root}]}),roots=buildObligationTree(edges),tree=validateObligationTree(roots,[]),leaf=roots.find(row=>row.id===tree.leaves[0]),children=splitObligation(leaf,[{key:"a",frontier:"A"},{key:"b",frontier:"B"}]),all=[...roots,...children],leaves=validateObligationTree(all,[]).leaves,outcomes=leaves.map((id,index)=>({id:`path-${index}`,obligationRefs:[id]}));assert.equal(validateObligationTree(all,outcomes).ok,true);assert.equal(children.length,2);});
test("mixed terminal accounting rejects outcome on parent and missing leaf",()=>{const root={id:"root",status:"open"},children=splitObligation(root,[{key:"a",frontier:"A"},{key:"b",frontier:"B"}]);const result=validateObligationTree([root,...children],[{id:"positive",obligationRefs:[root.id]},{id:"absence",obligationRefs:[children[0].id]}]);assert.equal(result.ok,false);assert.match(result.errors.join("\n"),/non-leaf|exactly one/);});
test("unconfirmed reachable edge remains an unresolved terminal obligation",t=>{const f=fixture(t);f.relations[2].dynamic=true;f.relations[2].evidence[0].confidence="candidate";const edges=buildValueFlow(f.relations,["Alpha"],{repositories:[{id:"repo",root:f.root}]}),obligations=buildObligationTree(edges),unresolved=obligations.find(row=>row.status==="unresolved"&&row.reason==="unconfirmed-edge"),parents=new Set(obligations.map(row=>row.parentObligationRef).filter(Boolean)),outcomes=obligations.filter(row=>!parents.has(row.id)&&row.status!=="unresolved").map(row=>({obligationRefs:[row.id]}));assert.equal(Boolean(unresolved),true);assert.equal(validateObligationTree(obligations,outcomes).ok,true);});
test("fan-in obligation stays open when every incoming chain is confirmed",t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"value-flow-fanin-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,"fanin.js"),text=["const one = new Beta();","const two = new Delta();","holder.value = one;","holder.value = two;","consume(holder.value);","\n"].join("\n");
  fs.writeFileSync(file,text);
  const hash=crypto.createHash("sha256").update(text).digest("hex"),ev=line=>[{file,range:{start:{line},end:{line}},confidence:"exact"}];
  const relations=[
    {relation:"construct",targetQualifiedName:"Alpha",sourceSymbol:"Beta",evidence:ev(1),analysisSourceHash:hash},
    {relation:"construct",targetQualifiedName:"Alpha",sourceSymbol:"Alpha2",evidence:ev(2),analysisSourceHash:hash},
    {relation:"field-write",ownerQualifiedName:"Beta",field:"value",targetQualifiedName:"Alpha",evidence:ev(3),analysisSourceHash:hash},
    {relation:"field-write",ownerQualifiedName:"Beta",field:"value",targetQualifiedName:"Alpha2",evidence:ev(4),analysisSourceHash:hash},
    {relation:"field-to-call-argument",ownerQualifiedName:"Beta",field:"value",targetQualifiedName:"Gamma",evidence:ev(5),analysisSourceHash:hash},
  ];
  const scope={repositories:[{id:"repo",root}]};
  const confirmedEdges=buildValueFlow(relations,["Alpha"],scope);
  const confirmedTree=buildObligationTree(confirmedEdges);
  const fanIn=confirmedTree.find(row=>row.frontier==="Gamma");
  assert.equal(Boolean(fanIn),true,"fan-in obligation for Gamma is expected");
  assert.equal(fanIn.status,"open","all incoming chains confirmed, fan-in must stay open");
  assert.equal(fanIn.reason,undefined);
  const edgeIds=new Set(confirmedEdges.map(row=>row.id));
  for(const ref of fanIn.edgeRefs)assert.equal(edgeIds.has(ref),true,`edgeRefs must name known edges: ${ref}`);
  assert.equal(fanIn.edgeRefs.length>=4,true,"fan-in edgeRefs must cover both incoming chains plus the fan-out edge");
  const parents=new Set(confirmedTree.map(row=>row.parentObligationRef).filter(Boolean));
  const openLeaves=confirmedTree.filter(row=>!parents.has(row.id)&&row.status!=="unresolved").map(row=>({obligationRefs:[row.id]}));
  assert.equal(validateObligationTree(confirmedTree,openLeaves).ok,true);
  const broken=structuredClone(relations);
  broken[3].dynamic=true;broken[3].evidence[0].confidence="candidate";
  const brokenTree=buildObligationTree(buildValueFlow(broken,["Alpha"],scope));
  const brokenFanIn=brokenTree.find(row=>row.frontier==="Gamma");
  assert.equal(brokenFanIn.status,"unresolved","unconfirmed incoming chain keeps the fan-in unresolved");
  assert.equal(brokenFanIn.reason,"unresolved-predecessor");
  const brokenParents=new Set(brokenTree.map(row=>row.parentObligationRef).filter(Boolean));
  const brokenOutcomes=brokenTree.filter(row=>!brokenParents.has(row.id)&&row.status!=="unresolved").map(row=>({obligationRefs:[row.id]}));
  assert.equal(validateObligationTree(brokenTree,brokenOutcomes).ok,true);
});
test("unresolved ancestry propagates through confirmed edges and late forks",t=>{const f=fixture(t);f.relations[1].dynamic=true;f.relations[1].evidence[0].confidence="candidate";const edges=buildValueFlow(f.relations,["Alpha"],{repositories:[{id:"repo",root:f.root}]}),obligations=buildObligationTree(edges),leaf=obligations.find(row=>row.frontier==="Gamma"),[fork]=splitObligation(leaf,[{key:"receiver",frontier:"Receiver"}]),otherLeaves=obligations.filter(row=>!obligations.some(child=>child.parentObligationRef===row.id)&&row.id!==leaf.id&&row.status!=="unresolved").map(row=>({obligationRefs:[row.id]}));assert.equal(leaf.status,"unresolved");assert.equal(leaf.reason,"unresolved-predecessor");assert.equal(fork.status,"unresolved");assert.equal(validateObligationTree([...obligations,fork],otherLeaves).ok,true);});
