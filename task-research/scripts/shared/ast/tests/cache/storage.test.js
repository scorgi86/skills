const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createIdentity } = require("../../src/cache/identity.js");
const { readEntry, writeEntry } = require("../../src/cache/storage.js");
const { analyzeFile } = require("../../src/analysis/analysis.js");
const fixtures = path.resolve(__dirname, "../../../../../fixtures/prototype");

function sample() {
  const file = path.join(fixtures, "setter-calls.js");
  const result = analyzeFile(file).result;
  return { result, identity: createIdentity(fs.readFileSync(file), file, result.parser) };
}
function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ast-storage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("storage round trips all real fixture variants and rejects incompatible entries", (t) => {
  const directory = workspace(t);
  const { identity, result } = sample();
  assert.equal(readEntry(directory, identity).status, "miss");
  for (const name of fs.readdirSync(fixtures).filter(name => /\.(js|jsx|ts|tsx)$/.test(name))) {
    const file = path.join(fixtures, name);
    const analyzed = analyzeFile(file).result;
    if (analyzed.errors.length) continue;
    const key = createIdentity(fs.readFileSync(file), file, analyzed.parser);
    assert.equal(writeEntry(directory, key, analyzed).status, "written", name);
    assert.deepEqual(readEntry(directory, key), { status: "hit", result: analyzed }, name);
  }
  const target = path.join(directory, `${identity.key}.json`);
  const good = { identity, result };
  const corruptions = [
    value => { delete value.result.occurrences; },
    value => { value.result.occurrences[0].confidence = "candidate"; },
    value => { value.identity.key = "wrong"; },
    value => { value.identity.analyzerVersion = "old"; },
    value => { value.result.file = "wrong"; },
    value => { value.result.parser.options = {}; },
    value => { value.result.status = "confirmed"; },
    value => { value.result.errors = [{ message: "bad" }]; },
    value => { value.result.elapsedMs = -1; },
    value => { value.result.symbols[0].kind = 12; },
    value => { value.result.symbols[0].params = [12]; },
    value => { value.result.relations[0].relation = null; },
    value => { value.result.relations[0].candidateTypes = {}; },
    value => { value.result.relations[0].resolvedVia = [null]; },
    value => { value.result.relations[0].evidence[0].range.start.line = "1"; },
    value => { value.result.relations[0].evidence[0].file = "wrong"; },
    value => { value.result.relations[0].evidence[0].status = "confirmed"; },
    value => { delete value.result.methodSummaries; },
  ];
  for (const corrupt of corruptions) {
    const value = structuredClone(good);
    corrupt(value);
    fs.writeFileSync(target, JSON.stringify(value));
    assert.equal(readEntry(directory, identity).status, "failed", String(corrupt));
  }
  fs.writeFileSync(target, "{");
  assert.equal(readEntry(directory, identity).status, "failed");
  fs.writeFileSync(target, JSON.stringify(result)); // legacy raw result
  assert.equal(readEntry(directory, identity).status, "failed");
});

test("storage rejects unproven method summaries and malformed owner proofs", (t) => {
  const directory = workspace(t);
  const file = path.join(directory, "method.js");
  fs.writeFileSync(file, [
    "function Item() {}",
    "function Props() {}",
    "Props.prototype.createDuplicate = function () { const copy = new Props(); return copy; };",
    "function Holder() { this.item = new Item(); }",
  ].join("\n"));
  const result = analyzeFile(file).result;
  const identity = createIdentity(fs.readFileSync(file), file, result.parser);
  assert.equal(result.methodSummaries.length, 1);
  assert.ok(result.relations.length > 0);
  const target = path.join(directory, `${identity.key}.json`);
  const corruptions = [
    value => { value.result.methodSummaries[0].evidence = []; },
    value => { value.result.relations[0].ownerProof = { kind: "bad", ownerType: "Props", method: "createDuplicate", returnType: "Props" }; },
  ];
  for (const corrupt of corruptions) {
    const value = structuredClone({ identity, result });
    corrupt(value);
    fs.writeFileSync(target, JSON.stringify(value));
    assert.equal(readEntry(directory, identity).status, "failed", String(corrupt));
  }
});

