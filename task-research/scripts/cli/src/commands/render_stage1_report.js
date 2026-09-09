"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { renderStage1Report } = require("../../../steps/step-1/src/render_stage1_report.js");
function parseArgs(argv) {
    const options = {};
    for(let index = 0; index < argv.length; index += 1){
        const arg = argv[index];
        if (![
            '--input',
            '--output',
            '--stdout'
        ].includes(arg)) throw new Error(`Unknown option: ${arg}`);
        if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
        options[arg.slice(2)] = argv[++index];
    }
    if (!options.input || !options.output) throw new Error("Provide --input <facts.json> --output <report.md>");
    return options;
}
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const report = renderStage1Report(JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8")));
        fs.writeFileSync(path.resolve(options.output), report);
        if (options.stdout === "summary") process.stdout.write(`${JSON.stringify({
            status: "rendered",
            output: path.resolve(options.output),
            bytes: Buffer.byteLength(report)
        })}\n`);
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
