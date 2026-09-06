"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, runStagePipeline } = require("../../../flows/full-flow/src/stage_pipeline.js");
function main() {
    try {
        const args = parseArgs(process.argv.slice(2));
        const request = JSON.parse(fs.readFileSync(path.resolve(args.request), "utf8"));
        const usage = args.usage ? JSON.parse(fs.readFileSync(path.resolve(args.usage), "utf8")) : null;
        const result = runStagePipeline({
            request,
            stateFile: args.state && path.resolve(args.state),
            outputRoot: args["output-root"] && path.resolve(args["output-root"]),
            usage,
            retainRaw: args.retainRaw
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
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
