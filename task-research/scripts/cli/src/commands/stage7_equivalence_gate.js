"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson, withoutIntegrity } = require("../../../shared/report/src/model/serialization.js");
const { validateReportModel } = require("../../../shared/report/src/model/validation.js");
const { compareStage7Facts } = require("../../../steps/step-7/src/stage7_equivalence_gate.js");
function main() {
    try {
        const args = process.argv.slice(2), get = (flag)=>{
            const index = args.indexOf(flag);
            return index >= 0 ? args[index + 1] : undefined;
        }, baselineFile = get("--baseline"), candidateFile = get("--candidate");
        if (!baselineFile || !candidateFile) throw new Error("Provide --baseline <report-model.json> --candidate <report-model.json>");
        const result = compareStage7Facts(JSON.parse(fs.readFileSync(path.resolve(baselineFile))), JSON.parse(fs.readFileSync(path.resolve(candidateFile))));
        const output = get("--output");
        if (output) fs.writeFileSync(path.resolve(output), canonicalJson(result));
        process.stdout.write(`${JSON.stringify({
            gate: result.gate,
            status: result.status,
            validation: result.validation,
            digests: result.digests,
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
