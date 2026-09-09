"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
// File descriptors avoid spawnSync's pipe maxBuffer while preserving a synchronous API.
function runFileBacked(command, args, options = {}, dependencies = {}) {
  let directory; let phase="storage"; const descriptors=[];
  try {
    directory = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), "inventory-process-"));
    const stdoutPath=path.join(directory,"stdout"); const stderrPath=path.join(directory,"stderr");
    descriptors.push(fs.openSync(stdoutPath,"wx"));
    descriptors.push(fs.openSync(stderrPath,"wx"));
    phase="process";
    const result=(dependencies.spawnSync || childProcess.spawnSync)(command,args,{encoding:"utf8",windowsHide:true,shell:false,...options,stdio:["ignore",...descriptors]});
    phase="storage";
    for(const fd of descriptors.splice(0)) fs.closeSync(fd);
    const stdout=fs.readFileSync(stdoutPath,"utf8"), stderr=fs.readFileSync(stderrPath,"utf8");
    phase="result";
    if(result.error) { const error=new Error(`${command} process failed (${result.error.code || "unknown"}): ${result.error.message}`); error.code=result.error.code; error.partialOutput=Boolean(stdout); throw error; }
    if(result.signal || ![0,1].includes(result.status)) { const error=new Error(`${command} incomplete output: ${stderr.trim() || result.signal || `exit ${result.status}`}`); error.code="PROCESS_INCOMPLETE"; error.partialOutput=Boolean(stdout); throw error; }
    return { ...result, stdout: stdout || String(result.stdout || ""), stderr: stderr || String(result.stderr || "") };
  } catch(error) {
    if(phase === "storage") error.message=`Subprocess output storage failed (${error.code}): ${error.message}`;
    throw error;
  } finally {
    for(const fd of descriptors) fs.closeSync(fd);
    if(directory) fs.rmSync(directory,{recursive:true,force:true});
  }
}
module.exports={runFileBacked};
