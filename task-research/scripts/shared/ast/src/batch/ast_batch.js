"use strict";

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

module.exports = { parseArgs };
