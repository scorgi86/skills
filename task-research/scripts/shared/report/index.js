"use strict";
// Named APIs load only when requested. CLI-only commands are in cli/src/commands.
let report_modelApi;
Object.defineProperty(exports, "report_model", { enumerable: true, get() { return report_modelApi ??= {
"COLLECTIONS": require("./src/model/rows.js").COLLECTIONS,
"MODEL_TYPE": require("./src/model/rows.js").MODEL_TYPE,
"SCHEMA_VERSION": require("./src/model/rows.js").SCHEMA_VERSION,
"absenceClaims": require("./src/model/projection.js").absenceClaims,
"absenceProjection": require("./src/model/projection.js").absenceProjection,
"canonicalJson": require("./src/model/serialization.js").canonicalJson,
"digest": require("./src/model/serialization.js").digest,
"normalizeReportModel": require("./src/model/normalization.js").normalizeReportModel,
"stable": require("./src/model/serialization.js").stable,
"validateReportModel": require("./src/model/validation.js").validateReportModel,
"withoutIntegrity": require("./src/model/serialization.js").withoutIntegrity
}; } });
let validate_inventory_reportApi;
Object.defineProperty(exports, "validate_inventory_report", { enumerable: true, get() { return validate_inventory_reportApi ??= {
"REQUIRED_BUNDLE_DOCUMENTS": require("./src/bundle/documents.js").REQUIRED_BUNDLE_DOCUMENTS,
"listMarkdownDocuments": require("./src/bundle/documents.js").listMarkdownDocuments,
"validate": require("./src/markdown/validate_report.js").validate,
"validateInventoryBundle": require("./src/bundle/validation.js").validateInventoryBundle
}; } });
Object.defineProperty(exports, "validate_inventory_stage", { enumerable: true, get() { return require("./src/validate_inventory_stage.js"); } });
