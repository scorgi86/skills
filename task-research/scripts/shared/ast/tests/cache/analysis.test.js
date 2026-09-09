const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

for (const scenario of ["hit", "miss", "disabled", "snapshot", "encoding", "read-error", "parse-error", "corrupt", "cache-read-error", "corrupt-parse-error", "write-error", "rename-error", "rename-existing", "semantic-error", "cache-read-semantic", "legacy"]) {
  test(`file cache: ${scenario}`, () => {
    const child = spawnSync(process.execPath, [path.join(__dirname, "analysis-worker.cjs"), scenario], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });
}
