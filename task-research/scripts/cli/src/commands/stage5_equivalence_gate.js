"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { compareStage5Facts } = require("../../../steps/step-5/src/stage5_equivalence_gate.js");
function main() {
    try {
        const args = process.argv.slice(2);
        const get = (flag)=>args[args.indexOf(flag) + 1];
        const baselineFile = get("--baseline");
        const candidateFile = get("--candidate");
        if (!baselineFile || !candidateFile) throw new Error("Provide --baseline <facts.json> --candidate <facts.json>");
        const result = compareStage5Facts(JSON.parse(fs.readFileSync(path.resolve(baselineFile), "utf8")), JSON.parse(fs.readFileSync(path.resolve(candidateFile), "utf8")));
        const output = get("--output");
        if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify({
            gate: result.gate,
            status: result.status,
            checks: result.checks.length,
            coverageEqual: result.coverage.equal,
            freshnessEqual: result.sourceFreshness.equal,
            output: output ? path.resolve(output) : null
        })}\n`);
        if (result.status !== "equivalent") process.exitCode = 1;
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
