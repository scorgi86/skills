"use strict";

const path = require("node:path");
const { runFullResearch } = require("../../../flows/full-flow/src/full_run.js");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!["--package", "--state", "--output-root", "--metrics"].includes(name) || !argv[index + 1]) throw new Error(`Unknown or incomplete option: ${name}`);
    options[name.slice(2)] = argv[++index];
  }
  for (const name of ["package", "state", "output-root"]) if (!options[name]) throw new Error(`Provide --${name} <path>`);
  return options;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runFullResearch({ packageFile: path.resolve(args.package), stateFile: path.resolve(args.state), outputRoot: path.resolve(args["output-root"]), metricsFile: args.metrics && path.resolve(args.metrics) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "partial") process.exitCode = 3;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

module.exports = main;
module.exports.parseArgs = parseArgs;
if (require.main === module) void main();
