"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runStage6, buildSummary } = require("../../../steps/step-6/src/runner.js");
function main() {
    try {
        const args = process.argv.slice(2);
        const get = (flag)=>args[args.indexOf(flag) + 1];
        const request = get("--request");
        if (!request) throw new Error("Provide --request <json-file>");
        const result = runStage6(JSON.parse(fs.readFileSync(path.resolve(request), "utf8")));
        const output = get("--output");
        if (output) {
            fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
            process.stdout.write(`${JSON.stringify(buildSummary(result, output))}\n`);
        } else process.stdout.write(`${JSON.stringify(result)}\n`);
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
