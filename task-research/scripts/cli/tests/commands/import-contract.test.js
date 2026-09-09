"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const scripts = path.resolve(__dirname, "../../..");
const root = path.dirname(scripts);
test("all command handlers import without executing, writing or exiting", () => {
  const expected = ["ast_batch", "canonical_stage_cli", "compare_mechanisms", "compare_stage_runs", "coverage_gate", "diagnose", "extract_stage_transition", "feature_search_matrix", "goal_contract", "human_report_codec", "inventory_search", "measure_context", "prototype_ast", "quality_equivalence", "query_stage_artifacts", "quick_validate", "render_stage1_report", "render_stage2_report", "source_evidence", "source_slice", "stage0_runner", "stage1_runner", "stage2_runner", "stage3_runner", "stage4_runner", "stage5_equivalence_gate", "stage5_runner", "stage6_runner", "stage7_coverage_gate", "stage7_equivalence_gate", "stage7_runner", "stage8_runner", "stage_pipeline", "stage_state", "validate_inventory_report", "validate_inventory_stage", "validate_skill"];
  assert.deepEqual(require(path.join(scripts, "cli")).commandNames(), expected);
  assert.equal(fs.existsSync(path.join(scripts, "cli/commands")), false);
  for (const name of expected) {
    const file = path.join(scripts, "cli/src/commands", `${name}.js`);
    const program = `const fs = require('node:fs');
      for (const key of ['writeFileSync','appendFileSync','mkdirSync','unlinkSync','renameSync']) fs[key] = () => { throw Error('Import attempted ' + key); };
      process.exit = () => { throw Error('Import attempted exit'); };
      const handler = require(${JSON.stringify(file)});
      if (typeof handler !== 'function') throw Error('Missing callable handler');
      process.stdout.write('imported');`;
    const result = spawnSync(process.execPath, ["-e", program], { encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.equal(result.stdout, "imported", name);
    assert.equal(result.stderr, "", name);
  }
});
test("validate_skill default root survives CLI relocation and foreign cwd", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inventory default root "));
  try {
    const result = spawnSync(process.execPath, [path.join(scripts, "index.js"), "validate_skill", "--json"], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const value = JSON.parse(result.stdout);
    assert.equal(value.skillDir, root);
    assert.equal(value.ok, true);
  } finally { fs.rmdirSync(cwd); }
});
