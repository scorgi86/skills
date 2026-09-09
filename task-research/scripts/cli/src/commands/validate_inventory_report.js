"use strict";
const path = require("path");
const fs = require("fs");
const { validate } = require("../../../shared/report/src/markdown/validate_report.js");
function usage() {
    console.log("Usage: node scripts/cli/src/commands/validate_inventory_report.js <report.md> [--json] [--strict] [--warnings-as-errors]");
}
function parseArgs(argv) {
    const args = {
        file: "",
        json: false,
        strict: false,
        warningsAsErrors: false
    };
    for (const arg of argv){
        if (arg === "--help" || arg === "-h") {
            usage();
            process.exit(0);
        } else if (arg === "--json") {
            args.json = true;
        } else if (arg === "--strict") {
            args.strict = true;
        } else if (arg === "--warnings-as-errors") {
            args.warningsAsErrors = true;
        } else if (!args.file) {
            args.file = arg;
        }
    }
    if (!args.file) {
        usage();
        process.exit(2);
    }
    return args;
}
function main() {
    const args = parseArgs(process.argv.slice(2));
    const file = path.resolve(args.file);
    if (!fs.existsSync(file)) {
        console.error(`Report not found: ${file}`);
        process.exit(2);
    }
    const raw = fs.readFileSync(file, "utf8");
    const result = validate(raw, {
        strict: args.strict
    });
    if (args.warningsAsErrors && result.warnings.length > 0) {
        result.errors.push(...result.warnings.map((warning)=>`WARN-AS-ERROR: ${warning}`));
        result.warnings = [];
        result.ok = false;
    }
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(result.ok ? "OK: inventory report validation passed" : "FAILED: inventory report validation failed");
        for (const error of result.errors)console.log(`ERROR: ${error}`);
        for (const warning of result.warnings)console.log(`WARN: ${warning}`);
    }
    process.exit(result.ok ? 0 : 1);
}
module.exports = main;
if (require.main === module) main();
