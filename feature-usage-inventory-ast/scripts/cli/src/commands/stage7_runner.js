"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { buildStage7, formatFacts, buildSummary } = require("../../../steps/step-7/src/runner.js");
const { requiredOptions } = require("../options.js");
function main() {
    try {
        const args = requiredOptions(process.argv.slice(2), ["--request", "--output"]);
        const requestFile = args["--request"], output = args["--output"];
        const absoluteRequest = path.resolve(requestFile);
        const request = JSON.parse(fs.readFileSync(absoluteRequest, "utf8"));
        if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Stage 7 request must be a JSON object");
        const facts = buildStage7(request, {
            artifactBase: path.dirname(absoluteRequest)
        });
        fs.writeFileSync(path.resolve(output), `${formatFacts(facts)}\n`);
        process.stdout.write(`${JSON.stringify(buildSummary(facts, output))}\n`);
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
