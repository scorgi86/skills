"use strict";
const fs = require("node:fs"), path = require("node:path");
function checkContext(previous, lineage) {
  const file = previous?.resultFile || lineage.at(-1)?.artifact;
  if (!file) return { canonical: undefined, evidence: [], corrections: [] };
  const canonical = previous?.canonical || JSON.parse(fs.readFileSync(file, "utf8"));
  const receipts = (canonical.facts || []).filter(row => row.kind === "check-resolution");
  const required = new Set(receipts.flatMap(row => row.evidenceRefs || []));
  const correctionIds = new Set(receipts.map(row => row.correctionRef).filter(Boolean));
  let evidence = [];
  if (previous || required.size) {
    const data = JSON.parse(fs.readFileSync(path.join(path.dirname(file), "evidence.json"), "utf8"));
    evidence = data.evidence.filter(row => previous || required.has(row.id)).map(({ fileId, ...row }) => ({ ...row, ...(fileId === undefined ? {} : { file: data.files[fileId] }) }));
  }
  return { canonical, evidence, corrections: canonical.facts.filter(row => correctionIds.has(row.id) && ["gap", "limitation"].includes(row.kind)) };
}
function aliasMap(evidence) {
  const map = {};
  for (const row of evidence) for (const alias of [row.id, ...(row.aliases || [])]) map[alias] = [...new Set([...(map[alias] || []), row.id])];
  return map;
}
module.exports = { checkContext, aliasMap };
