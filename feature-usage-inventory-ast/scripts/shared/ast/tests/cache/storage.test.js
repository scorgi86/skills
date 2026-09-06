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
