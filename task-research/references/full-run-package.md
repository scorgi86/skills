# Full run package

Use one prepared package when all Stage 0–7 semantic inputs are known. The fragment below shows the package shape; the abbreviated empty Stage 1–6 templates are placeholders, not a runnable research package. Fill every stage from its contract before running it:

```json
{
  "schemaVersion": "research-package/1.0.0",
  "target": "FeatureValue",
  "repositoryScope": {
    "repositories": [
      { "id": "sdk", "root": "C:/work/project", "role": "source" }
    ]
  },
  "stages": {
    "0": {
      "coverageProfile": {
        "kind": "full-inventory",
        "requiredCapabilities": ["definition", "ownership", "storage", "serialization", "input", "mutation", "recipients", "readback", "render-output", "lifecycle", "theme-style", "tests", "reference"],
        "requiredCollections": ["scenarios", "criticalPaths"]
      },
      "seeds": { "direct": ["FeatureValue"] }
    },
    "1": {},
    "2": {},
    "3": {},
    "4": {},
    "5": {},
    "6": {},
    "7": {
      "evidenceSelectors": [{ "stage": 6, "limit": 100 }]
    }
  }
}
```

Stage templates contain semantic inputs only. Do not put `target`, `repositoryScope`, transition or lineage artifacts, expected artifacts, state paths, output paths, or `artifactBase` in them. A Stage 7 evidence selector names a completed stage; the coordinator resolves its active canonical artifact.

Select full-development when researching a change and add gaps and implementationEntryPoints to requiredCollections; link implementation-gap and test-gap rows from the existing entry points. Select bounded only for an explicitly limited request, where a smaller profile is allowed. Full scenarios use entry, steps and result as specified in report-contract.md. New Stage 0 requires kind before state/output creation; saved no-kind runs can resume and finalize unchanged.

## Stage 0: repository exclusions

Keep exclusions local to the repository where they apply. This fragment replaces the package's `repositoryScope`; replace the example roots with the declared search roots:

```json
{
  "repositoryScope": {
    "repositories": [
      { "id": "sdk", "root": "C:/work/project/sdk", "role": "producer", "exclusions": ["node_modules/**", "generated/**"] },
      { "id": "ui", "root": "C:/work/project/ui", "role": "consumer", "exclusions": ["node_modules/**"] }
    ]
  }
}
```

The Stage 0 template can omit `exclusions`: the runner already applies each repository's local rules. Optional `stages["0"].exclusions` may repeat only rules present in **every** repository. For this example, `["node_modules/**"]` is valid globally; `["generated/**"]` is not, because that rule is absent from `ui`. The existing Stage 0 check rejects such a conflict before scanning. See [Repository scope](repository-scope.md) for the authoritative scope and exclusion contract.

## Stage 6: feature reference

Use this template as `stages["6"]` when comparing the target with a reference entity rather than a Git diff. Replace the entity names, source path, and declared surface classification with the research inputs:

```json
{
  "mode": "feature-reference",
  "featureReference": {
    "target": "FeatureValue",
    "referenceEntity": "ReferenceValue",
    "capabilities": [
      { "id": "definition", "status": "unchecked", "evidenceRefs": [] }
    ]
  },
  "sourceSurfaces": [
    { "path": "src/model.js", "layer": "model", "role": "definition" }
  ]
}
```

`featureReference` requires `target`, `referenceEntity`, and a nonempty `capabilities` array. Each declared source surface requires `path`, `layer`, and `role`. The nested `featureReference.target` is required even though the coordinator supplies the top-level request `target`; do not add a top-level `target` or `transitionArtifact` to this stage template. A capabilities list in Stage 7 does not replace `featureReference.capabilities` in Stage 6.

This is a structurally valid starting template, not a completed investigation. `unchecked` and empty evidence refs make no source-confirmed claim. Fill the actual capabilities and confirm them with evidence as research proceeds; the single row above does not satisfy the full-inventory obligations declared in Stage 0. Follow [Report contract](report-contract.md) for final coverage. The existing runner checks the feature-reference inputs when Stage 6 executes; package loading does not check this missing-capabilities case in advance.

Run:

```text
node scripts/index.js full_run --package research-package.json --state inventory-state.json --output-root artifacts
```

The command creates state when absent, executes only the active stage, stops on a partial result, and resumes that stage on the next call. It derives every transition from active state. After Stage 7 it runs the existing digest-bound Stage 8 renderer, validates and advances the manifest, then marks the run complete. A completed run is a no-op.

Exit code `0` means complete, `3` means partial, and `2` means error. Timing attempts are stored in `<output-root>/full-run-metrics.json`; they are operational metrics and are not canonical research facts. Changing the target, repository scope, or Stage 0 coverage profile requires a new state and output root.
