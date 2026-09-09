const crypto = require("node:crypto");
const path = require("node:path");

const FORMAT_VERSION = "2";
// Bump when symbol/relation/evidence extraction or its dependencies change.
const ANALYZER_VERSION = "1";

function createIdentity(content, filename, parser, versions = {}) {
  const identity = {
    formatVersion: versions.formatVersion || FORMAT_VERSION,
    analyzerVersion: versions.analyzerVersion || ANALYZER_VERSION,
    file: path.resolve(filename),
    parser,
    contentHash: crypto.createHash("sha256").update(content).digest("hex"),
  };
  return { ...identity, key: crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex") };
}
module.exports = { createIdentity };
