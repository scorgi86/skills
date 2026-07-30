---
name: feature-usage-inventory-ast
description: 'Find and document feature usage with graph/AST assistance from GitNexus using an artifact-driven staged workflow with user-selected strict, adaptive, or continuous execution and optional Codex goal-driven continuation across turns. Use for AST inventory, GitNexus-assisted inventory, call graph or impact analysis, cross-repo usage mapping, or a stronger inventory than plain text search. Full inventories preserve and validate every stage transition; GitNexus and AST candidates must be confirmed with source evidence before they become final findings.'
---

# Feature Usage Inventory AST

This skill is a staged router overlay for `feature-usage-inventory`. For a full inventory, treat stages 0-8 as a state machine and preserve every validated transition. Before a new full inventory, read `references/execution-levels.md`; when an active Codex goal drives the work, also read `references/goal-execution.md`. For a narrow graph/AST question, use the compact targeted workflow below.

## Always-On Contract

- Before a new full inventory, ask one combined question for both execution mode (`strict|adaptive|continuous`) and continuation method (`interactive|goal`), unless both are explicitly present in an active goal objective. Do not choose defaults, run Stage 0, create state, persist task artifacts, or run inventory diagnostics until both are resolved. Reuse the recorded values on continuation. Targeted Graph/AST questions require neither selection.
- Treat execution mode and driver as independent. `interactive` waits for the user after a stop; `goal` resumes automatically across turns. Never create or enable a goal unless the user explicitly requests it, and never migrate an existing inventory to `goal` implicitly.
- After mode selection and before a full inventory, skill test, or work in a new environment, run `node scripts/diagnose.js --pretty`. For an explicit repository set use `--repos sdkjs,web-apps,desktop-apps`. Stop on `blocked`; record every `degraded` check as an open limitation. Diagnostics are read-only and do not require artifact-path approval.
- Treat GitNexus, graph, and local AST results as candidate discovery. Promote a candidate to evidence only after concrete source confirmation: manual file reading and/or targeted text/file-name search when allowed by the user.
- Never close an absence claim from an empty GitNexus `query`, missing graph edge, unresolved symbol, stale index, FTS warning, or AST-only result.
- Record graph/index limitations when they affect coverage, especially stale indexes, degraded FTS, unresolved symbols, prototype-style JavaScript misses, or skipped repositories.
- Keep the final report contract compatible with `feature-usage-inventory`: statuses, evidence discipline, checked-no-usage rules, gap handling, and validation remain binding.
- Treat persisted stage data as the planning source of truth and Markdown as an aggregate view. Preserve useful candidate observations, exact check contracts, coverage counters, exclusions, and negative checks in machine-readable artifacts; do not let `maxMatches`, report size, or stdout compaction discard them. Do not duplicate full source text: retain anchors, bounded snippets, source hashes, and query/check provenance instead.
- Execute the number of canonical stages allowed by the recorded mode. Each stage remains a separate `assert -> execute -> persist -> validate/gate -> advance` transaction. Never begin a later stage before the previous stage advances successfully.
- A full inventory has one `inventory-state.json` beside its approved artifacts. Before a canonical stage run `node scripts/stage_state.js assert --state <inventory-state.json> --stage <N>`; after its validator succeeds, run `advance` with the canonical artifact. A failed assertion blocks the run.
- To resume an inventory created before this controller existed, use the one-time `adopt` command with an existing, stage-numbered JSON facts artifact. It records the completed historical stage without rerunning it; do not use `adopt` to skip new work.
- A bounded check is a `bounded-probe`, not an этап: it must declare `parentStage` equal to the current canonical stage, attach its artifact through `stage_state.js attach-probe`, and must not advance state, be titled `Этап N`, or claim an этап is complete. It may supply evidence to the current or later canonical stage.
- Before starting analysis that will produce persisted results, ask the user where and in what format to save them. Do not create report, stage, cache, or raw-output artifacts until the user answers. In-thread previews remain allowed when they do not write files.
- Use the previous stage artifact as the declared input of the next stage. Do not restart discovery when the user says `продолжай`.
- If this router conflicts with a loaded reference or the original inventory skill, follow the stricter rule.

## Token Control

