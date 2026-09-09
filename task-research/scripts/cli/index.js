#!/usr/bin/env node
"use strict";
const dispatch = require("./src/dispatch");
if (require.main === module) void dispatch.main();
module.exports = dispatch;
