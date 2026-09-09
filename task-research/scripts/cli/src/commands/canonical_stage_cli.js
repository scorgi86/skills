"use strict";
const fs = require("node:fs"), path = require("node:path");
const { writeStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
function parseArgs(argv) {
    const options = {
        retainRaw: false
    };
    for(let index = 0; index < argv.length; index += 1){
        const arg = argv[index];
        if (arg === "--retain-raw") options.retainRaw = true;
        else if ([
            "--facts",
            "--request",
            "--output",
            "--usage",
            "--budgets"
        ].includes(arg)) {
            if (!argv[index + 1]) throw new Error(`Missing value for ${arg}`);
            options[arg.slice(2)] = argv[++index];
        } else throw new Error(`Unknown option: ${arg}`);
    }
    if (!options.facts || !options.output) throw new Error("Provide --facts <runner-result.json> --output <stage-directory>");
    return options;
}
function read(file, fallback = {}) {
    return file ? JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) : fallback;
}
function run(options) {
    const facts = read(options.facts), input = read(options.request), usage = options.usage ? read(options.usage) : null, budgets = options.budgets ? read(options.budgets) : {};
    return writeStageArtifact({
        outputDir: options.output,
        facts,
        input,
        usage,
        retainRaw: options.retainRaw,
        metrics: {
            budgets
        }
    });
}
function main() {
    try {
        const written = run(parseArgs(process.argv.slice(2)));
        process.stdout.write(`${JSON.stringify({
            schemaVersion: "canonical-stage-cli/2.0.0",
            status: "ok",
            stage: written.canonical.stage,
            canonicalArtifact: written.resultFile,
            manifest: written.manifestFile,
            rawRetained: Boolean(written.rawFile),
            usage: written.canonical.usage,
            metrics: written.canonical.metrics
        })}\n`);
    } catch (error) {
        process.stdout.write(`${JSON.stringify({
            schemaVersion: "canonical-stage-cli/2.0.0",
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
module.exports = Object.assign(main, {
    parseArgs,
    run
});
if (require.main === module) main();
