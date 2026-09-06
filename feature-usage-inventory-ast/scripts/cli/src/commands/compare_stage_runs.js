"use strict";
const path = require("path");
const fs = require("fs");
const { compareStageRuns } = require("../../../shared/output/src/compare_stage_runs.js");
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
        const beforePath = path.resolve(options.before);
        const afterPath = path.resolve(options.after);
        const beforeText = fs.readFileSync(beforePath, "utf8");
        const afterText = fs.readFileSync(afterPath, "utf8");
        const request = options.request ? JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8")) : {};
        const projection = request.projection || {};
        const result = compareStageRuns(JSON.parse(beforeText), JSON.parse(afterText), {
            beforeBytes: Buffer.byteLength(beforeText),
            afterBytes: Buffer.byteLength(afterText),
            requiredGroups: projection.requiredGroups || {},
            requiredSourceGroups: projection.source && projection.source.requiredGroupKeys || {}
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (!result.equivalence.ok) process.exitCode = 2;
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
