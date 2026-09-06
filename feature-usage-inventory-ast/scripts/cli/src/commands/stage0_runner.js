"use strict";
const fs = require("fs");
const path = require("path");
const { runStage0 } = require("../../../steps/step-0/src/runner.js");
function main() {
    try {
        const args = process.argv.slice(2);
        const requestAt = args.indexOf("--request");
        const outputAt = args.indexOf("--output");
        const stdoutAt = args.indexOf("--stdout");
        if (requestAt < 0 || !args[requestAt + 1]) throw new Error("Usage: --request <json> [--output <facts.json>] [--stdout summary|full]");
        const facts = runStage0(JSON.parse(fs.readFileSync(path.resolve(args[requestAt + 1]), "utf8")));
        if (outputAt >= 0 && args[outputAt + 1]) fs.writeFileSync(path.resolve(args[outputAt + 1]), `${JSON.stringify(facts, null, 2)}\n`);
        const mode = stdoutAt >= 0 ? args[stdoutAt + 1] : "summary";
        if (!new Set([
            "summary",
            "full"
        ]).has(mode)) throw new Error("--stdout must be summary or full");
        process.stdout.write(`${JSON.stringify(mode === "full" ? facts : facts.summary)}\n`);
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
