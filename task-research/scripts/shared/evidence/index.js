"use strict";
// Named APIs load only when requested. CLI-only commands are in cli/src/commands.
let source_evidenceApi;
Object.defineProperty(exports, "source_evidence", { enumerable: true, get() { return source_evidenceApi ??= {
"compilePattern": require("./src/collection/source_checks.js").compilePattern,
"createTraversalOptions": require("./src/collection/source_files.js").createTraversalOptions,
"evidenceGroupIdentity": require("./src/collection/groups.js").evidenceGroupIdentity,
"isExcludedFile": require("./src/collection/source_files.js").isExcludedFile,
"listFiles": require("./src/collection/source_files.js").listFiles,
"parseArgs": require("./src/collection/source_evidence.js").parseArgs,
"runEvidenceChecks": require("./src/collection/source_evidence.js").runEvidenceChecks,
"selectEvidenceGroups": require("./src/collection/selection.js").selectEvidenceGroups,
"selectRoundRobin": require("./src/collection/selection.js").selectRoundRobin,
"shouldTraverseEntry": require("./src/collection/source_files.js").shouldTraverseEntry
}; } });
Object.defineProperty(exports, "source_slice", { enumerable: true, get() { return require("./src/source_slice.js"); } });
let stage2_canonicalizeApi;
Object.defineProperty(exports, "stage2_canonicalize", { enumerable: true, get() { return stage2_canonicalizeApi ??= {
"RANK": require("./src/canonicalization/canonicalize.js").RANK,
"astUsageKind": require("./src/canonicalization/candidate_adapters.js").astUsageKind,
"candidatesFromAst": require("./src/canonicalization/candidate_adapters.js").candidatesFromAst,
"candidatesFromBoundaries": require("./src/canonicalization/candidate_adapters.js").candidatesFromBoundaries,
"candidatesFromGitNexus": require("./src/canonicalization/candidate_adapters.js").candidatesFromGitNexus,
"candidatesFromOwnership": require("./src/canonicalization/candidate_adapters.js").candidatesFromOwnership,
"candidatesFromSourceEvidence": require("./src/canonicalization/candidate_adapters.js").candidatesFromSourceEvidence,
"canonicalizeStage2Candidates": require("./src/canonicalization/canonicalize.js").canonicalizeStage2Candidates,
"confirmationOf": require("./src/canonicalization/source_confirmation.js").confirmationOf,
"declaredRepository": require("./src/canonicalization/source_confirmation.js").declaredRepository,
"excluded": require("./src/canonicalization/candidate_identity.js").excluded,
"exclusionRules": require("./src/canonicalization/candidate_identity.js").exclusionRules,
"keyOf": require("./src/canonicalization/candidate_identity.js").keyOf,
"sourceFile": require("./src/canonicalization/source_confirmation.js").sourceFile
}; } });
