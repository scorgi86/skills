"use strict";
const { split, compareMechanisms, toMarkdown } = require("../../../shared/search/src/compare_mechanisms.js");
function parseArgs(argv) {
    const args = {
        target: [],
        analog: [],
        scopes: [],
        json: false
    };
    for(let i = 0; i < argv.length; i += 1){
        const arg = argv[i];
        if (arg === "--target-terms") args.target.push(...split(argv[++i]));
        else if (arg === "--analog-terms") args.analog.push(...split(argv[++i]));
        else if (arg === "--scope") args.scopes.push(argv[++i]);
        else if (arg === "--json") args.json = true;
        else if (arg === "--follow-links" || arg === "--no-follow-links") {} else if (arg === "--help" || arg === "-h") {
            console.log("Usage: node scripts/cli/src/commands/compare_mechanisms.js --target-terms a,b --analog-terms c,d --scope <repository-root>");
            process.exit(0);
        }
    }
    if (!args.scopes.length) throw new Error("Search roots are required. Ask the user for the folders to search.");
    return args;
}
function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.target.length || !args.analog.length) {
        console.error("ERROR: pass --target-terms and --analog-terms");
        process.exit(2);
    }
    const result = compareMechanisms(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(toMarkdown(result));
}
module.exports = main;
if (require.main === module) main();
