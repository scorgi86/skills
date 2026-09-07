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
  "coverageProfile": { "requiredCollections": ["dictionary", "criticalPaths"], "requiredCriticalPaths": ["save"] },
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

Legacy `repos` is optional. If supplied, it must contain exactly the same unique ids and resolved paths. Optional top-level `exclusions` may only repeat rules already declared in every repository. Local exclusions are never flattened into global rules. Invalid or conflicting declarations stop before any scan. Old direct requests containing only `repos` must be migrated to the example above; historical artifacts are not rewritten.

The original `request.repositoryScope` remains in canonical `summary.repositoryScope`, preserving the existing scope digest/lineage representation. `summary.executionScope` separately records version 1, the `scanSeeds` mode and the ordered execution repositories (`id`, normalized `root`, deduplicated `exclusions`). This describes the search parameters; it does not prove semantic completeness of the results.

Stage 0 pipeline performs scope preflight before transaction recovery and validates the execution descriptor before first journal creation, before resumed publication, and before advancing an already-published pending result. A scope/descriptor refusal leaves existing canonical artifacts, journal and state unchanged; the normal own-lock lifecycle still applies. This is not a rollback promise for unrelated later failures. Old pending artifacts without a matching descriptor stop with reissue guidance. Coordinate a separate run without automatically resetting or rebinding advanced state. An ordinary non-pending partial may be recomputed with the current runner.
