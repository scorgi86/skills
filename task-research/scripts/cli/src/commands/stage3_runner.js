"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runStage3 } = require("../../../steps/step-3/src/runner.js");
function main() {
    try {
        const index = process.argv.indexOf("--request");
        if (index < 0 || !process.argv[index + 1]) throw new Error("Provide --request <json-file>");
        const request = JSON.parse(fs.readFileSync(path.resolve(process.argv[index + 1]), "utf8"));
        const result = runStage3(request);
        const outputIndex = process.argv.indexOf("--output");
        if (outputIndex >= 0) {
            if (!process.argv[outputIndex + 1]) throw new Error("Provide a file after --output");
            fs.writeFileSync(path.resolve(process.argv[outputIndex + 1]), `${JSON.stringify(result, null, 2)}\n`);
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
