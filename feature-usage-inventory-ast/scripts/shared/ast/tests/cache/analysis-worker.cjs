// Runs in a dedicated process: mocks must not leak into the shared test registry.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../../src");
const swc = require("@swc/core");
const index = require(path.join(root, "analysis/symbol_index.js"));
const relations = require(path.join(root, "analysis/relations.js"));
const scenario = process.argv[2];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ast-analysis-"));
const file = path.join(directory, "source.js");
const cache = path.join(directory, "cache");
const source = "function Owner(){ this.value = new Thing(); }";
fs.writeFileSync(file, source);
const originals = { read: fs.readFileSync, write: fs.writeFileSync, rename: fs.renameSync, hash: crypto.createHash, parse: swc.parseSync, index: index.createSymbolIndex, relations: relations.createRelations };
let active = false;
let count = {};
function reset() { count = { read: 0, parse: 0, index: 0, relations: 0, hash: 0, cacheRead: 0, cacheWrite: 0 }; active = true; }
function cost(read, parse, semantic) {
  assert.equal(count.read, read, JSON.stringify(count));
  assert.equal(count.parse, parse, JSON.stringify(count));
  assert.equal(count.index, semantic, JSON.stringify(count));
  assert.equal(count.relations, semantic, JSON.stringify(count));
}
fs.readFileSync = function (target, ...args) {
  if (active && target === file) {
    count.read++;
    if (scenario === "read-error") throw Object.assign(new Error("source denied"), { code: "EACCES" });
    const value = originals.read.call(this, target, ...args);
    if (scenario === "snapshot") originals.write(file, source.replace("Thing", "Other"));
    return value;
  }
  if (active && typeof target === "string" && target.startsWith(cache + path.sep)) {
    count.cacheRead++;
    if (["cache-read-error", "cache-read-semantic"].includes(scenario)) throw Object.assign(new Error("cache denied"), { code: "EACCES" });
  }
  return originals.read.call(this, target, ...args);
};
fs.writeFileSync = function (target, ...args) {
  if (active && (typeof target === "number" || (typeof target === "string" && target.startsWith(cache + path.sep)))) {
    count.cacheWrite++;
    if (scenario === "write-error") throw new Error("write denied");
  }
  return originals.write.call(this, target, ...args);
};
fs.renameSync = function (...args) {
  if (active && ["rename-error", "rename-existing"].includes(scenario)) throw new Error("rename denied");
  return originals.rename.apply(this, args);
};
crypto.createHash = function (...args) { if (active) count.hash++; return originals.hash.apply(this, args); };
swc.parseSync = function (...args) { if (active) count.parse++; return originals.parse.apply(this, args); };
index.createSymbolIndex = function (...args) {
  if (active) count.index++;
  if (active && ["semantic-error", "cache-read-semantic"].includes(scenario)) throw new Error("semantic failed");
  return originals.index.apply(this, args);
};
relations.createRelations = function (...args) { if (active) count.relations++; return originals.relations.apply(this, args); };
const { analyzeFile } = require(path.join(root, "analysis/analysis.js"));
const { parserOptions, swcVersion } = require(path.join(root, "parsing/parser.js"));
const meaningful = result => { const { elapsedMs, ...rest } = result; return rest; };
try {
  if (["hit", "corrupt"].includes(scenario)) analyzeFile(file, { cache });
  if (scenario === "corrupt") {
    for (const name of fs.readdirSync(cache)) originals.write(path.join(cache, name), "{");
  }
  if (["parse-error", "corrupt-parse-error"].includes(scenario)) {
    originals.write(file, "function {");
    if (scenario === "corrupt-parse-error") {
      const { createIdentity } = require(path.join(root, "cache/identity.js"));
      const identity = createIdentity(originals.read(file), file, { name: "@swc/core", version: swcVersion, options: parserOptions(file) });
      fs.mkdirSync(cache);
      originals.write(path.join(cache, `${identity.key}.json`), "{");
    }
  }
  if (scenario === "legacy") {
    const legacyKey = originals.hash("sha256").update("1.0.0").update(swcVersion).update(JSON.stringify(parserOptions(file))).update(file).update(originals.read(file)).digest("hex");
    fs.mkdirSync(cache);
    originals.write(path.join(cache, `${legacyKey}.json`), JSON.stringify(analyzeFile(file).result));
  }
  if (scenario === "rename-existing") {
    const { createIdentity } = require(path.join(root, "cache/identity.js"));
    const { writeEntry, readEntry } = require(path.join(root, "cache/storage.js"));
    const result = analyzeFile(file).result;
    const identity = createIdentity(originals.read(file), file, result.parser);
    assert.equal(writeEntry(cache, identity, result).status, "written");
    const target = path.join(cache, `${identity.key}.json`);
    const before = originals.read(target, "utf8");
    const unrelated = path.join(cache, "another-writer.tmp");
    originals.write(unrelated, "owned elsewhere");
    reset();
    assert.equal(writeEntry(cache, identity, { ...result, elapsedMs: 123 }).status, "failed");
    assert.equal(originals.read(target, "utf8"), before);
    assert.equal(originals.read(unrelated, "utf8"), "owned elsewhere");
    assert.equal(readEntry(cache, identity).status, "hit");
    assert.deepEqual(fs.readdirSync(cache).sort(), [`${identity.key}.json`, "another-writer.tmp"].sort());
  } else if (scenario === "encoding") {
    for (const bytes of [Buffer.from("// ё\r\nfunction Owner(){this.x = new Thing();}"), Buffer.concat([Buffer.from("// "), Buffer.from([0xff]), Buffer.from("\nconst x = new Thing();")])]) {
      originals.write(file, bytes);
      const plain = analyzeFile(file).result;
      reset();
      const cold = analyzeFile(file, { cache });
      cost(1, 1, 1);
      reset();
      const warm = analyzeFile(file, { cache });
      cost(1, 0, 0);
      assert.deepEqual(meaningful(cold.result), meaningful(plain));
      assert.deepEqual(warm.result, cold.result);
      active = false;
    }
  } else if (["semantic-error", "cache-read-semantic"].includes(scenario)) {
    reset();
    assert.throws(() => analyzeFile(file, { cache }), /semantic failed/);
    assert.equal(count.index, 1);
    assert.equal(count.relations, 0);
    assert.equal(count.cacheWrite, 0);
  } else {
    reset();
    const analyzed = analyzeFile(file, scenario === "disabled" ? {} : { cache });
    if (scenario === "hit") {
      cost(1, 0, 0);
      assert.equal(analyzed.cache, "hit");
      assert.equal(count.cacheWrite, 0);
    } else if (["read-error", "parse-error", "corrupt-parse-error"].includes(scenario)) {
      cost(1, scenario === "read-error" ? 0 : 1, 0);
      assert.equal(analyzed.cache, "disabled");
      assert.equal(analyzed.result.status, "не проверено");
      assert.equal(analyzed.result.errors.length, 1);
      assert.deepEqual(analyzed.result.warnings, []);
      assert.equal(count.cacheWrite, 0);
      if (scenario === "read-error") assert.equal(count.cacheRead, 0);
    } else {
      cost(1, 1, 1);
      assert.equal(analyzed.result.errors.length, 0);
      if (scenario === "disabled") {
        assert.equal(analyzed.cache, "disabled");
        assert.equal(count.hash + count.cacheRead + count.cacheWrite, 0);
      } else if (["corrupt", "cache-read-error", "write-error", "rename-error"].includes(scenario)) {
        assert.equal(analyzed.cache, "failed");
        assert.equal(analyzed.result.warnings.length, 1);
        if (["corrupt", "cache-read-error"].includes(scenario)) assert.equal(count.cacheWrite, 0);
        if (fs.existsSync(cache)) assert.ok(fs.readdirSync(cache).every(name => !name.endsWith(".tmp")));
      } else {
        assert.equal(analyzed.cache, "miss");
        if (scenario === "legacy") assert.equal(fs.readdirSync(cache).length, 2);
      }
      if (scenario === "snapshot") {
        assert.ok(analyzed.result.relations.some(item => item.targetQualifiedName === "Thing"));
        reset();
        const next = analyzeFile(file, { cache });
        assert.equal(next.cache, "miss");
        assert.ok(next.result.relations.some(item => item.targetQualifiedName === "Other"));
        cost(1, 1, 1);
      }
    }
  }
} finally {
  active = false;
  fs.rmSync(directory, { recursive: true, force: true });
}
