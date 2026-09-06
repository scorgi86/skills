"use strict";
// Named APIs load only when requested. CLI-only commands are in cli/src/commands.
Object.defineProperty(exports, "diagnose", { enumerable: true, get() { return require("./src/diagnose.js"); } });
Object.defineProperty(exports, "quick_validate", { enumerable: true, get() { return require("./src/quick_validate.js"); } });
