"use strict";
const { validateState } = require("../../../state/src/state_model.js");
const fs = require("node:fs");
const path = require("node:path");
const { run, unwrapModel } = require("../../../steps/step-8/src/runner.js");
function main() {
    try {
        const args = process.argv.slice(2), get = (flag)=>{
            const index = args.indexOf(flag);
            return index >= 0 ? args[index + 1] : undefined;
        }, modelFile = get("--model"), output = get("--output-dir"), stateFile = get("--state"), explicitDigest = get("--expected-digest");
        if (!modelFile || !output || !stateFile && !explicitDigest) throw new Error("Provide --model <report-model.json> --output-dir <directory> and --state <inventory-state.json> or --expected-digest <sha256>");
        let expectedDigest = explicitDigest;
        if (stateFile) {
            const state = validateState(JSON.parse(fs.readFileSync(path.resolve(stateFile), "utf8")));
            if (state.lastCompletedStage !== 7 || state.currentStage !== 8 || state.execution.runStatus !== "running" || !state.canonicalDigest) throw new Error("State does not record a running Stage 8 bound to a closed Stage 7 digest");
            expectedDigest = state.canonicalDigest;
        }
        const manifest = run(unwrapModel(JSON.parse(fs.readFileSync(path.resolve(modelFile), "utf8"))), path.resolve(output), expectedDigest);
        process.stdout.write(`${JSON.stringify({
            status: "closed",
            output: path.resolve(output),
            inputDigest: manifest.input.canonicalDigest,
            documents: manifest.outputs.length
        })}\n`);
    } catch (error) {
        process.stdout.write(`${JSON.stringify({
            status: "blocked",
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
