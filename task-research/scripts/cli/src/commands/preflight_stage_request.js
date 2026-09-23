"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { preflightStageRequest } = require("../../../flows/full-flow/src/preflight_stage_request.js");
const { defaultOutputRoot } = require("../../../flows/full-flow/src/stage_pipeline.js");

function main() {
  try {
    const args = process.argv.slice(2), values = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!["--request", "--state", "--output-root"].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Invalid option or missing value: ${args[index]}`);
      values[args[index]] = args[index + 1];
    }
    if (!values["--request"]) throw new Error("Provide --request <request.json>");
    const request = JSON.parse(fs.readFileSync(path.resolve(values["--request"]), "utf8"));
    const outputRoot = values["--output-root"] ? path.resolve(values["--output-root"]) : defaultOutputRoot(request);
    const result = preflightStageRequest(request, { outputRoot, stateFile: values["--state"] && path.resolve(values["--state"]) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "error") process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", stage: null, outputRoot: null, errors: [{ code: "request-invalid", path: "$", message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

module.exports = main;
if (require.main === module) main();
