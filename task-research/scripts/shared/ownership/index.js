"use strict";
// Named APIs load only when requested. CLI-only commands are in cli/src/commands.
Object.defineProperty(exports, "ownership_graph", { enumerable: true, get() { return require("./src/ownership_graph.js"); } });
Object.defineProperty(exports, "boundary_candidates", { enumerable: true, get() { return require("./src/boundary_candidates.js"); } });
