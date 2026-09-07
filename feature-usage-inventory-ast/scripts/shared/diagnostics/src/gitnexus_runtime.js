"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
function packageRunner(directory) {
  const manifest=path.join(directory,"package.json");
  if (!fs.existsSync(manifest)) return null;
  const metadata=JSON.parse(fs.readFileSync(manifest,"utf8"));
  const bin=typeof metadata.bin === "string" ? metadata.bin : metadata.bin && metadata.bin.gitnexus;
  return bin && fs.existsSync(path.resolve(directory,bin)) ? path.resolve(directory,bin) : null;
}
function resolveGitNexus(config={}, args=[]) {
  if(config.runnerPath) return {command:process.execPath,args:[path.resolve(config.runnerPath),...args],shell:false,source:"local"};
  const command=config.command || "gitnexus";
  const directories = path.isAbsolute(command) ? [path.dirname(command)] : [config.cwd || process.cwd(), ...(process.env.PATH || "").split(path.delimiter), ...(process.env.APPDATA ? [path.join(process.env.APPDATA,"npm")] : [])];
  for(const directory of directories) {
    const runner=packageRunner(path.join(directory,"node_modules","gitnexus"));
    if(runner) return {command:process.execPath,args:[runner,...args],shell:false,source:"package"};
  }
  if(/\.(cmd|bat)$/i.test(command)) throw new Error(`Cannot safely invoke GitNexus shim ${command}; configure runnerPath to its Node.js entry point`);
  return {command,args,shell:false,source:"global"};
}
function invokeGitNexus(config={}, args=[], dependencies={}) {
  let call;
  try {
    call=resolveGitNexus(config,args);
    const result=(dependencies.spawnSync || spawnSync)(call.command,call.args,{cwd:config.cwd,encoding:"utf8",windowsHide:true,shell:false,timeout:config.timeoutMs || 30000});
    const error=result.error && `${result.error.code || "PROCESS_ERROR"}: ${result.error.message}${result.error.code === "EPERM" ? "; process execution is denied; use an authorized runtime or report tool-unavailable" : ""}`;
    return {ok:!result.error && result.status===0,status:result.status,stdout:String(result.stdout || "").trim(),stderr:String(result.stderr || "").trim(),error,invocation:call};
  } catch(error) {return {ok:false,status:null,stdout:"",stderr:"",error:error.message,invocation:call};}
}
module.exports={resolveGitNexus,invokeGitNexus};
