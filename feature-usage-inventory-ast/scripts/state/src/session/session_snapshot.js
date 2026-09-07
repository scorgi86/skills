"use strict";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

class SessionSnapshot {
  constructor(state, digest = null) {
    this.state = deepFreeze(structuredClone(state));
    this.digest = digest;
    this.revision = state.revision ? deepFreeze(structuredClone(state.revision)) : null;
    Object.freeze(this);
  }
}

module.exports = { SessionSnapshot, deepFreeze };
