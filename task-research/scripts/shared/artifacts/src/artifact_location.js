"use strict";
const path = require("node:path");

// Accepted read locations describe the same canonical bundle; write paths stay explicit.
function artifactLocation(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Provide a canonical artifact path");
  let root = path.resolve(input);
  if (["stage-result.json", "manifest.json"].includes(path.basename(root))) {
    if (path.basename(path.dirname(root)) !== "canonical") throw new Error("Canonical artifact files must be inside canonical/");
    root = path.dirname(root);
  }
  if (path.basename(root) === "canonical") root = path.dirname(root);
  return { root, canonical: path.join(root, "canonical"), result: path.join(root, "canonical", "stage-result.json") };
}
function canonicalResultPath(input) {
  const file = path.resolve(input);
  // Legacy standalone canonical results remain readable; they are not bundles.
  if (path.extname(file) === ".json" && path.basename(file) !== "manifest.json") return file;
  return artifactLocation(file).result;
}
module.exports = { artifactLocation, canonicalResultPath };
