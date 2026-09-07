"use strict";
const crypto = require("node:crypto");
function scopeDigest(scope) {
    const stable = (value)=>Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key)=>[
                key,
                stable(value[key])
            ])) : value;
    return crypto.createHash("sha256").update(JSON.stringify(stable(scope))).digest("hex");
}
function closureErrors(facts) {
    const errors = [];
    for (const diagnostic of facts?.evidenceDiagnostics || facts?.summary?.evidenceDiagnostics || []) errors.push(`evidence ${diagnostic.code || "invalid"}: ${diagnostic.message || "requires reconfirmation"}`);
    if (facts?.openChecks?.length) errors.push("openChecks must be resolved before closure");
    if ([
        "error",
        "blocked",
        "partial"
    ].includes(facts?.status)) errors.push(`status ${facts.status} cannot close`);
    for (const name of [
        "coverageGate",
        "ownershipGraph"
    ]){
        const gate = facts?.quality?.[name];
        if (gate && (gate.ok === false || gate.valid === false || gate.errors?.length || [
            "blocked",
            "failed",
            "invalid"
        ].includes(gate.status))) errors.push(`${name} failed: ${(gate.errors || []).join("; ")}`);
    }
    return errors;
}
function requirementErrors(requirements) {
    if (!Array.isArray(requirements)) return ["checkRequirements must be an array"];
    const errors = [], seen = new Set();
    for (const row of requirements) {
        if (!row || row.type !== "source-confirmation" || !["check", "repository", "file"].every(field => typeof row[field] === "string" && row[field].trim())) errors.push("checkRequirements require check, source-confirmation type, repository and file");
        for (const field of ["line", "endLine"]) if (row?.[field] !== undefined && (!Number.isInteger(row[field]) || row[field] < 1)) errors.push(`checkRequirements.${field} must be a positive integer`);
        if (row?.endLine !== undefined && (row.line === undefined || row.endLine < row.line)) errors.push("checkRequirements.endLine requires an ordered line range");
        if (row?.claimRef !== undefined && (typeof row.claimRef !== "string" || !row.claimRef.trim())) errors.push("checkRequirements.claimRef must be a nonempty string");
        if (seen.has(row?.check)) errors.push("checkRequirements must identify each check once");
        seen.add(row?.check);
    }
    return errors;
}
function mergeRequirements(previous, produced) {
    const before = previous.summary?.checkRequirements || [], incoming = produced.checkRequirements ?? produced.summary?.checkRequirements ?? [];
    const errors = [...requirementErrors(before), ...requirementErrors(incoming)];
    if (errors.length) throw new Error(errors.join("; "));
    const merged = new Map(before.map(row => [row.check, row]));
    for (const row of incoming) {
        if (merged.has(row.check) && scopeDigest(merged.get(row.check)) !== scopeDigest(row)) throw new Error(`checkRequirements context cannot change or weaken on retry: ${row.check}`);
        merged.set(row.check, row);
    }
    return [...merged.values()];
}
function sourceRequirementErrors(receipt, requirement, evidence, scope) {
    if (!requirement) return [];
    if (receipt.disposition === "corrected") return ["source-confirmation obligation cannot be corrected into a gap or limitation"];
    if (receipt.disposition === "not-applicable") {
        const { excluded } = require("../../../evidence/src/canonicalization/candidate_identity.js");
        return receipt.repository === requirement.repository && excluded(requirement.file, { exclusions: [receipt.exclusion] }) ? [] : ["source-confirmation exclusion must cover the required repository/file"];
    }
    if (receipt.disposition !== "checked") return [];
    const path = require("node:path"), repo = scope?.repositories?.find(row => row.id === requirement.repository);
    const normalized = file => { const value = path.resolve(repo?.root || ".", file || "").replaceAll("\\", "/"); return repo?.caseSensitive === false || repo?.caseSensitive !== true && process.platform === "win32" ? value.toLowerCase() : value; };
    const matching = evidence.some(row => {
        if (!row || typeof row === "string" || !receipt.evidenceRefs?.includes(row.id) || row.repository !== requirement.repository || normalized(row.file) !== normalized(requirement.file)) return false;
        if (row.status && !["source-confirmed", "confirmed"].includes(row.status)) return false;
        const confirmation = require("../../../evidence/src/canonicalization/source_confirmation.js").confirmationOf(row, { repositoryScope: scope });
        if (confirmation.status !== "source-confirmed") return false;
        if (requirement.line !== undefined && (confirmation.line > requirement.line || confirmation.endLine < (requirement.endLine || requirement.line))) return false;
        return requirement.claimRef === undefined || row.claimRef === requirement.claimRef || row.claimRefs?.includes(requirement.claimRef);
    });
    return matching ? [] : [`source-confirmation receipt requires fresh linked proof for ${requirement.repository}/${requirement.file} and its declared claim/range`];
}
function correctionErrors(receipt, facts) {
    if (receipt.disposition !== "corrected") return [];
    const rows = Array.isArray(facts) ? facts : [...facts?.canonicalFacts || [], ...(facts?.gaps || []).map(row => ({kind:"gap", ...row})), ...(facts?.limitations || []).map(row => typeof row === "object" ? {kind:"limitation", ...row} : row)];
    return typeof receipt.correctionRef === "string" && rows.some(row => row && typeof row === "object" && row.id === receipt.correctionRef && ["gap", "limitation"].includes(row.kind)) ? [] : ["corrected receipt correctionRef must name an actual gap or limitation fact"];
}
function receiptErrors(receipt, evidenceIds, scope, context = {}) {
    const errors = [];
    if (!receipt || receipt.kind !== "check-resolution" ||
        typeof receipt.check !== "string" || !receipt.check.trim() ||
        !/^[a-f0-9]{64}$/.test(receipt.originDigest || "")) {
        errors.push("check-resolution requires exact check and originDigest");
    }
    if (!String(receipt?.reason || "").trim()) errors.push("check-resolution requires reason");
    if (receipt?.disposition === "checked") {
        if (!Array.isArray(receipt.evidenceRefs) || !receipt.evidenceRefs.length ||
            receipt.evidenceRefs.some((id)=>typeof id !== "string" || !evidenceIds.has(id))) {
            errors.push("check-resolution evidenceRefs must resolve to evidence");
        }
    } else if (receipt?.disposition === "not-applicable") {
        if (!/^[a-f0-9]{64}$/.test(receipt.scopeDigest || "") ||
            !String(receipt.scopeJustification || "").trim() ||
            scope !== undefined && receipt.scopeDigest !== scopeDigest(scope)) {
            errors.push("not-applicable requires matching scopeDigest and scopeJustification");
        }
        if (!receipt.repository || !receipt.exclusion ||
            scope !== undefined && !scope?.repositories?.some((repository)=>
                repository.id === receipt.repository && repository.exclusions?.includes(receipt.exclusion))) {
            errors.push("not-applicable requires a declared repository scope exclusion");
        }
    } else if (receipt?.disposition === "corrected") {
        if (!String(receipt.correctionRef || "").trim()) errors.push("corrected receipt requires correctionRef");
    } else errors.push("check-resolution disposition must be checked, not-applicable or corrected");
    const requirement = (context.requirements || []).find(row => row.check === receipt?.check);
    if (context.evidence || receipt?.disposition !== "checked") errors.push(...sourceRequirementErrors(receipt, requirement, context.evidence || [], scope));
    if (context.facts) errors.push(...correctionErrors(receipt, context.facts));
    return errors;
}
function resolveChecks(previousCanonical, produced, receipts = [], evidence = [], scope) {
    const previous = previousCanonical || {};
    const requirements = mergeRequirements(previous, produced);
    const retained = (previous.facts || []).filter((row)=>row.kind === "check-resolution");
    const previousOrigins = previous.summary?.checkOrigins || [];
    const origins = (previous.openChecks || []).flatMap((check)=>{
        const known = previousOrigins.filter((row)=>row.check === check);
        return known.length ? known : [
            {
                check,
                originDigest: previous.outputDigest
            }
        ];
    });
    const key = (row)=>`${row.originDigest}\0${row.check}`;
    const knownReceipts = new Map(retained.map((row)=>[
            key(row),
            row
        ]));
    const evidenceIds = new Set(evidence.map((row)=>typeof row === "string" ? row : row.id));
    for (const receipt of receipts){
        const errors = receiptErrors(receipt, evidenceIds, scope, { requirements, evidence, facts: produced });
        if (errors.length) throw new Error(errors.join("; "));
        if (!origins.some((row)=>key(row) === key(receipt)) && !knownReceipts.has(key(receipt))) {
            throw new Error("check-resolution origin does not identify a persisted question");
        }
        if (knownReceipts.has(key(receipt)) &&
            scopeDigest(knownReceipts.get(key(receipt))) !== scopeDigest(receipt)) {
            throw new Error("Conflicting check-resolution for origin");
        }
        knownReceipts.set(key(receipt), receipt);
    }
    const unresolved = origins.filter((row)=>!knownReceipts.has(key(row)));
    // Producer restatement of a just-resolved question belongs to its current origin.
    const requested = (produced.openChecks || []).filter((check)=>!origins.some((row)=>row.check === check) || unresolved.some((row)=>row.check === check));
    return {
        ...produced,
        openChecks: [
            ...new Set([
                ...unresolved.map((row)=>row.check),
                ...requested
            ])
        ].sort(),
        checkResolutions: [
            ...knownReceipts.values()
        ],
        summary: {
            ...produced.summary,
            checkOrigins: unresolved,
            ...(requirements.length ? { checkRequirements: requirements } : {})
        }
    };
}
module.exports = {
    requirementErrors,
    sourceRequirementErrors,
    correctionErrors,
    closureErrors,
    receiptErrors,
    resolveChecks,
    scopeDigest
};
