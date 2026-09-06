"use strict";
const fs = require("fs");
const path = require("path");
const { encodeHumanFields, decodeHumanFields } = require("../../../shared/output/src/human_report_codec.js");
function parseArgs(argv) {
    const options = {};
    for(let index = 0; index < argv.length; index += 1){
        const arg = argv[index];
        if (![
            "--input",
            "--output",
            "--mode"
        ].includes(arg)) throw new Error(`Unknown option: ${arg}`);
        if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
        options[arg.slice(2)] = argv[++index];
    }
    if (!options.input) throw new Error("Provide --input <json-file>");
    if (![
        "encode",
        "decode"
    ].includes(options.mode)) throw new Error("Provide --mode encode|decode");
    return options;
}
function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const input = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
        const output = options.mode === "encode" ? encodeHumanFields(input) : decodeHumanFields(input);
        const rendered = `${JSON.stringify(output)}\n`;
        if (options.output) fs.writeFileSync(path.resolve(options.output), rendered);
        else process.stdout.write(rendered);
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
