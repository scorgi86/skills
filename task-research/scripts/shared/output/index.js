"use strict";
// Named APIs load only when requested. CLI-only commands are in cli/src/commands.
Object.defineProperty(exports, "fact_projection", { enumerable: true, get() { return require("./src/fact_projection.js"); } });
let stage_factsApi;
Object.defineProperty(exports, "stage_facts", { enumerable: true, get() { return stage_factsApi ??= {
"DEFAULT_BUDGETS": require("./src/summary/budget.js").DEFAULT_BUDGETS,
"assembleStageSummary": require("./src/summary/stage_summary.js").assembleStageSummary,
"buildStageSummary": require("./src/summary/stage_summary.js").buildStageSummary,
"createStageFacts": require("./src/stage_facts.js").createStageFacts,
"finalizeSummaryBudget": require("./src/summary/budget.js").finalizeSummaryBudget,
"fitAdaptiveSummary": require("./src/summary/stage_summary.js").fitAdaptiveSummary,
"normalizeBudgets": require("./src/summary/budget.js").normalizeBudgets,
"projectSourceCheck": require("./src/summary/source_projection.js").projectSourceCheck,
"sourceProjection": require("./src/summary/source_projection.js").sourceProjection
}; } });
Object.defineProperty(exports, "summary_compaction", { enumerable: true, get() { return require("./src/summary/compaction.js"); } });
Object.defineProperty(exports, "human_report_codec", { enumerable: true, get() { return require("./src/human_report_codec.js"); } });
Object.defineProperty(exports, "measure_context", { enumerable: true, get() { return require("./src/measure_context.js"); } });
Object.defineProperty(exports, "quality_equivalence", { enumerable: true, get() { return require("./src/quality_equivalence.js"); } });
Object.defineProperty(exports, "compare_stage_runs", { enumerable: true, get() { return require("./src/compare_stage_runs.js"); } });
