"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { batchSourceAnchors } = require("../../../shared/evidence/src/batch_source_anchors.js");

function main() {
  try {
    const args = process.argv.slice(2);
    const option = (flag) => args[args.indexOf(flag) + 1];
    const input = option("--request"), output = option("--output");
    if (!input || !output || input.startsWith("--") || output.startsWith("--")) throw new Error("Provide --request <json> --output <json>");
    const requestPath = path.resolve(input), outputPath = path.resolve(output);
    if (requestPath === outputPath) throw new Error("Input and output must differ");
    const { request, count } = batchSourceAnchors(JSON.parse(fs.readFileSync(requestPath, "utf8")));
    const file = fs.openSync(outputPath, "wx");
    try {
      fs.writeFileSync(file, `${JSON.stringify(request, null, 2)}\n`);
      fs.closeSync(file);
    } catch (error) {
      try { fs.closeSync(file); } catch {}
      fs.unlinkSync(outputPath);
      throw error;
    }
    process.stdout.write(`${JSON.stringify({ status: "ok", output: outputPath, count })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ code: error.code || "batch-source-anchors", message: error.message, ...(error.index !== undefined ? { index: error.index, id: error.id } : {}) }] })}\n`);
    process.exitCode = 2;
  }
}
module.exports = main;
if (require.main === module) main();
