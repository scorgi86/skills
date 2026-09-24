"use strict";
const fs = require("node:fs");

function normalizedFragment(fragment) {
  return String(fragment || "").replace(/\r\n/g, "\n");
}
function stageChecks(stage) {
  return stage?.evidence?.checks || stage?.checks || [];
}
function authoredRefs(stage7) {
  return (["capabilities", "scenarios", "criticalPaths", "confirmedUsages", "checkedNoUsage", "gaps", "implementationEntryPoints"])
    .flatMap(name => (stage7?.[name] || []).map(row => ({ collection: name, row })));
}
function validateResearchPackage(pkg, options = {}) {
  const errors = [];
  const stages = pkg?.stages || {};
  // P1: each confirmation fragment must match its file exactly once (unreadable files are skipped).
  const fileCache = new Map();
  for (const key of Object.keys(stages)) {
    for (const check of stageChecks(stages[key])) {
      const confirmation = check.confirmation;
      if (!confirmation?.file || !confirmation.sourceFragment) continue;
      let content = fileCache.get(confirmation.file);
      if (content === undefined) {
        try { content = fs.readFileSync(confirmation.file, "utf8"); } catch { content = null; }
        fileCache.set(confirmation.file, content);
      }
      if (content === null) continue;
      const fragment = normalizedFragment(confirmation.sourceFragment);
      const matches = normalizedFragment(content).split(fragment).length - 1;
      if (matches !== 1) errors.push(`${check.id}: confirmation fragment matches ${matches} times in ${confirmation.file}; the anchor must be unique in the file`);
    }
  }
  // P2: authored Stage 7 evidence refs must be declared aliases (skipped for continuations).
  if (!options.skipAliasCheck) {
    const union = new Set();
    for (const key of Object.keys(stages)) for (const check of stageChecks(stages[key])) {
      union.add(String(check.id));
      if (check.absenceClaim === true) union.add(`absence-${check.id}`);
    }
    for (const selector of stages["7"]?.evidenceSelectors || []) for (const id of selector.ids || []) union.add(String(id));
    for (const { collection, row } of authoredRefs(stages["7"])) {
      for (const ref of row.evidenceRefs || []) if (!union.has(String(ref))) errors.push(`${collection}[${row.id}]: Unknown evidence alias "${ref}" (alias must be a check id, "absence-"+id, or an evidenceSelectors id)`);
    }
  }
  // P3: stage mode coherence.
  const stage1 = stages["1"] || {}, stage2 = stages["2"] || {}, stage3 = stages["3"] || {}, stage4 = stages["4"] || {}, stage5 = stages["5"] || {};
  const stage1Manual = Array.isArray(stage1.ast?.queries) || Array.isArray(stage1.ownership?.groups);
  if (stage1Manual && stage2.searchFromStage1 === true) errors.push("manual Stage 1 does not build an ownership graph; use a manual Stage 2 (ast/evidence queries) instead of searchFromStage1");
  if (stage1.ownership?.ownerDiscovery === "skip") {
    for (const [name, stage] of [["2", stage2], ["3", stage3], ["4", stage4]]) if (stage.searchFromStageN || ["searchFromStage1", "searchFromStage2", "searchFromStage3"].some(flag => stage[flag] === true)) errors.push(`Stage ${name}: searchFromStage* is not allowed with Stage 1 ownership.ownerDiscovery:"skip"; use a manual stage`);
    if (!Array.isArray(stage5.checks) || !stage5.checks.length) errors.push("Stage 5 requires manual checks when Stage 1 ownership.ownerDiscovery is \"skip\"");
  }
  return { ok: errors.length === 0, errors };
}
module.exports = { validateResearchPackage };
