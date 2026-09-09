"use strict";
const fs = require("fs");
const path = require("path");
const { parseArgs, runStage2, buildStage2Summary } = require("../../../steps/step-2/src/runner.js");
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const request = JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8"));
        const facts = runStage2(request);
        const fullText = `${JSON.stringify(facts, null, options.pretty ? 2 : 0)}\n`;
        const artifact = options.output ? path.resolve(options.output) : null;
        if (artifact) fs.writeFileSync(artifact, fullText);
        const stdoutValue = options.stdout === "summary" ? buildStage2Summary(facts, artifact) : facts;
        process.stdout.write(`${JSON.stringify(stdoutValue, null, options.pretty ? 2 : 0)}\n`);
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
