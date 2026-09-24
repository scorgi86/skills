"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateResearchPackage } = require("../../../flows/full-flow/src/package_preflight.js");

function main() {
  try {
    const args = process.argv.slice(2), values = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!["--package", "--skip-alias-check"].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Invalid option or missing value: ${args[index]}`);
      values[args[index]] = args[index + 1];
    }
    if (!values["--package"]) throw new Error("Provide --package <research-package.json>");
    const pkg = JSON.parse(fs.readFileSync(path.resolve(values["--package"]), "utf8"));
    const result = validateResearchPackage(pkg, { skipAliasCheck: values["--skip-alias-check"] === "true" });
    process.stdout.write(`${JSON.stringify({ status: result.ok ? "ok" : "error", errors: result.errors.map(message => ({ code: "package-preflight", message })) })}\n`);
    if (!result.ok) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ code: "package-invalid", message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}
module.exports = main;
