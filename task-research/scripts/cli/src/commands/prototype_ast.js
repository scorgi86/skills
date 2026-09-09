"use strict";
const { applyOutputPolicy, DEFAULT_OUTPUT_BUDGET } = require("../../../shared/ast/src/output/policy.js");
const { parseArgs, envelope, execute } = require("../../../shared/ast/src/prototype_ast.js");
function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        process.stdout.write(`${JSON.stringify(envelope("arguments", null, null, [], [
            {
                message: error.message
            }
        ]))}\n`);
        process.exitCode = 2;
        return;
    }
    const { output, exitCode } = execute(options);
    applyOutputPolicy(output, options);
    const spacing = options.format === "pretty" ? 2 : 0;
    process.stdout.write(`${JSON.stringify(output, null, spacing)}\n`);
    process.exitCode = exitCode;
}
module.exports = main;
if (require.main === module) main();
