"use strict";
const { validateSkill } = require("../../../shared/diagnostics/src/quick_validate.js");
function main() {
    if (process.argv.length !== 3) {
        console.log("Usage: node scripts/cli/src/commands/quick_validate.js <skill_directory>");
        process.exit(1);
    }
    const result = validateSkill(process.argv[2]);
    console.log(result.message);
    process.exit(result.valid ? 0 : 1);
}
module.exports = main;
if (require.main === module) main();
