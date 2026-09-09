const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateStatus, parseArgs, parseRepoList, runDiagnostics } = require("../src/diagnose");

test("diagnostic arguments parse repositories and strict mode", () => {
  assert.deepEqual(parseArgs(["--indexes", "index-a,index-b", "--strict", "--pretty"]), {
    pretty: true,
    strict: true,
    indexes: ["index-a", "index-b"],
  });
});

test("status separates required, recommended, and optional failures", () => {
  assert.equal(evaluateStatus([{ ok: false, severity: "required" }]), "blocked");
  assert.equal(evaluateStatus([{ ok: false, severity: "recommended" }]), "degraded");
  assert.equal(evaluateStatus([{ ok: false, severity: "optional" }]), "ready");
  assert.equal(evaluateStatus([{ ok: false, severity: "optional" }], true), "ready");
  assert.equal(evaluateStatus([{ ok: false, severity: "recommended" }], true), "blocked");
});

test("GitNexus list output resolves registered repository paths", () => {
  const repos = parseRepoList("  index-a\n    Path:    ROOT_A\n    Indexed: now\n\n  index-b\n    Path:    ROOT_B\n");
  assert.equal(repos.get("index-a").path, "ROOT_A");
  assert.equal(repos.get("index-b").path, "ROOT_B");
});

test("diagnostics return the versioned machine-readable contract", () => {
  const result = runDiagnostics({ indexes: [] });
  assert.equal(result.schemaVersion, "1.0.0");
  assert.equal(result.command, "diagnose");
  assert.ok(["ready", "degraded", "blocked"].includes(result.status));
  assert.ok(result.checks.some((item) => item.id === "node"));
  assert.ok(result.checks.some((item) => item.id === "swc"));
  assert.ok(result.checks.some((item) => item.id === "gitnexus"));
  const scripts = result.checks.find((item) => item.id === "skill-scripts");
  assert.equal(scripts.ok, true, JSON.stringify(scripts));
  assert.deepEqual(scripts.details.missing, []);
});
