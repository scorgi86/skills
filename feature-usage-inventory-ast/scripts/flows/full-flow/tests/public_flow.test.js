"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

// Every stage is a fresh public CLI process. Only requests and source fixtures are written here.
test("public CLI 0..8 preserves JS to C++ boundaries, source proof, and declared lifecycle coverage", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-public-js-cpp-"));
    const jsRoot = path.join(root, "javascript"), nativeRoot = path.join(root, "native");
    fs.mkdirSync(jsRoot); fs.mkdirSync(nativeRoot);
    const source = path.join(jsRoot, "feature.js"), native = path.join(nativeRoot, "bridge.cpp");
    const jsText = "function FeatureValue() {}\nfunction FeatureCollection() { this.value = null; }\nfunction FeatureContainer() { this.featureState = new FeatureCollection(); }\nFeatureContainer.prototype.save = function() { NativeSave(this.featureState); };\n";
    const nativeText = "void NativeSave(int featureState) { PersistFeature(featureState); }\n";
    fs.writeFileSync(source, jsText); fs.writeFileSync(native, nativeText);
    const state = path.join(root, "state.json"), outputRoot = path.join(root, "artifacts");
    const cli = path.resolve(__dirname, "../../../index.js");
    const invoke = (command, args) => {
        const result = spawnSync(process.execPath, [cli, command, ...args], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
        assert.equal(result.status, 0, `${command}: ${result.stdout}\n${result.stderr}\n${result.error?.message || ""}`);
        return JSON.parse(result.stdout);
    };
    invoke("stage_state", ["init", "--state", state]);
    const repositoryScope = { repositories: [{ id: "js", root: jsRoot, role: "source" }, { id: "native", root: nativeRoot, role: "source" }] };
    const coverageProfile = { requiredCollections: ["dictionary", "criticalPaths"], notApplicable: {}, requiredCriticalPaths: ["save"], notApplicableCriticalPaths: {} };
    const artifacts = [];
    const execute = (request) => {
        const file = path.join(root, `request-${request.stage}.json`);
        fs.writeFileSync(file, JSON.stringify({ target: "FeatureValue", repositoryScope, ...request }));
        const result = invoke("stage_pipeline", ["--request", file, "--state", state, "--output-root", outputRoot]);
        assert.equal(result.status, "closed", `Stage ${request.stage}: ${JSON.stringify(result)}`);
        const artifact = JSON.parse(fs.readFileSync(result.artifact, "utf8"));
        assert.deepEqual(artifact.openChecks, []);
        artifacts.push(result.artifact);
        return result.artifact;
    };
    let previous = execute({ stage: 0, coverageProfile, seeds: { direct: ["FeatureValue", "NativeSave"], aliases: ["featureState"] }, expectedLayers: ["javascript", "native"], scanSeeds: true });
    const groups = [
        { id: "model", order: "1", role: "model", object: "FeatureValue", relation: "defines" },
        { id: "collection", order: "2", role: "container", object: "FeatureCollection.value", relation: "contains" },
        { id: "owner", order: "3", role: "owner", object: "FeatureContainer.featureState", relation: "owns" }
    ].map((row, index) => ({ ...row, repository: "js", status: "confirmed", anchor: { file: source, line: index + 1 }, confirmation: { status: "source-confirmed", method: "source", file: source, line: index + 1, endLine: index + 1, repository: "js", sourceHash: crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"), sourceFragment: jsText.split("\n")[index] }, sourceFragment: jsText.split("\n")[index], evidenceRefs: [] }));
    previous = execute({ stage: 1, transitionArtifact: previous, sourceRoot: jsRoot, gitnexus: { enabled: false, reason: "Synthetic repositories have no graph index; source and AST establish this bounded corpus" },
        ast: { queries: [{ id: "owners", command: "find", file: source, options: { terms: "FeatureValue,value,featureState,NativeSave" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 20 }] },
        evidence: { checks: [{ id: "native-boundary", file: source, pattern: "NativeSave", maxMatches: 20 }] },
        ownership: { expectedIds: groups.map(row => row.id), groups },
        boundaries: [{ id: "native-save", producerRepo: "js", kind: "native-bridge", symbol: "NativeSave", relation: "passes feature state to native persistence", anchor: { file: source, line: 4 }, evidenceRefs: ["native-boundary"], ownershipRefs: ["owner"], searchTerms: ["NativeSave"], consumerRepos: ["native"] }],
        coverageContract: { categories: [{ id: "ownership", status: "applicable", groupIds: groups.map(row => row.id) }], baseline: { ownershipIds: groups.map(row => row.id) } }
    });
    previous = execute({ stage: 2, transitionArtifact: previous, ast: { queries: [{ id: "save-call", command: "find", file: source, options: { terms: "NativeSave" }, groupFilters: { owner: "*" }, includeDetails: true, maxDetails: 20 }] }, evidence: { checks: [{ id: "save-api", file: source, pattern: "NativeSave" }] } });
    const stage2 = JSON.parse(fs.readFileSync(previous, "utf8"));
    assert.equal(stage2.facts.filter(row => row.kind === "boundary").length, 1);
    previous = execute({ stage: 3, transitionArtifact: previous, consumerScopes: [{ id: "native", scope: nativeRoot, searchProfile: { languages: ["cpp"] } }] });
    const stage3 = JSON.parse(fs.readFileSync(previous, "utf8"));
    assert.ok(stage3.facts.some(row => row.kind === "boundary" && row.id === "native-save"));
    const stage3Evidence = JSON.parse(fs.readFileSync(path.join(path.dirname(previous), "evidence.json"), "utf8"));
    assert.ok(stage3Evidence.files.some(file => file.endsWith("bridge.cpp")));
    assert.ok(stage3Evidence.evidence.some(row => row.repository === "native"));
    previous = execute({ stage: 4, transitionArtifact: previous, recipientFamilies: [{ id: "native-persistence", receiver: "Native persistence", relation: "persists feature state", checks: [{ id: "native-recipient", file: native, pattern: "PersistFeature" }] }] });
    previous = execute({ stage: 5, transitionArtifact: previous, checks: [{ id: "save-path", file: native, pattern: "NativeSave" }], nameCoverage: { id: "save-names", scope: root, terms: ["NativeSave", "PersistFeature"], searchProfile: { languages: ["javascript", "cpp"] } } });
    const proof = (id, repository, file, text, line) => ({ id, repository, file, status: "source-confirmed", sourceHash: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), line, endLine: line, sourceFragment: text.split("\n")[line - 1] });
    previous = execute({ stage: 6, transitionArtifact: previous, mode: "feature-reference", featureReference: { target: "FeatureValue", referenceEntity: "Native persistence", capabilities: [{ id: "lifecycle", status: "confirmed", evidenceRefs: ["proof-js", "proof-native"] }] },
        canonicalEvidence: [proof("proof-js", "js", source, jsText, 4), proof("proof-native", "native", native, nativeText, 1)],
        sourceSurfaces: [{ path: source, layer: "javascript", role: "save entry", evidenceRefs: ["proof-js"] }, { path: native, layer: "native", role: "persistence receiver", evidenceRefs: ["proof-native"] }],
        dictionary: [{ id: "name-transition", terms: ["featureState", "NativeSave", "PersistFeature"], status: "confirmed", evidenceRefs: ["proof-js", "proof-native"] }],
        criticalPaths: [{ id: "save-lifecycle", coverageKey: "save", steps: ["FeatureContainer.save", "NativeSave", "PersistFeature"], status: "confirmed", evidenceRefs: ["proof-js", "proof-native"] }]
    });
    const stage7 = execute({ stage: 7, priorArtifacts: [...artifacts], transitionArtifact: previous, evidenceSelectors: artifacts.map(artifact => ({ artifact, limit: 100 })), coverage: { status: "complete" }, transition: { "next stage": "8" } });
    const model = JSON.parse(fs.readFileSync(stage7, "utf8")).facts.find(row => row.kind === "report-model").model;
    assert.equal(model.criticalPaths[0].coverageKey, "save");
    assert.equal(model.dictionary[0].status, "confirmed");
    assert.equal(model.capabilities.find(row => row.id === "lifecycle").status, "confirmed");
    assert.deepEqual(model.coverage.profile.requiredCriticalPaths, ["save"]);
    const output = path.join(root, "reports");
    invoke("stage8_runner", ["--model", stage7, "--output-dir", output, "--state", state]);
    invoke("stage_state", ["advance", "--state", state, "--stage", "8", "--artifact", path.join(output, "manifest.json")]);
    invoke("stage_state", ["complete-run", "--state", state]);
    assert.equal(JSON.parse(fs.readFileSync(state, "utf8")).execution.runStatus, "complete");
    const implementation = fs.readFileSync(path.join(output, "implementation-map.md"), "utf8");
    assert.match(implementation, /NativeSave.*PersistFeature/);
    assert.match(implementation, /\| native-persistence \| Native persistence/);
});
