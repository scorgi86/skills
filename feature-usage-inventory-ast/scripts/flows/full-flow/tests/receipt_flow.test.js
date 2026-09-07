"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { runStagePipeline } = require("../src/stage_pipeline.js");
const { main: state } = require("../../../state/src/stage_state.js");
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-flow-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const stateFile = path.join(root, "state.json"), outputRoot = path.join(root, "artifacts"), file = path.join(root, "owner.js");
    fs.writeFileSync(file, "owner();\n"); state(["init", "--state", stateFile]);
    const requirement = { check: "confirm owner", type: "source-confirmation", repository: "source", file: "owner.js" };
    const request = { stage: 0, target: "Owner", coverageProfile: {}, repositoryScope: { repositories: [{ id: "source", root, role: "source" }] } };
    const proof = { id: "proof", repository: "source", file, line: 1, endLine: 1, sourceFragment: "owner();", status: "source-confirmed", sourceHash: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
    return { root, stateFile, outputRoot, file, requirement, request, proof };
}
function execute(f, request, facts) { return runStagePipeline({ outputRoot: f.outputRoot, stateFile: f.stateFile, request, runner: () => facts }); }
function read(result) { return JSON.parse(fs.readFileSync(result.artifact, "utf8")); }
function start(f) { const result = execute(f, { ...f.request, openChecks: [f.requirement.check], checkRequirements: [f.requirement] }, { stage: 0, status: "candidate" }); assert.equal(result.status, "partial"); return read(result); }
function close(f, prior) {
    const receipt = { kind: "check-resolution", check: f.requirement.check, originDigest: prior.outputDigest, disposition: "checked", reason: "exact owner source inspected", evidenceRefs: ["proof"] };
    return execute(f, { ...f.request, checkResolutions: [receipt] }, { stage: 0, status: "candidate", canonicalEvidence: [f.proof] });
}
test("partial retry resolves an original proof ID after canonical evidence remapping", t => {
    const f = fixture(t), prior = start(f), result = close(f, prior), canonical = read(result);
    assert.equal(result.status, "closed"); assert.deepEqual(canonical.openChecks, []);
    const receipt = canonical.facts.find(row => row.kind === "check-resolution");
    assert.equal(receipt.originDigest, prior.outputDigest); assert.notEqual(receipt.evidenceRefs[0], "proof");
    assert.ok(canonical.evidenceRefs.includes(receipt.evidenceRefs[0])); assert.deepEqual(canonical.summary.checkRequirements, [f.requirement]);
});
test("next stage inherits typed metadata receipt proof and immutable question history", t => {
    const f = fixture(t), prior = start(f), closed = close(f, prior), previous = read(closed), bytes = fs.readFileSync(closed.artifact);
    const result = execute(f, { ...f.request, stage: 1, transitionArtifact: closed.artifact }, { stage: 1, status: "candidate" });
    const canonical = read(result), receipt = canonical.facts.find(row => row.kind === "check-resolution");
    assert.equal(result.status, "closed"); assert.deepEqual(canonical.summary.checkRequirements, [f.requirement]);
    assert.deepEqual(receipt, previous.facts.find(row => row.kind === "check-resolution"));
    assert.ok(receipt.evidenceRefs.every(id => canonical.evidenceRefs.includes(id)));
    assert.equal(canonical.summary.lineage[0].outputDigest, previous.outputDigest);
    assert.ok(previous.summary.checkHistory.some(row => row.outputDigest === prior.outputDigest));
    assert.deepEqual(fs.readFileSync(closed.artifact), bytes);
});
test("same-stage partial omission retains typed question and original origin", t => {
    const f = fixture(t), first = start(f);
    const result = execute(f, f.request, { stage: 0, status: "candidate" }), canonical = read(result);
    assert.equal(result.status, "partial"); assert.deepEqual(canonical.openChecks, [f.requirement.check]);
    assert.deepEqual(canonical.summary.checkRequirements, [f.requirement]);
    assert.ok(canonical.summary.checkOrigins.some(row => row.check === f.requirement.check && row.originDigest === first.outputDigest));
});
test("typed receipt survives all stage boundaries into the final report and state", t => {
    const f = fixture(t), first = start(f), closed = close(f, first), artifacts = [closed.artifact];
    const proofId = read(closed).facts.find(row => row.kind === "check-resolution").evidenceRefs[0];
    for (let stage = 1; stage <= 6; stage++) {
        const result = execute(f, { ...f.request, stage, transitionArtifact: artifacts.at(-1) }, { stage, status: "candidate", ...(stage === 6 ? { capabilities: [{ id: "ownership", status: "confirmed", requiredForFinalReport: true, evidenceRefs: [proofId] }] } : {}) });
        artifacts.push(result.artifact);
    }
    const result = runStagePipeline({ stateFile: f.stateFile, outputRoot: f.outputRoot, request: { ...f.request, stage: 7, priorArtifacts: artifacts, transitionArtifact: artifacts.at(-1), evidenceSelectors: [{ artifact: artifacts.at(-1), limit: 20 }], transition: { "next stage": "8" } } });
    const canonical = read(result), model = canonical.facts.find(row => row.kind === "report-model").model;
    assert.deepEqual(canonical.summary.checkRequirements, [f.requirement]);
    assert.deepEqual(model.provenance.checkRequirements, [f.requirement]);
    const output = path.join(f.root, "report");
    require("../../../steps/step-8/src/runner.js").run(model, output, model.integrity.canonicalDigest);
    state(["advance", "--state", f.stateFile, "--stage", "8", "--artifact", path.join(output, "manifest.json")]);
    state(["complete-run", "--state", f.stateFile]);
    assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).execution.runStatus, "complete");
});
test("stale inherited proof rejects downstream progression and preserves closed bytes", t => {
    const f = fixture(t), prior = start(f), closed = close(f, prior), bytes = fs.readFileSync(closed.artifact), stateBytes = fs.readFileSync(f.stateFile);
    fs.writeFileSync(f.file, "changed();\n");
    assert.throws(() => execute(f, { ...f.request, stage: 1, transitionArtifact: closed.artifact }, { stage: 1, status: "candidate" }), /source-confirmation|stale|proof|receipt/i);
    assert.deepEqual(fs.readFileSync(closed.artifact), bytes); assert.deepEqual(fs.readFileSync(f.stateFile), stateBytes);
});
