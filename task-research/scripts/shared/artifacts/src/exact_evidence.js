"use strict";
const crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const {artifactLocation}=require("./artifact_location.js");
const {canonicalJson}=require("../../report/src/model/serialization.js");
const {keyOf}=require("../../evidence/src/canonicalization/candidate_identity.js");

function payload(row){const value={...row};for(const field of ["id","aliases","provenance","evidenceRefs"])delete value[field];return value;}
function payloadDigest(row){return crypto.createHash("sha256").update(canonicalJson(payload(row))).digest("hex");}
function identityKey(row,repositoryScope){return row.file||row.path?keyOf(row,{repositoryScope}):`unanchored:${payloadDigest(row)}`;}
function pairOf(row,repositoryScope){return `${identityKey(row,repositoryScope)}\0${payloadDigest(row)}`;}
function readCanonicalEvidence(artifact){
  const root=artifactLocation(artifact).root,file=path.join(root,"canonical","evidence.json"),value=JSON.parse(fs.readFileSync(file,"utf8"));
  return (value.evidence||[]).map(row=>{const {fileId,...expanded}=row;return {...expanded,file:Number.isInteger(fileId)?value.files[fileId]:row.file};});
}
function matchesRef(row,ref){return row.id===ref||(row.aliases||[]).includes(ref);}
function resolveExact(rows,ids,repositoryScope){
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=="string"||!id))throw new Error("Exact evidence ids must be a non-empty string array");
  if(new Set(ids).size!==ids.length)throw new Error("Exact evidence ids must be unique");
  const selected=[];
  for(const id of ids){const matches=rows.filter(row=>matchesRef(row,id));if(!matches.length)throw new Error(`Missing exact evidence id: ${id}`);const pairs=new Set(matches.map(row=>pairOf(row,repositoryScope)));if(pairs.size!==1)throw new Error(`Ambiguous exact evidence id: ${id}`);selected.push(matches.sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0]);}
  return [...new Map(selected.map(row=>[pairOf(row,repositoryScope),row])).values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
}
module.exports={identityKey,matchesRef,pairOf,payloadDigest,readCanonicalEvidence,resolveExact};
