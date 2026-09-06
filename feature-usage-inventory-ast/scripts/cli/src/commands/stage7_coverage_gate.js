"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { validateReportModel } = require("../../../shared/report/src/model/validation.js");
function main() {
    const args = process.argv.slice(2), get = (flag)=>args[args.indexOf(flag) + 1], file = get("--facts");
    if (!file) throw new Error("Provide --facts <report-model.json>");
    const model = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")), result = validateReportModel(model);
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
