#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { runAstBatch } = require("./ast/batch");

function parseArgs(argv) {
  const options = { format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--request", "--output", "--format"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = argv[++index];
  }
  if (!options.request) throw new Error("Provide --request <json-file>");
  if (!["json", "pretty"].includes(options.format)) throw new Error("format must be json or pretty");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const request = JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8"));
    const output = runAstBatch(request);
    const text = `${JSON.stringify(output, null, options.format === "pretty" ? 2 : 0)}\n`;
    if (options.output) fs.writeFileSync(path.resolve(options.output), text);
    process.stdout.write(text);
    if (!output.output.bounded) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { parseArgs };
