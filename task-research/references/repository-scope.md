# Repository scope

Do not infer repository names, neighbouring checkouts, aggregate workspaces, or product layout. Use explicit descriptors:

```json
{
  "repositories": [
    { "id": "repository-a", "root": "<absolute-folder>", "role": "producer" },
    { "id": "repository-b", "root": "<absolute-folder>", "role": "consumer", "indexAlias": "index-b" }
  ]
}
```

If this information is absent and the active workspace does not unambiguously contain every requested search root, ask the user for the folders and their roles. Never scan a parent directory or a neighbouring checkout merely because it exists.

Treat `role`, `exclusions`, `symbolAliases`, and `layerRules` as user-supplied configuration. Without a layer rule, classify a result as `unclassified`; do not infer architecture from a familiar directory name.

## Stage 0 search contract

Stage 0 requires `repositoryScope`, including when called directly through `stage0_runner`. For example:

```json
{
  "stage": 0,
  "target": "ExampleFeature",
  "coverageProfile": { "kind": "bounded", "requiredCapabilities": ["ownership", "storage", "serialization"], "requiredCollections": ["dictionary", "criticalPaths"], "requiredCriticalPaths": ["save"] },
  "scanSeeds": true,
  "repositoryScope": {
    "repositories": [
      { "id": "source", "root": "<absolute-folder>", "role": "source", "exclusions": ["excluded/**"] }
    ]
  },
  "seeds": { "direct": ["ExampleFeature"] }
}
```

Roots and per-repository exclusion globs come from this scope. Each repository is searched with its own root as working directory; globs are interpreted relative to that root. Match paths remain absolute and sorted inside each repository. Relative roots resolve against the process working directory, not the request JSON directory. `scanSeeds: false` validates and records the plan without scanning; seeds are still required by the real runner. `requireExistingRoots: false` retains the existing planning/fixture override for directory existence validation, not permission to search a different root.

Stage 0 accepts optional `searchConcurrency` in the request JSON. It must be a positive integer and is capped by the repository count. The default is `1`; larger explicit values run repository searches concurrently while preserving `repositoryScope` order in the result. Each `rg` process retains the 30-second timeout, and a failure remains local to its repository.

Legacy `repos` is optional. If supplied, it must contain exactly the same unique ids and resolved paths. Optional top-level `exclusions` may only repeat rules already declared in every repository. Local exclusions are never flattened into global rules. Invalid or conflicting declarations stop before any scan. Old direct requests containing only `repos` must be migrated to the example above; historical artifacts are not rewritten.

The original `request.repositoryScope` remains in canonical `summary.repositoryScope`, preserving the existing scope digest/lineage representation. `summary.executionScope` separately records version 1, the `scanSeeds` mode and the ordered execution repositories (`id`, normalized `root`, deduplicated `exclusions`). This describes the search parameters; it does not prove semantic completeness of the results.

Stage 0 pipeline performs scope preflight before transaction recovery and validates the execution descriptor before first journal creation, before resumed publication, and before advancing an already-published pending result. A scope/descriptor refusal leaves existing canonical artifacts, journal and state unchanged; the normal own-lock lifecycle still applies. This is not a rollback promise for unrelated later failures. Old pending artifacts without a matching descriptor stop with reissue guidance. Coordinate a separate run without automatically resetting or rebinding advanced state. An ordinary non-pending partial may be recomputed with the current runner.

## Runtime AST cache

The full-flow pipeline gives Stage 1 and Stage 2 the same disk-backed AST cache when `request.ast.cache` is absent. Its location is derived from the declared repository scope and stored under `<parent-of-outputRoot>/.runtime-cache/ast/<scopeDigest>`. Sibling inventory directories with the same scope reuse analysis; different parents or scopes remain isolated. An explicit `request.ast.cache` remains authoritative, and direct runner calls remain opt-in.

The cache is disposable runtime data. It is not canonical evidence and is not included in lineage. A hit is accepted only after the existing content, parser, analyzer, options, and file-identity checks pass; stale or corrupt entries are recomputed. Stage 3 and later stages do not receive an AST cache setting from the pipeline.
