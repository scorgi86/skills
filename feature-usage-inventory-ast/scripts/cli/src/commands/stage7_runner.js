"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { buildStage7, readJson, formatFacts, buildSummary } = require("../../../steps/step-7/src/runner.js");
function main() {
    try {
        const args = process.argv.slice(2);
        const get = (flag)=>args[args.indexOf(flag) + 1];
        const requestFile = get("--request");
        const output = get("--output");
        if (!requestFile || !output) throw new Error("Provide --request <json-file> --output <facts.json>");
        const absoluteRequest = path.resolve(requestFile);
        const facts = buildStage7(readJson(absoluteRequest), {
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
