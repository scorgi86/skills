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
  const warnings = [];
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
      let matches;
      if (!fragment.includes("\n")) {
        const candidates = normalizedFragment(content).split("\n").filter(line => line.trim() === fragment.trim());
        const counts = new Map();
        for (const line of candidates) counts.set(line, (counts.get(line) || 0) + 1);
        matches = Math.max(0, ...counts.values());
      } else {
        matches = normalizedFragment(content).split(fragment).length - 1;
      }
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
    for (const [name, stage] of [["2", stage2], ["3", stage3], ["4", stage4]]) if (stage.searchFromStageN || ["searchFromStage1", "searchFromStage2", "searchFromStage3"].some(flag => stage[flag] === true)) errors.push(`Stage ${name}: searchFromStage* is not allowed with Stage 1 ownership.ownerDiscovery:\"skip\"; use a manual stage`);
    if (!Array.isArray(stage5.checks) || !stage5.checks.length) errors.push("Stage 5 requires manual checks when Stage 1 ownership.ownerDiscovery is \"skip\"");
    if (!(stages["7"]?.evidenceSelectors || []).some(selector => String(selector.stage) === "1" && Array.isArray(selector.ids) && selector.ids.length)) warnings.push("bootstrap proof evidence ids are unknown at authoring time; add a {stage: 1, ids: [...]} selector for Stage 1 after the first run");
  }
  for (const selector of stages["7"]?.evidenceSelectors || []) if (selector.limit !== undefined) warnings.push(`Stage ${selector.stage} selector with limit may truncate on large bundles; prefer {stage, ids} exact selectors or narrow with evidence-for`);
  const seeds = stages["0"]?.seeds?.direct || [];
  const seedScan = options.seedScan || {};
  if (!options.disableSeedScan && seeds.length && Array.isArray(pkg.repositoryScope?.repositories) && pkg.repositoryScope.repositories.length) {
    const warnMatches = seedScan.warnMatches ?? 1000, failMatches = seedScan.failMatches ?? 20000;
    for (const seed of seeds) {
      let total = 0, scanned = true;
      for (const repo of pkg.repositoryScope.repositories) {
        try {
          const output = require("node:child_process").execFileSync("rg", ["--count-matches", "--fixed-strings", "--no-ignore", "--hidden", seed, repo.root], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
          total += String(output).split(/\r?\n/).reduce((sum, line) => sum + (Number(line.match(/:(\d+)$/)?.[1]) || 0), 0);
        } catch (error) {
          if (error.status !== 1) { scanned = false; break; }
        }
      }
      if (!scanned) continue;
      if (total >= failMatches) errors.push(`seed "${seed}" has ${total} matches across the repositories; bootstrap scan would take hours — narrow the seed`);
      else if (total >= warnMatches) warnings.push(`seed "${seed}" has ${total} matches; consider a narrower term to keep the bootstrap scan fast`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
module.exports = { validateResearchPackage };
