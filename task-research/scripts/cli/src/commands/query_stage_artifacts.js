"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, queryStageArtifacts } = require("../../../shared/artifacts/src/query_stage_artifacts.js");
function main() {
    try {
        const options = parseArgs(process.argv.slice(2)), result = queryStageArtifacts(options), output = `${JSON.stringify(result, null, 2)}\n`;
        if (options.output) fs.writeFileSync(path.resolve(options.output), output);
        else process.stdout.write(output);
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
