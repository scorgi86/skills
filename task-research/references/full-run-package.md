# Full run package

Use one prepared package when all Stage 0–7 semantic inputs are known:

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
    "0": { "coverageProfile": {} },
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

Run:

```text
node scripts/index.js full_run --package research-package.json --state inventory-state.json --output-root artifacts
```

The command creates state when absent, executes only the active stage, stops on a partial result, and resumes that stage on the next call. It derives every transition from active state. After Stage 7 it runs the existing digest-bound Stage 8 renderer, validates and advances the manifest, then marks the run complete. A completed run is a no-op.

Exit code `0` means complete, `3` means partial, and `2` means error. Timing attempts are stored in `<output-root>/full-run-metrics.json`; they are operational metrics and are not canonical research facts. Changing the target, repository scope, or Stage 0 coverage profile requires a new state and output root.
