"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const { evidenceState, repositoryMap } = require("../../src/model/source_validation.js");
function fixture(t, source = "const value = true;\n") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-anchor-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, "a.js"), source);
    return { repositories: repositoryMap({ repositories: [{ id: "repo", root, role: "source" }] }), row: { repository: "repo", file: "a.js", sourceHash: crypto.createHash("sha256").update(source).digest("hex"), line: 1, endLine: 1, sourceFragment: "const value = true;" } };
}
test("a current full-file hash cannot confirm a nonexistent line", (t) => {
    const { row, repositories } = fixture(t);
    assert.equal(evidenceState({ ...row, line: 999, endLine: 999 }, repositories).ok, false);
});
test("anchors reject missing fields, fragments, noninteger and reversed ranges", (t) => {
    const { row, repositories } = fixture(t);
    for (const patch of [{line: undefined}, {endLine: undefined}, {sourceFragment: undefined}, {line: 0}, {line: 1.5}, {line: "1"}, {line: 2, endLine: 1}, {sourceFragment: "const value"}, {sourceFragment: " const value = true;"}]) assert.equal(evidenceState({...row, ...patch}, repositories).ok, false, JSON.stringify(patch));
});
test("anchors preserve Unicode, whitespace and multiline source while allowing aliases and CRLF", (t) => {
    const { row, repositories } = fixture(t, "// λ\r\n\tconst réel = 1;  \r\nreturn réel;");
    assert.equal(evidenceState({...row, line: 2, endLine: 3, symbol: "aliasNotPresent", sourceFragment: "\tconst réel = 1;  \nreturn réel;"}, repositories).ok, true);
    assert.equal(evidenceState({...row, line: 2, endLine: 3, sourceFragment: "\tconst réel = 1;  \r\nreturn réel;"}, repositories).ok, true);
    assert.equal(evidenceState({...row, line: 2, endLine: 3, sourceFragment: "const réel = 1;\nreturn réel;"}, repositories).ok, false);
});
test("empty files have no source lines and final newlines introduce no fictitious line", (t) => {
    for (const source of ["", "a", "a\n", "a\r\n", "a\n\n", "\n"]) {
        const {row, repositories} = fixture(t, source);
        const realLines = source === "" ? [] : source.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
        if (realLines.length) assert.equal(evidenceState({...row, line: realLines.length, endLine: realLines.length, sourceFragment: realLines.at(-1)}, repositories).ok, true, JSON.stringify(source));
        assert.equal(evidenceState({...row, line: realLines.length + 1, endLine: realLines.length + 1, sourceFragment: ""}, repositories).ok, false, JSON.stringify(source));
    }
});
test("source hash uses raw bytes even when fragments normalize CRLF", (t) => {
    const {row, repositories} = fixture(t, "a\r\n");
    assert.equal(evidenceState({...row, sourceFragment: "a", sourceHash: crypto.createHash("sha256").update("a\n").digest("hex")}, repositories).ok, false);
});
test("one source read supplies both hash and fragment validation", (t) => {
    const {row, repositories} = fixture(t);
    const original = fs.readFileSync;
    let reads = 0;
    t.mock.method(fs, "readFileSync", (...args) => { reads += 1; return reads === 1 ? original(...args) : Buffer.from("changed source"); });
    assert.equal(evidenceState(row, repositories).ok, true);
    assert.equal(reads, 1);
});
