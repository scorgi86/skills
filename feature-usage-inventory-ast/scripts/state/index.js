"use strict";
const api = require("./src/stage_state.js");
Object.assign(api, {
SCHEMA_VERSION: require("./src/state_model.js").SCHEMA_VERSION,
assertCanonical: require("./src/state_model.js").assertCanonical,
assertProbe: require("./src/state_model.js").assertProbe,
initialState: require("./src/state_model.js").initialState,
main: require("./src/stage_state.js").main,
parseArgs: require("./src/stage_state.js").parseArgs,
validateStage8Manifest: require("./src/artifacts/stage8_validation.js").validateStage8Manifest,
validateState: require("./src/state_model.js").validateState
});
module.exports = api;
