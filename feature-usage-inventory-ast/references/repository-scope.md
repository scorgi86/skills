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
