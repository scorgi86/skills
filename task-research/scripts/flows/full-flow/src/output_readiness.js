"use strict";
const fs = require("node:fs"), path = require("node:path"), { randomUUID } = require("node:crypto");
function assertOutputReady(outputRoot) {
  const root = path.resolve(outputRoot);
  const probe = path.join(root, `.write-probe-${randomUUID()}`);
  let created = false;
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(probe, "", { flag: "wx" }); created = true;
  } catch (error) {
    throw new Error(`Artifact output is not writable: ${root} (${error.code || error.message}). Select an explicitly permitted directory with --output-root; no fallback was applied.`);
  } finally { if (created) fs.unlinkSync(probe); }
  return root;
}
module.exports = { assertOutputReady };