- Do not read all references by default. Read only the routed files required for the active request.
- Prefer GitNexus `list_repos`, `context`, `cypher`, `trace`, and focused `query` calls to find candidate files before local AST.
- Do not run full `prototype_ast.js analyze <file>` on large files unless the user explicitly asks for raw AST output or the stage artifact records a strong reason.
- Prefer filtered AST commands, symbol/field terms, candidate files, and exact line-range reads.
- Keep raw tool output under 200 lines by default. If a tool can emit huge output, narrow the query, store raw output outside chat, or read only selected ranges.
- Use the analyzer's default `--output-mode auto`. For broad/high-fanout results, consume `data.groups` and `coverage` first, then request only selected groups with `--details-for <group-key> --output-mode detail`.
- Do not infer missing coverage from compact output. Check `coverage.totalItems`, `uniqueGroups`, `groupsTruncated`, `nextGroupOffset`, and `evidenceSuppressed`; page with `--group-offset` until the required group scope is covered.
- At stage 2, prefer one `scripts/stage2_runner.js` request over separate `symbols`, `methods`, and `find` invocations. It extracts only the prior transition block, parses each candidate file once, filters semantic groups before presentation, and returns bounded facts for report assembly.
- At full-inventory stage 1, read `references/stage-1-contract.md` and prefer one `scripts/stage1_runner.js` request. Persist complete facts in an approved bundle and consume only `--stdout summary`; do not repeat broad `rg -C` output or duplicate GitNexus contexts when the canonical seed resolves.
- For ownership-driven inventories, declare `ownershipGraph` with order-0 seed nodes and source-confirmed `stores|owns|contains|wraps` edges. Stage 1 computes the owner frontier; Stage 2 advances it with `ownershipGraphArtifact`, `ownershipGraphNodes`, and `ownershipGraphCandidates`. Serialization, copy, history, and API edges remain auxiliary and never raise ownership order by themselves.
- When a Stage 1 request declares generic `boundaries`, retain only anchored producer-consumer candidates (producer repo, kind, symbol, relation, evidence refs, ownership refs, search terms, consumer repos). They are never confirmed UI use at Stage 1. Pass the generated `boundaries.json` to Stage 2 via `boundaryArtifact`; use `scripts/stage3_runner.js` only after Stage 2 to check bounded consumer scopes.
- At full-inventory stage 0, prefer one `scripts/stage0_runner.js` request: record scope, seeds, exclusions, and exact file-level candidates only; do not run AST or ownership expansion before stage 1.
- For AST-backed stages, apply `references/stage-runtime-contract.md`: compile the full query plan before parse, keep full facts outside model context, and consume the semantic projection with coverage, group digests, and first anchors.
- Let query `terms/type/field/symbol` drive target-aware representative ranking. Cap model-visible source groups through `projection.source` rather than reducing collected evidence.
- Prefer `projection.compactAnchors` and in-session `projection.adaptive` fitting when summary size is close to its budget. Required groups and full facts must remain unchanged.
- Use optional `projection.humanDictionary` only for internal summary transport. Decode it in scripts before rendering; final Markdown must contain concrete owners, fields, targets, relations, and source locations rather than generated evidence or dictionary ids.
- Run `scripts/coverage_gate.js` before closing stage 2 and `scripts/quality_equivalence.js` when changing projections. A failed gate or changed digest/coverage/required group keeps the stage partial.
- Use `scripts/source_slice.js` to assemble bounded, merged source context from selected anchors instead of printing broad manual ranges.
- At full-inventory stage 2, read `references/stage-2-contract.md` as the active contract instead of loading the general staged/evidence/report references. Load a general reference only when the stage-2 contract cannot resolve a validation or transition issue.
- When stage 2 persists a report and evidence, also read `references/stage-artifact-bundle.md`. Generate the complete report and artifact links in scripts; keep facts/evidence out of model context and return only the compact bundle manifest summary.
- For Stage 1–2 bundles, retain `checks.json` and `source-observations.jsonl.gz` alongside facts/findings/evidence. For Stage 3, call `stage3_runner.js --output <facts.json>` and retain its full result; later manual stages must save the complete source-evidence result separately from the report.
- At Stage 4, prefer `stage4_runner.js --output <facts.json>` with request-declared recipient families. It classifies families without project-specific names, carries declared prior-stage evidence, retains all observations, and publishes reusable check ids for Stage 5.
- At Stage 5, prefer `stage5_runner.js --output <facts.json>` with targeted path checks and declared exact-name coverage. It uses `rg` to enumerate the coverage set and matching files, reads only matching files for complete observations, retains prior-artifact references, and emits bounded stdout.
- After a Stage 5 speed/token optimization, run `stage5_equivalence_gate.js --baseline <facts.json> --candidate <facts.json> --output <equivalence.json>`. It requires identical check totals, normalized full anchors, coverage counters, and current source SHA-256 fingerprints.
- At Stage 6, prefer `stage6_runner.js --output <facts.json>` with a declared reference repo/ref and source surfaces. It resolves the exact commit, makes a fast name-status pass, stores only patch anchors and SHA-256 digests for declared surfaces, and emits a bounded summary.
- At Stage 7, use `stage7_runner.js --output <report-model.json>` to assemble the complete canonical report model from prior facts. Stage 7 owns normalization, evidence/reference checks, repair, coverage, and the canonical digest. Do not advance until `stage7_coverage_gate.js` passes; an invalid model remains Stage 7 even if a bounded probe or subagent is used to close a local gap.
- At Stage 8, use `stage8_runner.js --model <report-model.json> --output-dir <directory> --state <inventory-state.json>`. Stage 8 must match the model digest to the trusted digest recorded when Stage 7 closed, revalidate the model read-only, render the decision report, implementation map, and evidence report, and write their manifest. Stage 8 must not research, repair, reinterpret, or add facts.
- For every future Stage 1–6 request, declare generic `capabilities` at the point evidence is discovered. Use only capability ids from `capability_contract.js`; `confirmed` requires evidence refs, `checked-no-usage` requires expected names and scope, and non-applicable capabilities require a reason. Do not encode feature or repository names in the contract.
- Use `scripts/source_evidence.js` for bounded source confirmation. Every check must declare explicit files or a narrow scope; `candidate-empty` is never absence evidence.
- Before every final answer, check whether full AST dumps, broad searches, or unrelated references were avoided. If not, report the deviation.

