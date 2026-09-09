"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createCanonicalStageResult } = require("../../artifacts/src/canonical/result.js");

function transitionFields(stage, overrides = {}) {
  return { target: "target feature", scope: "fixture", stage: String(stage), status: "closed", "confirmed evidence": "yes", "candidate evidence": "maybe", "dictionary/graph/path state": "ready", "skipped/forbidden": "none", "open checks": "next", "next stage": String(stage + 1), ...overrides };
}
function writeCanonicalTransition(directory, stage, options = {}) {
  const file = path.join(directory, options.name || `stage-${stage}.json`);
  const facts = { stage, status: "closed", transition: { schemaVersion: "1.0.0", fields: transitionFields(stage, options.fields), missing: [], valid: true }, ...(options.facts || {}) };
  fs.writeFileSync(file, `${JSON.stringify(createCanonicalStageResult({ facts, input: { stage } }), null, 2)}\n`);
  return file;
}
module.exports = { transitionFields, writeCanonicalTransition };
