"use strict";
const fs = require("fs");
const path = require("path");
const { compareStageRepresentations } = require("../../../shared/output/src/quality_equivalence.js");
function parseArgs(argv) {
    const options = {};
    for(let index = 0; index < argv.length; index += 1){
        const arg = argv[index];
        if (![
            "--before",
            "--after",
            "--request"
        ].includes(arg)) throw new Error(`Unknown option: ${arg}`);
        if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
        options[arg.slice(2)] = argv[++index];
    }
    if (!options.before || !options.after) throw new Error("Provide --before and --after JSON files");
    return options;
}
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const before = JSON.parse(fs.readFileSync(path.resolve(options.before), "utf8"));
        const after = JSON.parse(fs.readFileSync(path.resolve(options.after), "utf8"));
        const request = options.request ? JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8")) : {};
        const projection = request.projection || {};
        const result = compareStageRepresentations(before, after, {
            requiredGroups: projection.requiredGroups || {},
            requiredSourceGroups: projection.source && projection.source.requiredGroupKeys || {}
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (!result.ok) process.exitCode = 2;
    } catch (error) {
        process.stdout.write(`${JSON.stringify({
            status: "error",
            errors: [
                {
                    message: error.message
                }
            ]
        })}\n`);
        process.exitCode = 2;
    }
}
module.exports = main;
if (require.main === module) main();
