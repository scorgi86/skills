"use strict";
// Named APIs load only when requested. CLI-only commands are in cli/src/commands.
let canonical_stage_resultApi;
Object.defineProperty(exports, "canonical_stage_result", { enumerable: true, get() { return canonical_stage_resultApi ??= {
"SCHEMA_VERSION": require("./src/canonical/validation.js").SCHEMA_VERSION,
"budgetMetrics": require("./src/canonical/facts.js").budgetMetrics,
"createCanonicalStageResult": require("./src/canonical/result.js").createCanonicalStageResult,
"digest": require("./src/canonical/validation.js").digest,
"normalizeUsage": require("./src/canonical/facts.js").normalizeUsage,
"prepareFacts": require("./src/canonical/facts.js").prepareFacts,
"validateCanonicalStageResult": require("./src/canonical/validation.js").validateCanonicalStageResult
}; } });
Object.defineProperty(exports, "stage_artifact_v4", { enumerable: true, get() { return require("./src/stage_artifact_v4.js"); } });
Object.defineProperty(exports, "query_stage_artifacts", { enumerable: true, get() { return require("./src/query_stage_artifacts.js"); } });
