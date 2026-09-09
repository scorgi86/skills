"use strict";
const { main } = require("../../../state/src/stage_state.js");
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
