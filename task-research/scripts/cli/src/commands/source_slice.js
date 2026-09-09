"use strict";
const fs = require("fs");
const path = require("path");
const { parseArgs, buildSourceSlices } = require("../../../shared/evidence/src/source_slice.js");
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const summary = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
        const output = buildSourceSlices(summary, options);
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
