"use strict";
const fs = require("fs");
const path = require("path");
const { extractTransition } = require("../../../shared/dto/src/extract_stage_transition.js");
function main() {
    try {
        const file = process.argv[process.argv.indexOf("--file") + 1];
        if (!file) throw new Error("Provide --file <stage-artifact>");
        process.stdout.write(`${JSON.stringify(extractTransition(fs.readFileSync(path.resolve(file), "utf8")))}\n`);
    } catch (error) {
        process.stdout.write(`${JSON.stringify({
            valid: false,
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
