"use strict";
const { runMatrix, toMarkdown } = require("../../../shared/search/src/feature_search_matrix.js");
function parseArgs(argv) {
    const args = {
        terms: [],
        scopes: [],
        json: false,
        ignoreCase: true,
        regex: false,
        limit: 500
    };
    for(let i = 0; i < argv.length; i += 1){
        const arg = argv[i];
        if (arg === "--term") args.terms.push(argv[++i]);
        else if (arg === "--terms") args.terms.push(...(argv[++i] || "").split(",").map((x)=>x.trim()).filter(Boolean));
        else if (arg === "--scope") args.scopes.push(argv[++i]);
        else if (arg === "--json") args.json = true;
        else if (arg === "--case-sensitive") args.ignoreCase = false;
        else if (arg === "--regex") args.regex = true;
        else if (arg === "--limit") args.limit = Number(argv[++i]) || args.limit;
        else if (arg === "--help" || arg === "-h") {
            console.log("Usage: node scripts/cli/src/commands/feature_search_matrix.js --terms TargetFeature,FeatureAlias --scope <repository-root> [--json] [--regex] [--limit 500]");
            process.exit(0);
        } else {
            args.terms.push(arg);
        }
    }
    if (args.scopes.length === 0) throw new Error("Search roots are required. Ask the user for the folders to search.");
    return args;
}
function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.terms.length) {
        console.error("ERROR: pass --term, --terms, or positional terms");
        process.exit(2);
    }
    const output = runMatrix(args);
    if (args.json) console.log(JSON.stringify(output, null, 2));
    else console.log(toMarkdown(output));
    process.exit(output.errors.length ? 1 : 0);
}
module.exports = main;
if (require.main === module) main();