## Routing

Read only the rows that match the current request. The full-inventory stage-2 row takes precedence over the general full-inventory row.

| Request shape | Read |
|---|---|
| Full inventory stage 0, scope/seeds/exclusions | `references/staged-execution.md`, `references/evidence-rules.md` |
| Full inventory stage 1, lower layers/ownership/containers | `references/stage-1-contract.md`, `references/ownership-depth.md` |
| Full inventory stage 2, dictionary/alias expansion | `references/stage-2-contract.md`, `references/stage-runtime-contract.md` |
| Stage 2 report bundle, persisted evidence, later artifact query | `references/stage-artifact-bundle.md` |
| Full inventory, "найди все", "инвентаризация", "по этапам", skill test | `references/execution-levels.md`, `references/staged-execution.md`, `references/evidence-rules.md`, `references/report-contract.md` |
| Full inventory under `/goal`, active goal continuation, goal resume/complete/blocked | `references/goal-execution.md`, `references/execution-levels.md`, `references/staged-execution.md` |
| GitNexus-assisted search, graph candidates, callers/callees, trace, impact | `references/gitnexus-workflow.md`, `references/evidence-rules.md` |
| Local AST needed after candidate discovery | `references/ast-workflow.md`, `references/evidence-rules.md` |
| Implement or migrate the local AST analyzer to SWC | `references/local-ast-analyzer-implementation-plan.md`, `references/ast-workflow.md`, `references/evidence-rules.md` |
| R7 sdkjs/web-apps/desktop-apps, junction workspace, repository scope | `references/r7-repositories.md`, `references/search-noise-profiles.json` |
| Report creation, report validation, final acceptance | `references/report-contract.md` |
| Ownership depth, recipients, critical paths, paired mechanisms | Existing domain references only when the active stage needs them: `ownership-depth.md`, `recipient-fanout.md`, `critical-paths.md`, `paired-mechanisms.md`, `concepts.md`, `search-playbook.md` |

## Execution Model

### Full Inventory

Use the full model for `найди все`, `инвентаризация`, implementation-impact, branch comparison, report completeness checks, skill tests, and any request whose completeness cannot be proved in a narrow pass.

1. Start at stage 0 unless a valid prior stage artifact is supplied.
2. Read `inventory-state.json`; execute consecutive canonical stages according to its recorded mode and driver. For `goal`, verify the active objective digest before continuing. Multiple bounded probes are allowed only inside their parent stage and leave the canonical state unchanged.
3. Finish the stage with the gate blocks from `references/staged-execution.md`.
4. Validate a saved Markdown stage artifact with `scripts/validate_inventory_stage.js`.
5. After every successful `advance`, apply `references/execution-levels.md`: continue or stop at the closed stage boundary.
6. Resume from the recorded artifact and open checks; do not repeat closed work.
7. Produce the final inventory only at stage 8 after all applicable earlier gates are closed or explicitly carried as open limitations.

Do not collapse stages into one-shot mode, even when several stages execute in one answer.

### Targeted Graph/AST Question

Use this compact workflow only when the user explicitly asks a narrow question such as callers of one symbol, one trace, one impact check, or AST structure in a bounded file set:

