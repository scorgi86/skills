"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runEvidenceChecks } = require("../src/collection/source_evidence.js");
const { prepareFacts } = require("../../artifacts/src/canonical/facts.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-proof-id-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "source.js"), text = "const Feature = true;\nconst Feature = true;\n";
  fs.writeFileSync(file, text);
  const confirmation = { id: "proof-first", repository: "source", file, line: 1, endLine: 1,
    sourceFragment: "const Feature = true;", sourceHash: crypto.createHash("sha256").update(text).digest("hex"), status: "source-confirmed" };
  return { root, file, confirmation, repositoryScope: { repositories: [{ id: "source", root, role: "source" }] } };
}

for (const retainAllMatches of [false, true]) test(`explicit proof ID belongs only to its confirmed match (retainAllMatches=${retainAllMatches})`, t => {
  const value = fixture(t);
  const result = runEvidenceChecks({ retainAllMatches, checks: [{ id: "query-feature", repository: "source", file: value.file, pattern: "Feature", confirmation: value.confirmation }] });
  const check = result.checks[0];
  for (const matches of [check.matches, ...(retainAllMatches ? [check.fullMatches] : [])]) {
    assert.equal(matches.find(row => row.line === 1).id, "proof-first");
    assert.equal(Object.hasOwn(matches.find(row => row.line === 2), "id"), false);
  }
  const facts = prepareFacts({ stage: 2, repositoryScope: value.repositoryScope, sourceEvidence: result,
    dictionary: [{ id: "feature", status: "confirmed", evidenceRefs: ["proof-first"] }] });
  assert.equal(facts.canonicalEvidence.length, 2);
  const proof = facts.canonicalEvidence.find(row => row.aliases.includes("proof-first"));
  assert.deepEqual(facts.dictionary[0].evidenceRefs, [proof.id]);
  assert.equal(proof.confirmation.status, "source-confirmed");
  assert.equal(proof.repository, "source");
  assert.equal(proof.file, value.file);
  assert.deepEqual(proof.range, { startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 });
  assert.equal(proof.sourceHash, value.confirmation.sourceHash);
  assert.equal(facts.evidenceIdMap["query-feature"].length, 2);
});

test("confirmation without a separate ID preserves legacy match shape", t => {
  const value = fixture(t);
  delete value.confirmation.id;
  const result = runEvidenceChecks({ checks: [{ id: "query-feature", file: value.file, pattern: "Feature", confirmation: value.confirmation }] });
  assert.ok(result.checks[0].matches.every(row => !Object.hasOwn(row, "id")));
  assert.deepEqual(result.checks[0].matches[0].confirmation.evidenceRefs, ["query-feature"]);
});

test("stale explicit proof is rejected during collection", t => {
  const value = fixture(t);
  value.confirmation.sourceHash = "0".repeat(64);
  assert.throws(() => runEvidenceChecks({ checks: [{ id: "query-feature", file: value.file, pattern: "Feature", confirmation: value.confirmation }] }), /hash/i);
});
