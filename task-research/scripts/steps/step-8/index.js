"use strict";
const api = require("./src/runner.js");
Object.assign(api, {
renderDecision: require("./src/rendering/decision.js").renderDecision,
renderEvidence: require("./src/rendering/evidence.js").renderEvidence,
renderImplementation: require("./src/rendering/implementation.js").renderImplementation,
run: require("./src/runner.js").run,
unwrapModel: require("./src/runner.js").unwrapModel
});
module.exports = api;
