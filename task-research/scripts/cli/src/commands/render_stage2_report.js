"use strict";
const fs = require("fs");
const path = require("path");
const { parseArgs, renderStage2Report } = require("../../../steps/step-2/src/render_stage2_report.js");
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const facts = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
        const output = renderStage2Report(facts, options.format);
        const artifact = options.output ? path.resolve(options.output) : null;
        if (artifact) fs.writeFileSync(artifact, output);
        if (options.stdout === "summary") {
            process.stdout.write(`${JSON.stringify({
                status: "rendered",
                format: options.format,
                artifact,
                bytes: Buffer.byteLength(output, "utf8")
            })}\n`);
        } else {
            process.stdout.write(output);
        }
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
