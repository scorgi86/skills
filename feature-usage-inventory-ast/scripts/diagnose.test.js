const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateStatus, parseArgs, parseRepoList, runDiagnostics } = require("./diagnose");

test("diagnostic arguments parse repositories and strict mode", () => {
  assert.deepEqual(parseArgs(["--repos", "sdkjs,web-apps", "--strict", "--pretty"]), {
    pretty: true,
    strict: true,
    repos: ["sdkjs", "web-apps"],
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
  const repos = parseRepoList("  sdkjs\n    Path:    C:\\work\\sdkjs\n    Indexed: now\n\n  web-apps\n    Path:    C:\\work\\web-apps\n");
  assert.equal(repos.get("sdkjs").path, "C:\\work\\sdkjs");
  assert.equal(repos.get("web-apps").path, "C:\\work\\web-apps");
});

test("diagnostics return the versioned machine-readable contract", () => {
  const result = runDiagnostics({ repos: [] });
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