1. **Scope** - record the exact symbol, repository, files, allowed tools, and exclusions.
2. **Candidates** - use the smallest relevant GitNexus/AST operation and record index/tool limitations.
3. **Confirmation** - verify important candidates in exact source locations.
4. **Result** - answer the narrow question with evidence, remaining unknowns, and protocol deviations.

If candidate expansion reveals multiple layers, recipient families, cross-repo flows, or unresolved completeness, stop the targeted workflow and initialize full-inventory stage 0 in the next answer.

## Stage State

`inventory-state.json` is the continuation authority. It records the selected execution mode and driver, goal objective digest when applicable, continuation progress, stages completed in the current run, `lastCompletedStage`, `currentStage`, the latest canonical artifact, partial resume contract, and attached bounded probes. The transition artifact is the stage-local handoff and must agree with that state.

At every full-inventory gate, persist or print a compact transition artifact containing:

- target and repository/branch scope;
- current stage and status;
- confirmed evidence and candidate evidence kept separate;
- search dictionary and ownership/path additions accumulated so far;
- skipped or forbidden sources with reason category;
- open checks and the exact next stage.

Later stages may extend the transition artifact but must not silently discard unresolved checks.

## Required Stage/Test Reporting

For every completed full-inventory stage and every skill test, the answer is incomplete unless it includes a `Stage Execution Report`.

```text
Stage Execution Report
mode: <strict|adaptive|continuous>
driver: <interactive|goal>
stages completed: <numbered stage names>
stages completed this run: <ordered stage numbers, or none>
stage artifacts: <report file, stage file, or in-thread artifact>
evidence collected: <key evidence grouped by stage>
skipped/forbidden sources: <source -> user-forbidden|tool-unavailable|out-of-scope|missed/deviation>
open checks: <unclosed checks, validators not run, unverified scopes>
protocol deviations: <none, or exact deviations and why>
next step: <next stage, validation, or no-op if complete>
```

## Final Self-Check

Before every final answer in staged execution, verify:

- Did I report every completed stage by number/name?
- Did I execute only stages permitted by the recorded execution mode?
- Did I continue or stop according to the recorded driver?
- For a goal run, did I verify the objective digest and avoid premature goal completion?
- Did I preserve a separate validated transition for every completed stage?
- Did the current stage consume the previous transition artifact?
- Did I state the current canonical stage, attached probes, and whether `inventory-state.json` changed?
- Did I list evidence per stage?
- Did I list skipped tools, sources, and scopes with the reason category?
- Did I distinguish user-forbidden limitations from skill/protocol deviations?
- Did I include Execution Status or Stage Execution Report as required?
- Did I avoid unfiltered AST/file dumps and unrelated references?

If any answer is no, add the missing fields before sending the final answer.

## Scripts

