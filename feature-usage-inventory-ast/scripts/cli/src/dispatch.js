#!/usr/bin/env node
"use strict";
// Dispatch existing command names only; this does not orchestrate steps.
const fs = require("node:fs");
const path = require("node:path");
function commandNames() {
    return fs.readdirSync(path.join(__dirname, "commands")).filter((name)=>name.endsWith(".js")).map((name)=>name.slice(0, -3)).sort();
}
function main() {
    const name = process.argv[2];
    if (!commandNames().includes(name)) {
        process.stderr.write(`Provide an existing command: ${commandNames().join(", ")}\n`);
        process.exitCode = 2;
        return;
    }
    process.argv.splice(2, 1);
    const command = require(path.join(__dirname, "commands", `${name}.js`));
    if (typeof command === "function") command();
}
module.exports = {
    commandNames,
    main
};
