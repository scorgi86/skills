"use strict";
const path = require('path');
const fs = require('fs');
const { validate } = require("../../../shared/report/src/validate_inventory_stage.js");
function usage() {
    return [
        'Usage: node scripts/cli/src/commands/validate_inventory_stage.js <artifact.md> --stage N [--json] [--warnings-as-errors]',
        '',
        'Checks one stage-gated inventory artifact. The artifact must contain only the current stage gate,',
        'with required gate blocks and a structured transition artifact for the next stage.'
    ].join('\n');
}
function parseArgs(argv) {
    const args = {
        file: null,
        stage: null,
        json: false,
        warningsAsErrors: false
    };
    for(let i = 0; i < argv.length; i += 1){
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') args.help = true;
        else if (arg === '--json') args.json = true;
        else if (arg === '--warnings-as-errors') args.warningsAsErrors = true;
        else if (arg === '--stage') {
            args.stage = Number(argv[i + 1]);
            i += 1;
        } else if (!args.file) args.file = arg;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return args;
}
function printResult(result, args, filePath) {
    const finalOk = result.ok && !(args.warningsAsErrors && result.warnings.length > 0);
    if (args.json) {
        console.log(JSON.stringify({
            ok: finalOk,
            file: filePath,
            stage: args.stage,
            errors: result.errors,
            warnings: result.warnings
        }, null, 2));
        return finalOk;
    }
    if (finalOk) console.log(`OK: stage ${args.stage} artifact passed validation: ${filePath}`);
    else console.error(`FAILED: stage ${args.stage} artifact failed validation: ${filePath}`);
    for (const error of result.errors)console.error(`ERROR: ${error}`);
    for (const warning of result.warnings){
        const stream = args.warningsAsErrors ? console.error : console.warn;
        stream(`${args.warningsAsErrors ? 'ERROR' : 'WARNING'}: ${warning}`);
    }
    return finalOk;
}
function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        console.error(usage());
        process.exit(2);
    }
    if (args.help) {
        console.log(usage());
        return;
    }
    if (!args.file || args.stage === null || Number.isNaN(args.stage)) {
        console.error(usage());
        process.exit(2);
    }
    const filePath = path.resolve(args.file);
    if (!fs.existsSync(filePath)) {
        console.error(`Artifact not found: ${filePath}`);
        process.exit(2);
    }
    const result = validate(fs.readFileSync(filePath, 'utf8'), args.stage);
    process.exit(printResult(result, args, filePath) ? 0 : 1);
}
module.exports = main;
if (require.main === module) main();
