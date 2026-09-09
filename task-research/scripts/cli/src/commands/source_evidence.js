"use strict";
const fs = require("fs");
const path = require("path");
const { parseArgs, runEvidenceChecks } = require("../../../shared/evidence/src/collection/source_evidence.js");
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const output = runEvidenceChecks(JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8")));
        const text = `${JSON.stringify(output)}\n`;
        if (options.output) fs.writeFileSync(path.resolve(options.output), text);
        process.stdout.write(text);
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
