"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { resolveRequest, runStage1 } = require("../../../steps/step-1/src/runner.js");
const { buildStage1Summary } = require("../../../steps/step-1/src/summary.js");
function parseArgs(argv) {
    const options = {
        stdout: "full"
    };
    for(let index = 0; index < argv.length; index += 1){
        const arg = argv[index];
        if (![
            '--request',
            '--output',
            '--pretty',
            '--stdout'
        ].includes(arg)) throw new Error(`Unknown option: ${arg}`);
        if (arg === '--pretty') options.pretty = true;
        else {
            if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
            options[arg.slice(2)] = argv[++index];
        }
    }
    if (!options.request) throw new Error("Provide --request <json-file>");
    if (![
        "full",
        "summary"
    ].includes(options.stdout)) throw new Error("stdout must be full or summary");
    if (options.stdout === "summary" && !options.output) throw new Error("--stdout summary requires --output so full producer facts remain available");
    return options;
}
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const request = resolveRequest(JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8")));
        const facts = runStage1(request);
        const text = `${JSON.stringify(facts, null, options.pretty ? 2 : 0)}\n`;
        const artifact = options.output ? path.resolve(options.output) : null;
        if (artifact) fs.writeFileSync(artifact, text);
        const output = options.stdout === "summary" ? buildStage1Summary(facts, artifact) : facts;
        process.stdout.write(`${JSON.stringify(output, null, options.pretty ? 2 : 0)}\n`);
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
