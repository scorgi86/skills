"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runStage4, buildSummary } = require("../../../steps/step-4/src/runner.js");
function main() {
    try {
        const requestIndex = process.argv.indexOf("--request");
        if (requestIndex < 0 || !process.argv[requestIndex + 1]) throw new Error("Provide --request <json-file>");
        const result = runStage4(JSON.parse(fs.readFileSync(path.resolve(process.argv[requestIndex + 1]), "utf8")));
        const outputIndex = process.argv.indexOf("--output");
        if (outputIndex >= 0) {
            if (!process.argv[outputIndex + 1]) throw new Error("Provide a file after --output");
            const outputFile = path.resolve(process.argv[outputIndex + 1]);
            fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
            process.stdout.write(`${JSON.stringify(buildSummary(result, outputFile))}\n`);
            return;
        }
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
