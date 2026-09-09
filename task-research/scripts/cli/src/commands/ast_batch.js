"use strict";
const fs = require("fs");
const path = require("path");
const { runAstBatch } = require("../../../shared/ast/src/batch/batch.js");
const { parseArgs } = require("../../../shared/ast/src/batch/ast_batch.js");
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const request = JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8"));
        const output = runAstBatch(request);
        const text = `${JSON.stringify(output, null, options.format === "pretty" ? 2 : 0)}\n`;
        if (options.output) fs.writeFileSync(path.resolve(options.output), text);
        process.stdout.write(text);
        if (!output.output.bounded) process.exitCode = 1;
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
