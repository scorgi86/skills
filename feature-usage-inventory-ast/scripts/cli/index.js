#!/usr/bin/env node
"use strict";
const dispatch = require("./src/dispatch");
if (require.main === module) dispatch.main();
module.exports = dispatch;
