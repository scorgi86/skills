"use strict";
const fs = require("fs");
const path = require("path");
const { evaluateStage2Coverage } = require("../../../steps/step-2/src/coverage_gate.js");
function parseArgs(argv) {
    const options = {};
    for(let index = 0; index < argv.length; index += 1){
        const arg = argv[index];
        if (![
            "--input",
            "--require-plan"
        ].includes(arg)) throw new Error(`Unknown option: ${arg}`);
        if (arg === "--require-plan") options.requirePlan = true;
        else {
            if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
            options.input = argv[++index];
        }
    }
    if (!options.input) throw new Error("Provide --input <stage2-json>");
    return options;
}
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const value = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
        const result = evaluateStage2Coverage(value, options);
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
