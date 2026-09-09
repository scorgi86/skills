"use strict";
const api = require("./src/stage_state.js");
Object.assign(api, {
InventorySession: require("./src/session/inventory_session.js").InventorySession,
NullStateStore: require("./src/persistence/state_store.js").NullStateStore,
SCHEMA_VERSION: require("./src/state_model.js").SCHEMA_VERSION,
SessionSnapshot: require("./src/session/session_snapshot.js").SessionSnapshot,
StateStore: require("./src/persistence/state_store.js").StateStore,
assertCanonical: require("./src/state_model.js").assertCanonical,
assertProbe: require("./src/state_model.js").assertProbe,
initialState: require("./src/state_model.js").initialState,
main: require("./src/stage_state.js").main,
parseArgs: require("./src/stage_state.js").parseArgs,
validateStage8Manifest: require("./src/artifacts/stage8_validation.js").validateStage8Manifest,
transitions: require("./src/model/transitions.js"),
validateState: require("./src/state_model.js").validateState
});
module.exports = api;
