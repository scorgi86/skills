"use strict";
const { parseArgs, runDiagnostics } = require("../../../shared/diagnostics/src/diagnose.js");
function usage() {
    console.log("Usage: node scripts/cli/src/commands/diagnose.js [--indexes index-a,index-b] [--strict] [--pretty]");
}
function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        usage();
        process.exit(2);
    }
    if (args.help) {
        usage();
        return;
    }
    const result = runDiagnostics(args);
    console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.exit(result.status === "ready" ? 0 : result.status === "degraded" ? 1 : 2);
}
module.exports = main;
if (require.main === module) main();