test("storage rejects malformed type aliases and versioned identities keep their own cache grammar", (t) => {
  const directory = workspace(t);
  const file = path.join(directory, "alias.js");
  fs.writeFileSync(file, ["function Item() {}", "window.AscFormat.Item = Item;"].join("\n"));
  const result = analyzeFile(file).result;
  const identity = createIdentity(fs.readFileSync(file), file, result.parser);
  assert.equal(result.typeAliases.length, 1);
  const target = path.join(directory, `${identity.key}.json`);
  const invalid = structuredClone({ identity, result });
  delete invalid.result.typeAliases[0].proof.sourceHash;
  fs.writeFileSync(target, JSON.stringify(invalid));
  assert.equal(readEntry(directory, identity).status, "failed");
  const versionDirectory = path.join(directory, "version");
  const oldIdentity = createIdentity(fs.readFileSync(file), file, result.parser, { analyzerVersion: "4" });
  assert.equal(writeEntry(versionDirectory, oldIdentity, result).status, "written");
  assert.equal(readEntry(versionDirectory, identity).status, "miss");
  assert.equal(readEntry(versionDirectory, oldIdentity).status, "hit");
});

test("storage round trips local factory domains and keeps legacy v5 keys versioned", (t) => {
  const directory = workspace(t);
  const file = path.join(directory, "factory.js");
  fs.writeFileSync(file, [
    "function Inner() {}",
    "function Glow() {}",
    "function Holder() {}",
    "Holder.prototype.make = function(item) { switch (item.type) { case 'inner': return new Inner(); case 'glow': return new Glow(); } };",
    "Holder.prototype.load = function() { const payload = { type: 'inner' }; this.slot = this.make(payload); }"
  ].join("\n"));
  const result = analyzeFile(file).result;
  const identity = createIdentity(fs.readFileSync(file), file, result.parser);
  assert.ok(result.methodSummaries[0].possibleReturnTypes.some(item => item.selector));
  assert.deepEqual(result.relations.find(item => item.callableProof?.argumentDomains)?.callableProof.argumentDomains, [{ index: 0, discriminatorKey: "type", values: ["inner"] }]);
  assert.equal(writeEntry(directory, identity, result).status, "written");
  assert.deepEqual(readEntry(directory, identity), { status: "hit", result });
  const target = path.join(directory, `${identity.key}.json`);
  for (const corrupt of [
    value => { value.result.methodSummaries[0].possibleReturnTypes[0].selector.caseValue = 1; },
    value => { value.result.relations.find(item => item.callableProof?.argumentDomains).callableProof.argumentDomains[0].values = ["inner", "glow"]; }
  ]) {
    const value = structuredClone({ identity, result });
    corrupt(value);
    fs.writeFileSync(target, JSON.stringify(value));
    assert.equal(readEntry(directory, identity).status, "failed", String(corrupt));
  }
  const v5 = createIdentity(fs.readFileSync(file), file, result.parser, { analyzerVersion: "5" });
  const legacy = structuredClone(result);
  legacy.relations.find(item => item.callableProof?.argumentDomains).callableProof = { owner: "Holder", method: "make", argumentKeys: [{ index: 0, key: "inner" }] };
  assert.equal(writeEntry(directory, v5, legacy).status, "written");
  assert.equal(readEntry(directory, v5).status, "hit");
  assert.equal(readEntry(directory, identity).status, "failed");
});

test("concurrent processes publish a complete entry usable by a subsequent reader", async (t) => {
  const directory = workspace(t);
  const { identity, result } = sample();
  const payload = path.join(directory, "payload.json");
  fs.writeFileSync(payload, JSON.stringify({ identity, result }));
  const code = `const fs=require('node:fs'); const {writeEntry}=require(process.argv[1]); const {identity,result}=JSON.parse(fs.readFileSync(process.argv[2])); const outcome=writeEntry(process.argv[3],identity,result); if(!['written','failed'].includes(outcome.status)) process.exitCode=1;`;
  await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", code, require.resolve("../../src/cache/storage.js"), payload, directory], { stdio: ["ignore", "pipe", "pipe"] });
    let error = "";
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(error || `exit ${code}`)));
  })));
  assert.deepEqual(readEntry(directory, identity), { status: "hit", result });
  assert.deepEqual(fs.readdirSync(directory).sort(), [`${identity.key}.json`, "payload.json"].sort());
});
