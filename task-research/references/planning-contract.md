# Planning Contract

Use this contract for implementation-impact inventories, gap analysis, Stage 7 assembly, and implementation-map validation.

## Canonical planning kinds

Carry planning facts through `canonical-stage-result/4.0.0` with stable ids:

- `ownership`, `ownership-node`, `ownership-edge`;
- `dictionary`;
- `scenario`;
- `recipient-family`;
- `critical-path`;
- `reference-path`;
- `gap`;
- `implementation-entry`;
- `confirmed-usage`, `checked-no-usage`, `reference-only`, `noise`, `limitation`.

Use `evidenceRefs`, `scenarioRefs`, `recipientRefs`, `pathRefs`, `gapRefs`, `capabilityRefs`, and `testSurfaceRefs` for typed links. Preserve unresolved relationships as open checks; do not invent a target file or symbol.

## Required planning trace

For each proposed implementation area retain this trace when applicable:

```text
gap or requirement
  -> existing implementation entry
  -> affected scenarios and recipients
  -> critical/reference paths
  -> source evidence
  -> capabilities and test surfaces
```

An `implementation-entry` must reference source evidence and at least one scenario, gap, capability, or path. A `gap` must record an expected path, name, place, or checked scope.

## Bounded retrieval

Query canonical facts with `query_stage_artifacts.js` using `--fact-kind`, `--fact-id`, `--capability`, `--scenario`, `--recipient`, `--gap`, `--path`, or `--implementation-entry`. Use `--evidence-for <fact-id>` to retrieve evidence referenced by one fact. Narrow a truncated selector before Stage 7; use `allowTruncated` only when the omission is explicitly acceptable and recorded.

Stage 7 deterministically projects these kinds into the report model. Request-level rows may enrich or override the same stable id, but must not silently remove inherited facts.
