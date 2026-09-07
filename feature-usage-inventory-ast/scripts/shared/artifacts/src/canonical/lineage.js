"use strict";
const fs = require("node:fs"), path = require("node:path");
const { validateCanonicalStageResult } = require("./validation.js");
const { scopeDigest } = require("./checks.js");
const { validateReceiptEvidence } = require("./receipt_evidence.js");
const { canonicalResultPath } = require("../artifact_location.js");
function fail(message) {
    throw new Error(`Canonical lineage: ${message}; reissue/reconfirm the affected stage and all dependent downstream digests (preserve immutable originals)`);
}
function read(file) {
    file = canonicalResultPath(file);
    let result;
    try {
        result = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        fail(`cannot read ${file}: ${error.message}`);
    }
    const validation = validateCanonicalStageResult(result);
    if (!validation.ok) fail(`${file}: ${validation.errors.join("; ")}`);
    validateReceiptEvidence(result, file);
    return result;
}
function descriptor(file, result, scope) {
    return {
        stage: result.stage,
        artifact: path.resolve(file),
        outputDigest: result.outputDigest,
        scopeDigest: scopeDigest(scope)
    };
}
function retainRequirementContext(canonical, source) {
    for (const required of source.summary?.checkRequirements || []) {
        const retained = canonical.summary?.checkRequirements?.find(row => row.check === required.check);
        if (!retained || scopeDigest(retained) !== scopeDigest(required)) fail(`checkRequirements context disappeared or changed: ${required.check}`);
    }
}
function validateCheckHistory(canonical) {
    const history = canonical.summary?.checkHistory || [];
    if (!Array.isArray(history)) fail("checkHistory must be an array");
    const sources = new Map();
    for (const entry of history){
        if (!entry?.artifact || !/^[a-f0-9]{64}$/.test(entry.outputDigest || "")) fail("invalid checkHistory entry");
        const source = read(path.resolve(entry.artifact));
        if (source.outputDigest !== entry.outputDigest || source.stage !== canonical.stage ||
            source.status === "closed" ||
            scopeDigest(source.summary?.repositoryScope) !== scopeDigest(canonical.summary?.repositoryScope)) {
            fail("checkHistory must reference the exact same-stage partial scope/digest");
        }
        retainRequirementContext(canonical, source);
        sources.set(source.outputDigest, source);
    }
    // Prior-stage receipts keep their origin history in the validated prior artifact.
    for (const link of canonical.summary?.lineage || []){
        const source = read(path.resolve(link.artifact));
        if (source.outputDigest !== link.outputDigest) fail("receipt lineage digest mismatch");
        retainRequirementContext(canonical, source);
        for (const receipt of source.facts.filter((row)=>row.kind === "check-resolution")) {
            sources.set(`receipt:${receipt.originDigest}\0${receipt.check}`, receipt);
        }
    }
    for (const receipt of canonical.facts.filter((row)=>row.kind === "check-resolution")){
        const source = sources.get(receipt.originDigest), inherited = sources.get(`receipt:${receipt.originDigest}\0${receipt.check}`);
        if (!source?.openChecks.includes(receipt.check) &&
            (!inherited || scopeDigest(inherited) !== scopeDigest(receipt))) {
            fail(`check-resolution origin has no historical question: ${receipt.check}`);
        }
    }
    const latest = history.length ? sources.get(history.at(-1).outputDigest) : null;
    for (const check of latest?.openChecks || []){
        const origins = latest.summary?.checkOrigins?.filter((row)=>row.check === check) || [];
        for (const origin of origins.length ? origins : [
            {
                check,
                originDigest: latest.outputDigest
            }
        ]){
            const resolved = canonical.facts.some((row)=>row.kind === "check-resolution" && row.check === check && row.originDigest === origin.originDigest);
            const carried = canonical.openChecks.includes(check) && canonical.summary?.checkOrigins?.some((row)=>row.check === check && row.originDigest === origin.originDigest);
            if (!resolved && !carried) fail(`persisted question disappeared without receipt: ${check}`);
        }
    }
    return {
        ok: true
    };
}
function validatePriorLineage({ stage, repositoryScope, priorArtifacts, artifactBase = process.cwd(), expectedArtifact, expectedArtifacts }) {
    if (!Array.isArray(priorArtifacts) || priorArtifacts.length !== stage) fail(`requires exactly stages 0..${stage - 1}`);
    const prior = priorArtifacts.map((file)=>{
        const absolute = canonicalResultPath(path.resolve(artifactBase, typeof file === "string" ? file : file.artifact));
        const result = read(absolute);
        if (typeof file !== "string" && (file.stage !== result.stage ||
            file.outputDigest !== result.outputDigest ||
            file.scopeDigest !== scopeDigest(result.summary?.repositoryScope || result.summary?.scope))) {
            fail(`descriptor stage/digest/scope does not match ${absolute}`);
        }
        return {
            file: absolute,
            result
        };
    }).sort((a, b)=>a.result.stage - b.result.stage);
    const lineage = [];
    for(let index = 0; index < stage; index++){
        const { file, result } = prior[index];
        if (result.stage !== index) fail(`missing or duplicate stage ${index}`);
        if (result.status !== "closed") fail(`stage ${index} is not closed`);
        const scope = result.summary?.repositoryScope || result.summary?.scope;
        if (!scope || scopeDigest(scope) !== scopeDigest(repositoryScope)) fail(`scope mismatch at stage ${index}`);
        const links = result.summary?.lineage;
        if (!Array.isArray(links) || links.length !== index) fail(`missing complete lineage at stage ${index}`);
        for(let before = 0; before < index; before++){
            const link = links[before], selected = lineage[before];
            if (!link || link.stage !== before ||
                path.resolve(path.dirname(file), link.artifact || "") !== selected.artifact ||
                link.outputDigest !== selected.outputDigest || link.scopeDigest !== selected.scopeDigest) {
                fail(`stage ${index} links a different revision/scope at stage ${before}`);
            }
        }
        validateCheckHistory(result);
        lineage.push(descriptor(file, result, repositoryScope));
    }
    if (expectedArtifact && (stage === 0 || canonicalResultPath(path.resolve(artifactBase, expectedArtifact)) !== prior.at(-1).file)) fail("selected tip is not the active state artifact");
    if (expectedArtifacts) for(let index = 0; index < stage; index++){
        const expected = expectedArtifacts[index];
        if (!expected ||
            canonicalResultPath(path.resolve(artifactBase, typeof expected === "string" ? expected : expected.artifact)) !== prior[index].file ||
            expected.outputDigest && expected.outputDigest !== prior[index].result.outputDigest) {
            fail(`active state revision mismatch at stage ${index}`);
        }
    }
    return {
        prior,
        lineage
    };
}
function buildLineageFromPrevious(previousPath, stage, scope, artifactBase = process.cwd()) {
    if (stage === 0) return [];
    if (!previousPath) fail(`stage ${stage} requires transitionArtifact or active state canonicalArtifact`);
    const file = canonicalResultPath(path.resolve(artifactBase, previousPath)), previous = read(file);
    if (previous.stage !== stage - 1) fail(`expected stage ${stage - 1} tip`);
    const links = previous.summary?.lineage;
    if (!Array.isArray(links) || links.length !== stage - 1) fail("legacy artifact has missing lineage");
    return validatePriorLineage({
        stage,
        repositoryScope: scope,
        artifactBase: path.dirname(file),
        priorArtifacts: [
            ...links,
            file
        ],
        expectedArtifact: file
    }).lineage;
}
module.exports = {
    validatePriorLineage,
    buildLineageFromPrevious,
    validateCheckHistory
};
