"use strict";
const { REQUIRED_FIELDS, TOP_LEVEL_FIELDS, MODEL_TYPE, SCHEMA_VERSION, asArray, COLLECTIONS, STATUSES, cleanText, normalizeRefs } = require("./rows.js");
const { repositoryMap, evidenceState } = require("./source_validation.js");
const { absenceClaims } = require("./projection.js");
const { digest, withoutIntegrity } = require("./serialization.js");
function validateReportModel(model) {
    const errors = [], add = (code, path, message)=>errors.push({
            code,
            path,
            message
        });
    const isObject = (value)=>Boolean(value) && typeof value === "object" && !Array.isArray(value);
    const validateRefs = (value, p)=>{
        if (!Array.isArray(value)) {
            add("type", p, "References must be an array");
            return;
        }
        if (value.some((item)=>typeof item !== "string" || !item.length)) add("type", p, "References must contain non-empty strings");
        if (new Set(value).size !== value.length) add("unique", p, "References must be unique");
    };
    if (!model || typeof model !== "object") return {
        ok: false,
        errors: [
            {
                code: "type",
                path: "$",
                message: "Report model must be an object"
            }
        ]
    };
    for (const field of REQUIRED_FIELDS)if (!Object.prototype.hasOwnProperty.call(model, field)) add("required", field, `Required schema field is missing: ${field}`);
    for (const field of Object.keys(model))if (!TOP_LEVEL_FIELDS.has(field)) add("additional-property", field, `Published schema does not allow top-level field: ${field}`);
    if (typeof model.inventoryId !== "string" || !model.inventoryId.length) add("type", "inventoryId", "Inventory id must be a non-empty string");
    for (const field of [
        "scope",
        "provenance",
        "executiveSummary",
        "coverage",
        "stageExecution",
        "renderProfile",
        "transition",
        "integrity"
    ])if (!isObject(model[field])) add("type", field, `${field} must be an object`);
    if (!Array.isArray(model.openChecks)) add("type", "openChecks", "openChecks must be an array");
    else validateRefs(model.openChecks, "openChecks");
    if (model.modelType !== MODEL_TYPE) add("model-type", "modelType", `Expected ${MODEL_TYPE}`);
    if (model.schemaVersion !== SCHEMA_VERSION) add("schema-version", "schemaVersion", `Expected ${SCHEMA_VERSION}`);
    if (model.stage !== 7) add("stage", "stage", "Canonical report model must be produced by Stage 7");
    if (model.status !== "closed") add("status", "status", "Stage 7 model must be closed before Stage 8");
    if (typeof model.target !== "string" || !model.target.length) add("required", "target", "Target must be a non-empty string");
    if (!model.transition || model.transition["next stage"] !== "8") add("transition", "transition.next stage", "Next stage must be the string 8");
    if (![
        "confirmed",
        "partial",
        "unknown",
        "not-applicable"
    ].includes(model.decisionStatus)) add("decision-status", "decisionStatus", "Unsupported decision status");
    const malformedRows = ["capabilities", ...COLLECTIONS].flatMap(name => asArray(model[name]).map((row, index) => !isObject(row) ? { name, index } : null).filter(Boolean));
    if (malformedRows.length) {
        for (const { name, index } of malformedRows) add("type", `${name}[${index}]`, "Collection row must be an object");
        return { ok: false, errors, counts: Object.fromEntries(COLLECTIONS.map(name => [name, asArray(model[name]).length])), canonicalDigest: digest(withoutIntegrity(model)) };
    }
    if (!Array.isArray(model.capabilities) || !model.capabilities.length) add("coverage", "capabilities", "At least one capability is required");
    if (asArray(model.openChecks).length) add("open-checks", "openChecks", "Stage 7 cannot close while checks remain open; record non-blocking constraints as limitations");
    for (const [index, capability] of asArray(model.capabilities).entries())if (capability.requiredForFinalReport !== false && ![
        "confirmed",
        "checked-no-usage",
        "not-applicable"
    ].includes(capability.status)) add("capability-open", `capabilities[${index}].status`, "Required capability must be confirmed, checked-no-usage, or not-applicable before Stage 7 closes");
    if (!asArray(model.capabilities).some((capability)=>capability.requiredForFinalReport === true)) add("capability-terminal", "capabilities", "At least one capability must be explicitly required for the final report");
    if (!asArray(model.scope?.repositories).length) add("scope", "scope.repositories", "At least one repository is required");
    for (const [index, repository] of asArray(model.scope?.repositories).entries()){
        if (!isObject(repository)) {
            add("type", `scope.repositories[${index}]`, "Repository must be an object");
            continue;
        }
        for (const field of [
            "id",
            "root",
            "role"
        ])if (typeof repository[field] !== "string" || !repository[field].length) add("scope", `scope.repositories[${index}].${field}`, `Repository ${field} must be a non-empty string`);
    }
    for (const [index, capability] of asArray(model.capabilities).entries()){
        const p = `capabilities[${index}]`;
        if (!isObject(capability)) {
            add("type", p, "Capability must be an object");
            continue;
        }
        if (typeof capability.id !== "string" || !capability.id.length) add("required", `${p}.id`, "Stable id must be a non-empty string");
        if (capability.status !== undefined && typeof capability.status !== "string") add("type", `${p}.status`, "Status must be a string");
        for (const field of [
            "evidenceRefs",
            "scenarioRefs",
            "recipientRefs",
            "pathRefs",
            "gapRefs",
            "capabilityRefs",
            "testSurfaceRefs"
        ])if (field in capability) validateRefs(capability[field], `${p}.${field}`);
    }
    const ids = new Map();
    for (const name of COLLECTIONS){
        if (!Array.isArray(model[name])) {
            add("type", name, "Collection must be an array");
            continue;
        }
        for (const [index, row] of model[name].entries()){
            const p = `${name}[${index}]`;
            if (!isObject(row)) {
                add("type", p, "Collection row must be an object");
                continue;
            }
            if (typeof row.id !== "string" || !row.id.length) add("required", `${p}.id`, "Stable id must be a non-empty string");
            else if (ids.has(row.id)) add("duplicate-id", `${p}.id`, `Duplicate id also used at ${ids.get(row.id)}`);
            else ids.set(row.id, p);
            if (row.status !== undefined && typeof row.status !== "string") add("type", `${p}.status`, "Status must be a string");
            else if (row.status && !STATUSES.has(row.status)) add("enum", `${p}.status`, `Unsupported status: ${row.status}`);
            for (const field of [
                "evidenceRefs",
                "scenarioRefs",
                "recipientRefs",
                "pathRefs",
                "gapRefs",
                "capabilityRefs",
                "testSurfaceRefs"
            ])if (field in row) validateRefs(row[field], `${p}.${field}`);
            if ([
                "confirmedUsages",
                "checkedNoUsage"
            ].includes(name) && !asArray(row.evidenceRefs).length) add("evidence", `${p}.evidenceRefs`, "Evidence references are required");
            if (name === "checkedNoUsage" && row.status !== "checked-no-usage") add("absence-contract", `${p}.status`, "checkedNoUsage status must be checked-no-usage");
            if (name === "checkedNoUsage" && !asArray(row.expectedNames).length) add("absence-contract", `${p}.expectedNames`, "Expected names are required");
            if (name === "checkedNoUsage" && !cleanText(row.searchScope || row.scope)) add("absence-contract", `${p}.searchScope`, "Search scope is required");
        }
    }
    for (const [index, row] of asArray(model.implementationEntryPoints).entries()){
        const p = `implementationEntryPoints[${index}]`;
        if (!asArray(row.evidenceRefs).length) add("planning-evidence", `${p}.evidenceRefs`, "Implementation entry point requires source evidence");
        if (![
            "scenarioRefs",
            "gapRefs",
            "capabilityRefs",
            "pathRefs"
        ].some((field)=>asArray(row[field]).length)) add("planning-link", p, "Implementation entry point must link to a scenario, gap, capability, or path");
    }
    for (const [index, row] of asArray(model.gaps).entries()){
        const p = `gaps[${index}]`;
        if (!cleanText(row.expectedPath || row.expectedName || row.expectedPlace || row.searchScope || row.scope)) add("gap-contract", p, "Gap requires an expected path/name/place or checked scope");
    }
    const evidenceIds = new Set(asArray(model.evidenceIndex).map((row)=>row.id));
    const declaredIds = new Set([
        ...asArray(model.capabilities),
        ...COLLECTIONS.flatMap((name)=>asArray(model[name]))
    ].map((row)=>row?.id).filter(Boolean));
    const referenceSets = {
        evidenceRefs: evidenceIds,
        scenarioRefs: new Set(asArray(model.scenarios).map((row)=>row.id)),
        recipientRefs: new Set(asArray(model.recipientFamilies).map((row)=>row.id)),
        pathRefs: new Set([
            ...asArray(model.criticalPaths),
            ...asArray(model.referencePaths)
        ].map((row)=>row.id)),
        gapRefs: new Set(asArray(model.gaps).map((row)=>row.id)),
        capabilityRefs: new Set(asArray(model.capabilities).map((row)=>row.id)),
        testSurfaceRefs: declaredIds
    };
    for (const [name, rows] of [
        [
            "capabilities",
            asArray(model.capabilities)
        ],
        ...COLLECTIONS.map((name)=>[
                name,
                asArray(model[name])
            ])
    ])for (const [index, row] of rows.entries())for (const [field, known] of Object.entries(referenceSets)){
        if (field === "evidenceRefs" && row.status === "candidate") continue;
        for (const ref of asArray(row[field]))if (!known.has(ref)) add("broken-ref", `${name}[${index}].${field}`, `Unknown referenced id: ${ref}`);
    }
    const repositories = repositoryMap(model.scope), evidenceById = new Map(asArray(model.evidenceIndex).map((row)=>[
            row.id,
            row
        ]));
    const sourceStates = new Map();
    for (const [index, row] of asArray(model.evidenceIndex).entries())if (row.status === "source-confirmed") {
        if (!sourceStates.has(row.id)) sourceStates.set(row.id, evidenceState(row, repositories));
        const state = sourceStates.get(row.id);
        if (!state.ok) add(state.code, `evidenceIndex[${index}]`, `${state.message}: ${row.id}`);
    }
    const sourceClaims = [
        [
            "capabilities",
            asArray(model.capabilities).filter((row)=>[
                    "confirmed",
                    "source-confirmed"
                ].includes(row.status))
        ],
        ...COLLECTIONS.filter((name)=>name !== "evidenceIndex").map((name)=>[
                name,
                asArray(model[name]).filter((row)=>[
                        "confirmed",
                        "source-confirmed"
                    ].includes(row.status))
            ])
    ];
    for (const [name, rows] of sourceClaims)for (const [index, row] of rows.entries()){
        const p = `${name}[${index}].evidenceRefs`;
        if (!asArray(row.evidenceRefs).length) add("source-evidence", p, "Confirmed claim requires source-confirmed evidence");
        for (const ref of asArray(row.evidenceRefs)){
            const evidence = evidenceById.get(ref);
            if (!evidence || evidence.status !== "source-confirmed") {
                add("source-evidence", p, `Confirmed claim may reference only source-confirmed evidence: ${ref}`);
                continue;
            }
            const state = sourceStates.get(ref);
            if (!state.ok) add(state.code, p, `${state.message}: ${ref}`);
        }
    }
    for (const [index, row] of asArray(model.evidenceIndex).entries())if (row.status === "checked-no-usage") {
        const p = `evidenceIndex[${index}]`;
        for (const field of [
            "expectedNames",
            "performedChecks",
            "ordersChecked",
            "linkingMethodsChecked",
            "evidenceRefs"
        ]){
            validateRefs(row[field], `${p}.${field}`);
            if (!asArray(row[field]).length) add("absence-contract", `${p}.${field}`, `${field} is required`);
        }
        for (const field of [
            "reason",
            "repository",
            "searchScope",
            "consequence"
        ])if (typeof row[field] !== "string" || !row[field].length) add("absence-contract", `${p}.${field}`, `${field} must be a non-empty string`);
        if (row.resultComplete !== true || row.resultTruncated !== false) add("absence-contract", p, "Absence evidence must be complete and explicitly untruncated");
    }
    for (const { collection: name, row } of absenceClaims(model)){
        const index = asArray(model[name]).indexOf(row), p = `${name}[${index}]`;
        if (!asArray(row.evidenceRefs).length) add("absence-evidence", `${p}.evidenceRefs`, "Absence claim requires matching evidence");
        for (const field of [
            "expectedNames",
            "performedChecks",
            "ordersChecked",
            "linkingMethodsChecked"
        ]){
            validateRefs(row[field], `${p}.${field}`);
            if (!asArray(row[field]).length) add("absence-contract", `${p}.${field}`, `${field} is required (use N/A explicitly when not applicable)`);
        }
        for (const field of [
            "reason",
            "repository",
            "searchScope",
            "consequence"
        ])if (typeof row[field] !== "string" || !row[field].length) add("absence-contract", `${p}.${field}`, `${field} must be a non-empty string`);
        if (!repositories.has(row.repository)) add("absence-scope", `${p}.repository`, "Absence repository must exactly match declared scope");
        if (row.resultComplete !== true || row.resultTruncated !== false) add("absence-contract", p, "Absence result must be complete and explicitly untruncated");
        for (const ref of asArray(row.evidenceRefs)){
            const evidence = evidenceById.get(ref), matchingFields = [
                "repository",
                "searchScope",
                "reason",
                "consequence",
                "resultComplete",
                "resultTruncated"
            ], matchingLists = [
                "expectedNames",
                "performedChecks",
                "ordersChecked",
                "linkingMethodsChecked"
            ], corresponds = evidence && evidence.status === "checked-no-usage" && evidence.evidenceKind === "absence" && matchingFields.every((field)=>evidence[field] === row[field]) && matchingLists.every((field)=>JSON.stringify(normalizeRefs(evidence[field])) === JSON.stringify(normalizeRefs(row[field])));
            if (!corresponds) add("absence-evidence", `${p}.evidenceRefs`, `Reference must identify matching absence evidence: ${ref}`);
        }
    }
    errors.push(...require("./coverage.js").coverageErrors(model));
    const expectedDigest = digest(withoutIntegrity(model));
    if (!model.integrity || Object.keys(model.integrity).sort().join(",") !== "algorithm,canonicalDigest") add("integrity-schema", "integrity", "Integrity must contain only algorithm and canonicalDigest");
    if (model.integrity?.algorithm !== "sha256" || model.integrity?.canonicalDigest !== expectedDigest) add("integrity", "integrity", "Canonical digest does not match model content");
    return {
        ok: errors.length === 0,
        errors,
        counts: Object.fromEntries(COLLECTIONS.map((name)=>[
                name,
                asArray(model[name]).length
            ])),
        canonicalDigest: expectedDigest
    };
}
module.exports = {
    validateReportModel
};
