"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { buildContract } = require("../../../state/src/goal_contract.js");
function parseArgs(argv) {
    const index = argv.indexOf("--request");
    if (index < 0 || !argv[index + 1]) throw new Error("Provide --request <goal-contract.json>");
    return {
        request: argv[index + 1]
    };
}
function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    return buildContract(JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8")));
}
function runCli() {
    try {
        process.stdout.write(`${JSON.stringify(main())}\n`);
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
module.exports = runCli;
if (require.main === module) runCli();
