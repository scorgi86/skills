"use strict";

function requiredOptions(args, names) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!names.includes(flag)) throw new Error(`Unknown option: ${flag}`);
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (options[flag]) throw new Error(`Duplicate option: ${flag}`);
    options[flag] = args[i + 1];
  }
  for (const name of names) if (!options[name]) throw new Error(`Provide ${name} <value>`);
  return options;
}
module.exports = { requiredOptions };
