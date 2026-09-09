"use strict";
const fs = require("fs");
const path = require("path");
const { parseArgs, measureContext } = require("../../../shared/output/src/measure_context.js");
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const request = JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8"));
        const result = measureContext(request);
        const text = `${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`;
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