- `scripts/diagnose.js` - read-only readiness check for Node.js, skill-local SWC, required scripts, the base inventory skill, `rg`, `git`, GitNexus graph/FTS, and requested repository indexes. Returns versioned JSON with `ready`, `degraded`, or `blocked` status; `--strict` promotes recommended failures to blocking.
- `scripts/quick_validate.js` - dependency-free Node.js port of the skill-creator quick validator for frontmatter, required fields, allowed keys, skill naming, and description constraints.
- `scripts/prototype_ast.js` - SWC-based local AST helper with versioned JSON, filtered queries, bounded chains, and opt-in cache. Use only after routed AST rules are loaded.
- `scripts/ast_batch.js` - run multiple filtered AST queries with one parse per unique candidate file.
- `scripts/fact_projection.js` - build deterministic semantic projections with group digests, diversity selection, and first anchors.
- `scripts/stage_facts.js` - shared versioned facts contract, separate stage budgets, and hard-bounded summary accounting.
- `scripts/summary_compaction.js` - compact repeated anchor paths/ranges into a resolvable summary file table.
- `scripts/source_slice.js` - resolve selected anchors and emit deduplicated, globally bounded source slices.
- `scripts/human_report_codec.js` - encode repeated internal summary names and restore concrete human-readable names before report rendering.
- `scripts/quality_equivalence.js` - compare facts/projections without accepting changed digests, coverage, required groups, or anchors.
- `scripts/coverage_gate.js` - enforce stage-2 parse, suppression, digest, anchor, and budget invariants.
- `scripts/compare_stage_runs.js` - return a compact A/B metric delta with an embedded quality-equivalence result.
- `scripts/extract_stage_transition.js` - read only the structured continuation block from a prior stage artifact.
- `scripts/goal_contract.js` - normalize material active-goal parameters and calculate the stable objective digest used by goal continuations.
- `scripts/stage_state.js` - fail-closed canonical-stage and execution-driver state controller: initialize/adopt/status/assert/advance the 0-8 sequence, track goal continuations/checkpoints/blockers, close only after Stage 8, and attach bounded probes without advancing them.
- `scripts/source_evidence.js` - bounded exact source/file-name checks with totals, semantic groups, digests, first anchors, and round-robin examples; `retainAllMatches` preserves all useful source observations for artifacts while output/report limits remain bounded.
- `scripts/stage0_runner.js` - facts-first Stage 0 scope/seed/exclusion and exact file-level candidate scan; publishes a compact transition bundle without AST or ownership expansion.
- `scripts/stage1_runner.js` - stage-1 facts-first runner: one canonical GitNexus context, one parse per source file, bounded source evidence, ownership rows, and summary-only stdout.
- `scripts/stage1_coverage_gate.js` - stage-1 transition, AST, source-anchor, ownership-confirmation, graph-request, and budget gate.
- `scripts/render_stage1_report.js` - deterministic human-readable stage-1 report renderer that does not promote candidates.
- `scripts/stage1_bundle.js` - atomically generate and integrity-check stage-1 facts, summary, coverage, transition, validation, report, and manifest artifacts.
- `scripts/boundary_candidates.js` - normalize generic producer-consumer boundary candidates without project-specific paths or API names.
- `scripts/stage2_runner.js` - stage-2 facts-first orchestration over transition, AST batch, and source evidence.
- `scripts/stage2_bundle.js` - atomically generate the report, manifest, transition, findings, compressed evidence, coverage, validation, and human evidence views.
- `scripts/stage3_runner.js` - bounded consumer-repository discovery from Stage 2 boundary candidates; accepts per-consumer `scope`, limits, directory/file exclusions, and explicit symlink following. Missing consumer scopes are returned as `unverified`; direct/wrapper/event interpretation remains source-confirmation work.
- `scripts/stage4_runner.js` - generic facts-first recipient-family discovery from a Stage 3 transition; request-declared families preserve full observations and reusable Stage 5 anchors while reports may aggregate them.
- `scripts/stage5_runner.js` - generic facts-first critical-path runner from a Stage 4 transition; combines targeted source checks with `rg` exact-name coverage and emits a bounded summary when facts are retained.
- `scripts/stage5_equivalence_gate.js` - fail-closed Stage-5 comparison of coverage, full evidence anchors, and source freshness hashes.
- `scripts/stage6_runner.js` - generic facts-first reference-path runner with exact Git commit and patch fingerprints.
- `scripts/report_model.js` - normalize, canonically serialize, hash, and validate `inventory-report-model/1.0.0`.
- `scripts/stage7_runner.js` - assemble the complete canonical report model and fail closed on evidence, reference, coverage, or integrity errors.
- `scripts/stage7_equivalence_gate.js` - fail-closed Stage-7 comparison of normalized report-model evidence and transitions.
- `scripts/stage7_coverage_gate.js` - validate the complete Stage 7 report model before state advancement.
- `scripts/stage8_runner.js` - revalidate the model read-only, render three deterministic report levels, and write an output-hash manifest.
- `scripts/capability_contract.js`, `cross_stage_coverage_gate.js`, `final_report_coverage_gate.js` - feature-neutral capability contract and gates for retained evidence and final Markdown coverage.
- `scripts/stage_findings.js` - normalize AST/source facts into traceable findings and evidence records with source freshness hashes.
- `scripts/query_stage_artifacts.js` - retrieve bounded findings/evidence from a saved bundle without loading complete artifacts into model context.
- `scripts/validate_stage_bundle.js` - validate bundle files, hashes, links, transitions, and finding-to-evidence integrity.
- `scripts/measure_context.js` - measure raw and model-visible byte/token estimates without recording contents.
- `scripts/render_stage2_report.js` - render stage-2 facts deterministically without candidate promotion.
- `scripts/inventory_search.js` - grouped text/file-name search when text search is allowed.
- `scripts/validate_inventory_stage.js` - validate staged artifacts when a stage Markdown artifact exists.
- `scripts/validate_inventory_report.js` - validate full Markdown reports.
- `scripts/validate_skill.js` - validate this skill folder.

Write in Russian when the user writes in Russian. Use statuses consistently: `подтвержденное использование`, `подтверждение по эталону`, `вероятный пробел реализации`, `проверено, использования нет`, `неприменимо`, `не проверено`, `расхождение с готовой веткой`, `шум`.
