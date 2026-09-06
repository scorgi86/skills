# Canonical Stage Artifact Bundle v4

Use this contract whenever a stage persists results. The canonical JSON is the handoff; Markdown is optional presentation.

## Layout

```text
stage-N/
├── canonical/
│   ├── stage-result.json
│   ├── evidence.json
│   └── manifest.json
├── raw/                         # only with --retain-raw or diagnostic mode
│   └── runner-result.json
└── reports/                     # optional projections
    └── transition.md
```

`stage-result.json` follows `references/schemas/canonical-stage-result.schema.json`. It carries compact confirmed facts, evidence references, open checks, metrics, provider usage, and input/output digests. `evidence.json` contains deduplicated canonical evidence. `manifest.json` binds every stored file to the stage input/output digests.

The next stage may read only `canonical/stage-result.json`. It must not use `raw/` or Markdown as a transition input.

## Persistence

Run the stage-specific runner to a temporary facts file, then canonicalize it:

```text
node scripts/cli/src/commands/canonical_stage_cli.js --facts <runner-result.json> --request <request.json> --output <stage-N>
```

Add `--usage <provider-telemetry.json>` only when the environment supplied actual token counters. Without it, the artifact records `usage.status: "unavailable"`. Never derive actual usage from bytes or `bytes / 4`.

Add `--retain-raw` only for explicit diagnostics. The default run must not create `raw/`.

Use `--budgets <budgets.json>` for `maxCanonicalFindings`, `maxEvidencePerCapability`, and `maxTransitionBytes`. Budget overflow is recorded in `metrics.budgets.warnings`; it does not silently discard confirmed or negative evidence.

## Stage 2 normalization

Deduplicate before canonical evidence creation by:

```text
repository + normalized path + symbol + range + usage kind
```

Merge matched terms and provenance, keep one bounded excerpt, and retain semantically different usage kinds. Apply only exclusions declared in repository scope or the request before evidence ids are assigned. Ranking prioritizes AST definitions, field reads/writes, and call-graph participation over plain source-text matches.

## Traceability and validation

Preserve:

```text
report statement -> canonical fact -> evidence reference -> source file/range/hash
```

Validate schema and output digest when writing and reading. An unsupported schema version, digest mismatch, missing evidence reference, or disappeared open check blocks advancement with a concrete diagnostic. Generate reports only from validated canonical JSON.
