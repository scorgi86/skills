"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { validateReportModel } = require("../../../shared/report/src/model/validation.js");
const { unwrapModel } = require("../../../steps/step-8/src/runner.js");
const { requiredOptions } = require("../options.js");
function main() {
    const file = requiredOptions(process.argv.slice(2), ["--facts"])["--facts"];
    const model = unwrapModel(JSON.parse(fs.readFileSync(path.resolve(file), "utf8"))), result = validateReportModel(model);
    console.log(JSON.stringify({
        gate: "stage7-report-model",
        status: result.ok ? "covered" : "missing",
        digest: result.canonicalDigest,
        counts: result.counts,
        errors: result.errors
    }));
    if (!result.ok) process.exitCode = 1;
}
function runCli() {
    try {
        main();
    } catch (error) {
        console.log(JSON.stringify({
            status: "error",
            errors: [
                {
                    message: error.message
                }
            ]
        }));
        process.exitCode = 2;
    }
}
module.exports = runCli;
if (require.main === module) runCli();
