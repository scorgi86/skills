#!/usr/bin/env node
"use strict";

const cli = require("./cli");

if (require.main === module) void cli.main();
module.exports = cli;
