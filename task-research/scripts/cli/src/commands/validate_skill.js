"use strict";
const path = require("path");
const { validateSkill } = require("../../../shared/diagnostics/src/validate_skill.js");
function usage() {
    console.log("Usage: node scripts/cli/src/commands/validate_skill.js [skill-dir] [--json]");
}
function parseArgs(argv) {
    const args = {
        skillDir: path.resolve(require("node:path").resolve(__dirname, "../../.."), ".."),
        json: false
    };
    for (const arg of argv){
        if (arg === "--help" || arg === "-h") {
            usage();
            process.exit(0);
        } else if (arg === "--json") {
            args.json = true;
        } else {
            args.skillDir = path.resolve(arg);
        }
    }
    return args;
}
function main() {
    const args = parseArgs(process.argv.slice(2));
    const result = validateSkill(args);
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(result.ok ? "OK: skill validation passed" : "FAILED: skill validation failed");
        for (const error of result.errors)console.log(`ERROR: ${error}`);
        for (const warning of result.warnings)console.log(`WARN: ${warning}`);
    }
    process.exit(result.ok ? 0 : 1);
}
module.exports = main;
if (require.main === module) main();
