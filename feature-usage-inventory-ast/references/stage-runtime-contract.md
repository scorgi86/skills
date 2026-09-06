# Shared Stage Runtime Contract

Use this contract when a stage executes AST queries or high-fanout source evidence. Stage-specific contracts still define the domain goal and gate; this file defines the reusable runtime and presentation rules.

## Budgets

Stages may declare:

```json
{
  "budgets": {
    "factsBytes": 98304,
    "summaryBytes": 24576,
    "evidenceBytes": 49152,
    "reportBytes": 65536
  }
}
```

Only the explicit `budgets` object configures stage budgets. Full facts use the preserve-required-evidence policy and may auto-raise. Summary uses a hard observation limit: if required coverage, digests, or anchors do not fit, return explicit `summary.output.overflow: true` and keep the stage partial. Never silently remove required fields to meet a budget.

## Facts Contract

The common stage facts object is versioned and contains:

- stage/status and transition lineage;
- runtime contract version, budgets, and AST plan id;
- full AST facts and source evidence;
- quality gates;
- separate measurements for transition, AST, and source evidence;
- a safe full-facts output budget record.

Stage-specific runners may keep internal producer fields, but only canonical schema 4.0 crosses a stage boundary. Presentation projections never replace canonical facts.

## AST Query Plan

Compile all known stage queries before parsing. The plan must record a stable id, query ids, unique files, required projections, `compiledBeforeParse`, and `lateQueries`.

Parse every unique file once per runner session. Include `semantic-groups` and `first-anchor-per-group` in the initial plan so summary generation does not require an owner-anchor follow-up parse. Separate CLI invocations are separate sessions; persistent cross-session caching is outside this contract.

## Semantic Projection

The model-visible summary must use a compact projection of full AST facts. For every query include:

- full coverage counters;
- a stable digest of every matched semantic group;
- groups available/returned/omitted and explicit truncation;
- selected groups with `owner`, `relation`, `field`, `target`, counts, and `firstAnchor`;
- deterministic semantic-diversity selection, with explicit required selectors applied first.

Prefer target-aware ranking when the query declares `terms`, `type`, `field`, or `symbol`. The AST batch records these as projection hints; the projection ranks matching `field`, `target`, `owner`, and `relation` values before unrelated semantic buckets while retaining deterministic diversity. Explicit `preferredTerms` may override hints per query. Ranking changes representatives only; it must not change full groups, digests, totals, or evidence.

Projection truncation is not evidence of absence. Follow-up detail queries must reference a known group key and must not redefine discovery scope.

## Grouped Source Evidence

Compute totals and groups before applying presentation limits. Each check records a digest, group totals/truncation, and per-group first anchors. Allocate match examples round-robin across selected groups instead of using global first-N order.

Supported safe grouping dimensions are explicit file, explicit pattern id, or file+pattern. Do not infer JavaScript owners with regex. Owner claims must come from AST facts or explicit source confirmation.

Use `projection.source.maxGroupsPerCheck` or `maxGroupsByCheck` to cap model-visible source groups independently from collected source facts. Preserve full `groupsTotal`, digest, matches, and explicit omitted/truncated counters. Required source group keys must be selected before the cap.

## Adaptive Summary Fitting

Enable `projection.adaptive.enabled` to fit presentation caps after facts are complete and without another AST parse. Use `targetRatio` (default `0.9`) to keep reserve below the hard summary budget. The fitter may reduce only low-ranked AST/source representatives; it must preserve required groups, full digests, totals, coverage, details, and source matches. Record requested/applied caps, attempts, target bytes, and fit status.

## Compact Anchors And Source Slices

Enable `projection.compactAnchors` to replace repeated absolute paths and range objects in summary anchors with `{fileId,line,endLine?}` plus one `anchorFiles` root/path table. Full facts keep original absolute paths, offsets, columns, and ranges.

Use `scripts/cli/src/commands/source_slice.js` on the selected summary anchors when exact source context is needed. It must resolve compact anchors, merge duplicate/overlapping ranges, enforce global line/slice limits, and report truncation. Do not dump all matched source lines.

## Internal Dictionary And Human Reports

Enable `projection.humanDictionary` only for model-transport summary compaction. Repeated `owner`, `relation`, `field`, `target`, and source-group labels may be stored once and referenced internally. The dictionary is presentation-only: full facts remain unchanged.

Decode dictionary references in `scripts/cli/src/commands/render_stage2_report.js`. Final Markdown must show concrete names and resolved source locations and must not expose generated evidence ids, encoded group references, or dictionary indexes. An unknown dictionary reference is a blocking render error.

## Executable Quality Gates

Run `scripts/cli/src/commands/coverage_gate.js` before closing an AST-backed stage. Run `scripts/cli/src/commands/quality_equivalence.js` whenever a projection, codec, cap, or compaction rule changes. The equivalence result must preserve full digests, coverage counters, required groups, and resolvable anchors.

Use `scripts/cli/src/commands/compare_stage_runs.js` for A/B metrics instead of loading both raw outputs into model context. A smaller output with failed equivalence is a quality regression, not an optimization.

## Reuse By Other Stages

Stages 4, 5, and later stages may reuse `stage_facts.js`, `fact_projection.js`, the compiled AST batch plan, and grouped source evidence. Each stage must separately define its required semantic dimensions/selectors and golden fixture. Do not copy stage-2-specific orchestration into the common modules.

When persisted evidence will support later user tasks, apply `stage-artifact-bundle.md`. Keep the complete facts/evidence on disk, generate the human report in scripts, and return only a compact manifest summary to the model. Retrieve later evidence through bounded canonical selectors and check stored source hashes before relying on it.

## Quality Gate

Require:

- stable query plan id and `compiledBeforeParse: true`;
- every session parse count equals one;
- no requested detail or detail evidence suppression;
- group totals/digests before truncation;
- first anchors for every selected AST and source group;
- bounded summary or explicit overflow/partial;
- passed executable coverage gate and, after presentation changes, passed quality equivalence;
- concrete human-readable names in persisted reports with no unresolved internal dictionary/evidence ids;
- source confirmation before candidate promotion;
- no absence claim from projections, truncation, empty candidate output, or an incomplete index.
