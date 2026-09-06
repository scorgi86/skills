"use strict";
// Named APIs load only when requested. CLI-only commands are in cli/src/commands.
let prototype_astPublicApi;
Object.defineProperty(exports, "prototype_ast", { enumerable: true, get() {
  if (!prototype_astPublicApi) { const api = require("./src/prototype_ast.js"); prototype_astPublicApi = Object.fromEntries(["COMMANDS","execute","help","parseArgs","selectFiles"].map(key => [key, api[key]])); }
  return prototype_astPublicApi;
} });
Object.defineProperty(exports, "ast_batch", { enumerable: true, get() { return require("./src/batch/ast_batch.js"); } });
Object.defineProperty(exports, "batch", { enumerable: true, get() { return require("./src/batch/batch.js"); } });
Object.defineProperty(exports, "evidence", { enumerable: true, get() { return require("./src/analysis/evidence.js"); } });
Object.defineProperty(exports, "helpers", { enumerable: true, get() { return require("./src/helpers.js"); } });
Object.defineProperty(exports, "symbol_index", { enumerable: true, get() { return require("./src/analysis/symbol_index.js"); } });
let outputApi;
Object.defineProperty(exports, "output", { enumerable: true, get() { return outputApi ??= {
"DEFAULT_OUTPUT_BUDGET": require("./src/output/policy.js").DEFAULT_OUTPUT_BUDGET,
"applyOutputPolicy": require("./src/output/policy.js").applyOutputPolicy,
"byteLength": require("./src/output/policy.js").byteLength,
"compactItem": require("./src/output/projection.js").compactItem,
"filterSemanticGroups": require("./src/output/groups.js").filterSemanticGroups,
"groupItems": require("./src/output/groups.js").groupItems,
"groupKey": require("./src/output/identity.js").groupKey,
"semanticSignature": require("./src/output/identity.js").semanticSignature
}; } });
Object.defineProperty(exports, "parser", { enumerable: true, get() { return require("./src/parsing/parser.js"); } });
let queriesApi;
Object.defineProperty(exports, "queries", { enumerable: true, get() { return queriesApi ??= {
"SCHEMA_VERSION": require("./src/analysis/analysis.js").SCHEMA_VERSION,
"analyzeFile": require("./src/analysis/analysis.js").analyzeFile,
"analyzeFiles": require("./src/analysis/analysis.js").analyzeFiles,
"buildChains": require("./src/query/chains.js").buildChains,
"filesFromList": require("./src/analysis/source_files.js").filesFromList,
"legacyView": require("./src/query/queries.js").legacyView,
"listSourceFiles": require("./src/analysis/source_files.js").listSourceFiles,
"runQuery": require("./src/query/queries.js").runQuery,
"sameName": require("./src/query/chains.js").sameName
}; } });
Object.defineProperty(exports, "relations", { enumerable: true, get() { return require("./src/analysis/relations.js"); } });
Object.defineProperty(exports, "walker", { enumerable: true, get() { return require("./src/parsing/walker.js"); } });
