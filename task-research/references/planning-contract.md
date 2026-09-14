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

For source checks with explicit confirmations, give each authored proof a separate `confirmation.id` (or an id on the corresponding `confirmations` entry), distinct from the search check id and unique to its source anchor. Collection preserves that id only on the validated confirmed match; canonicalization maps it to the exact evidence id. Reference the separate proof id or its canonical id from confirmed planning facts. The check id remains a search-group alias and may name both candidates and proofs. A valid source anchor does not establish its semantic relationship to a fact: research must author that relationship explicitly. Inputs without separate confirmation ids retain their existing behavior.

## New planning inputs in the stage pipeline

Before publishing Stages 0–6, `stage_pipeline` checks the planning inputs actually emitted by the runner: collection arrays, `ownership.groups`, graph nodes/edges, and the alternative `canonicalFacts` form. Authored rows require non-empty string ids before merging; generated limitation ids remain supported. An id cannot name different planning collections, including earlier active lineage. Exact duplicates and reference/provenance unions are allowed. Empty values (missing, null, whitespace-only strings or empty arrays) may be filled, but cannot erase filled values. Different filled name/title/statement/entry/steps/result/repository/file/path/layer values, or different reference-path roles, are conflicts rather than last-writer-wins updates. Step order matters. Candidate/unknown statuses may advance to terminal proof statuses; replacing terminal status or filled content requires revising the originating stage and rebuilding its successors.

Generated source surface ids use repository, normalized repository-relative path, layer and role, not source hashes or anchors. Declare `repository` on each surface when the scope contains multiple roots; a single-root scope supplies it automatically. Explicit ids are retained but cannot conceal different surface identities. Paths must stay inside the declared root, use normalized separators/dot segments, and retain case.

After canonical evidence and lineage aliases are resolved, the pipeline checks source-confirmed references for the confirmed planning rows/capabilities actually supplied, and the existing full-profile entry/steps/result rule for supplied terminal scenarios other than N/A. Incomplete candidates are permitted; missing final capabilities, collections and lifecycle coverage still belong to Stage 7. The new check throws before publication and state advance; correct the input and retry through the existing transaction path. It does not add guards to standalone writer/import routes or move absence/N/A proof/reason validation out of their existing checks. Saved artifact reading and Stage 7/8 contracts are unchanged.

Stage 3 `consumerCoverage` is scoped search metadata, not a scenario. Canonical-only artifacts retain it in `summary.consumerCoverage`; supply researched scenarios explicitly through `scenarios` rather than inventing entry, steps or result from search matches.

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
