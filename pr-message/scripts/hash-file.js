#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");

if (process.argv.length !== 3) {
  process.stderr.write("Use hash-file.js <file>.\n");
  process.exitCode = 1;
} else {
  const content = fs.readFileSync(process.argv[2]);
  process.stdout.write(`${crypto.createHash("sha256").update(content).digest("hex")}\n`);
}
