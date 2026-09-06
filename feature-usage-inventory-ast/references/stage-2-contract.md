# Stage 2 Contract: Dictionary Expansion

Read this file with `stage-runtime-contract.md` instead of the general staged, AST, GitNexus, evidence, and report references while executing full-inventory stage 2. The Always-On Contract in `SKILL.md` remains binding.

## Goal And Boundary

Expand the stage-1 ownership vocabulary through second-, third-, and N-order objects, properties, methods, aliases, bridges, and reference-path candidates. Execute no later stage.

DoD: every added object must record its relation method/property, reason, repository/file scope, evidence status, and next search group.

## Ownership Frontier Mode

If Stage 1 facts contain `ownershipGraph`, pass them through `ownershipGraphArtifact`. Add only source-confirmed candidate nodes in `ownershipGraphNodes` and owner-to-child edges in `ownershipGraphCandidates`; the runner calculates the next order, deduplicates nodes, retains cycles, and rejects dangling higher-order nodes. Stop at the request-defined maximum order, scope boundary, or an empty confirmed frontier.

## Required Input

Read only the structured transition artifact from stage 1. It must contain target, scope, stage, status, confirmed evidence, candidate evidence, dictionary/graph/path state, skipped/forbidden sources, open checks, and next stage.

Stop if the artifact is missing, invalid, points to another next stage, or silently drops unresolved checks.

## Evidence Status

- Treat GitNexus and AST output as candidate discovery.
- Promote a candidate only after exact source confirmation of file, symbol/property/method, role, and path.
- Keep unconfirmed candidates as `unverified`; keep rejected candidates and noise separate.
- An empty, stale, partial, truncated, parse-failed, skipped-file, unresolved-symbol, or graph-only result is never absence evidence.
- A checked-no-usage claim requires expected names, why they were expected, exact searched scope, linked objects/methods checked, and the path closed or still blocked.

## Tool Routing

1. Record repository, branch/worktree, index freshness, skipped large files, and allowed search zones.
2. If an exact seed symbol is known, use GitNexus `context`, callers/callees, or bounded trace first.
3. Use broad GitNexus `query` only when discovering an unknown concept or scenario vocabulary.
4. Convert graph results to candidate files/symbols; confirm them in source.
5. Run local AST only on explicit candidate files. Never run AST over an entire product repository.
6. Use one `scripts/cli/src/commands/stage2_runner.js` request for the stage. Pass JSON through a file on Windows.
7. Use bounded exact source checks for confirmation; `candidate-empty` remains unverified.

## Safe AST Request

The request must contain:

- `stage: 2`;
- `transitionArtifact`;
- `ast.queries` with command, explicit file/files, options, semantic group filters, and `includeDetails` where exact details are required;
- `evidence.checks` with explicit files or narrow scope;
- optional separate `budgets.factsBytes`, `budgets.summaryBytes`, `budgets.evidenceBytes`, and `budgets.reportBytes`;
- optional `projection.maxGroupsPerQuery`, `projection.requiredGroups`, and `projection.preferredTerms` for target-aware semantic representatives;
- optional `projection.source.maxGroupsPerCheck`, `maxGroupsByCheck`, and `requiredGroupKeys` for source-summary presentation only.
- optional `projection.compactAnchors` and `anchorRoot` for summary-only path/range compaction;
- optional `projection.adaptive.enabled`, `targetRatio`, minimum caps, and max attempts for in-session presentation fitting.
- optional `projection.humanDictionary` for internal summary transport only; persisted Markdown must decode every reference to a concrete name.

The runner must compile the complete query plan before parsing and parse each unique candidate file once per runner session. Budget preflight may raise the full-facts budget, but must not suppress requested detail evidence or reparse files. Summary overflow must be explicit and keeps the stage partial.

## Coverage Gate

Require and record:

- every `ast.stats.parseCounts` value equals `1`;
- `ast.plan.compiledBeforeParse == true`, stable plan id, and `lateQueries == 0`;
- `totalItems`, `groupsScanned`, `groupsMatched`, `groupsReturned`, and `groupsTruncated` for each query;
- `detailsRequested == detailsReturned` and `detailsSuppressed == 0` for requested details;
- `detailEvidenceSuppressed == 0`;
- source `filesScanned`, `totalMatches`, `returned`, and `truncated`;
- AST/source group digests, totals, truncation, and first anchors for selected groups;
- `budgetRequested`, `budgetRequired`, `budgetApplied`, and whether it was auto-raised;
- parser/index failures, skipped sources, stale indexes, and open confirmations.
- executable `coverage_gate.js` result; after projection/codec changes, a successful `quality_equivalence.js` result.

If required details cannot be returned, keep the stage partial and stop. Do not narrow discovery to make the output fit.

## Output

Build a compact transition artifact containing:

- target and exact scope;
- stage 2 and status;
- confirmed evidence separated from graph/AST candidates;
- expanded dictionary with relation, reason, scope, status, and next search;
- ownership/path additions;
- rejected/noise/unknown candidates;
- skipped/forbidden sources with reason category;
- open checks;
- next stage 3.

Execute Stage 2 through `scripts/cli/src/commands/stage_pipeline.js`. It persists canonical result, canonical evidence, and manifest atomically at the automatic artifact path. Producer facts remain internal unless `--retain-raw` is explicitly enabled; stdout contains only the bounded pipeline summary.

The renderer must decode internal summary dictionaries and print concrete owners, fields, targets, relations, and `file:line` anchors. Generated evidence ids and dictionary indexes are forbidden in the final human-readable report. Compare changed projections with `quality_equivalence.js`; compare benchmark runs with `compare_stage_runs.js` without loading both full artifacts into model context.

Generate report links from canonical manifest records. Preserve technical ids only inside machine artifacts. Later tasks must query canonical evidence with `query_stage_artifacts.js` instead of loading complete evidence into model context.

## Stage Report And Stop

Report the completed stage, artifact location or in-thread artifact, evidence collected, skipped/forbidden sources, open checks, protocol deviations, and next step. After stage 2, apply the recorded execution mode. In `adaptive` or `continuous` mode, immediately proceed to stage 3 unless a documented stop condition from `execution-levels.md` is present. In `strict` mode, stop after stage 2.

Keep the stage partial if coverage counters disagree, requested evidence is suppressed, a relevant file cannot be parsed, the index is incomplete and used for absence, or the output requires unresolved discovery filtering.
