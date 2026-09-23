---
name: task-research
description: 'Research direct and indirect feature usage with GitNexus, AST, ownership, boundary, and source evidence. Use only when the user explicitly requests task-research; topical similarity, AST inventory, call graphs, impact analysis, cross-repository usage mapping, implementation-gap research, or a need for stronger completeness checks do not authorize automatic activation. Full research runs as canonical schema 4.0 stages with continuous execution by default; graph and AST candidates require source confirmation.'
---

# Task Research

Runtime version: `4.1.0`; canonical artifact and state schema: `4.0.0`. Accept one research request and execute the prepared inventory through `node scripts/index.js full_run`. Return the final result after Stage 8, or the current canonical artifact and exact open checks when a partial gate stops the run. Stage artifacts and gates remain internal; use `stage_pipeline` when an individual stage must be inspected or reissued.

## Essential Contract

- Do not activate or use this skill unless the user explicitly requests `task-research`. Do not treat a request for inventory, impact analysis, call graphs, AST analysis, planning, or completeness checking as sufficient authorization by itself.
- Require explicit search roots with stable repository ids and roles. If the request and active workspace do not identify every root unambiguously, ask the user for the folders to search and their roles. Read `references/repository-scope.md`.
- Default a new full inventory to `continuous`. Prefer the `goal` driver when an explicit active goal is available; otherwise record the required `interactive` fallback. Reuse both values on continuation.
- Decide whether Stage 6 reference comparison is needed before Stage 0. Set `stages["0"].stage6Decision` to `run` when the user explicitly asks for an analog, comparison, or Stage 6, or when the request's intended result requires deriving expected implementation or gaps by comparison with an existing route. Otherwise set it to `skip`. An explicit instruction not to compare overrides inferred intent; ask about conflicting direct instructions. Do not turn a later incidental similarity into a Stage 6 trigger. Keep the decision on continuation.
- Save automatically under `.codex/inventory-artifacts/<target-slug>-<target-and-scope-digest>/stage-N`, unless another path is explicitly selected. The pipeline checks write readiness before research; on denial select an authorized `--output-root` and record the path change.
- Declare `coverageProfile.kind` before a new Stage 0: `full-inventory` for complete usage research, `full-development` for preparing a change, or `bounded` for an explicitly limited investigation. Full kinds require all 13 capability IDs plus scenarios and critical paths; development also requires gaps and implementation entry points. Never select `bounded` just because evidence is missing. Express N/A with `reasonCode` and `explanation`; source absence requires checked-no-usage. Carry the profile unchanged; existing no-kind runs resume without retroactive additions. See `references/report-contract.md`.
- For Stages 0–7 accept only validated `canonical-stage-result/4.0.0` handoffs. Never use raw output or Markdown as transition input; create raw artifacts only for explicit diagnostics.
- Stage 1 can derive its discovery search from all Stage 0 seeds only with the explicit `searchFromStage0` package option. With empty ownership input it may also bootstrap ownership from one exact class/function declaration: set optional `ownership.bootstrapSeed` to one nonempty Stage 0 seed, or omit it to preserve selection across all Stage 0 seeds. Follow `references/full-run-package.md` for validation and stopping conditions.
- Treat graph, AST, ownership, boundary, and text results as candidates until exact source evidence and a current source SHA-256 confirm them. Stage 1 may apply that confirmation automatically only to an exact `field-write` or `collection-*` ownership occurrence with `ownerConfidence: "exact"`, a current full source fragment, and a file physically inside its declared repository; empty, unresolved, stale, or AST-only results never prove absence.
- Apply only request- or scope-declared exclusions, aliases, and layer rules; preserve distinct semantic roles during canonicalization.
- Execute every stage transactionally and advance only a persisted, validated, closed result. Keep full evidence on disk and load only bounded summaries or selectors into model context.
- Record token usage only from provider telemetry; otherwise use `usage.status: unavailable` and keep token, transport, and artifact measures separate.

## Routing

Read only the references needed for the current operation.

| Request | Read |
|---|---|
| Scope, roots, aliases, exclusions, layers | `references/repository-scope.md` |
| Execution mode, goal continuation, state | `references/execution-levels.md`, `references/goal-execution.md`, `references/staged-execution.md` |
| Stage 1 ownership and lower layers | `references/stage-1-contract.md`, `references/ownership-depth.md` |
| Stage 2 AST/source expansion | `references/stage-2-contract.md`, `references/stage-runtime-contract.md` |
| Canonical layout, usage telemetry, raw policy | `references/stage-artifact-bundle.md` |
| GitNexus candidates | `references/gitnexus-workflow.md`, `references/evidence-rules.md` |
| Local AST queries | `references/ast-workflow.md`, `references/evidence-rules.md` |
| Recipients, paths, paired mechanisms | `references/recipient-fanout.md`, `references/critical-paths.md`, `references/paired-mechanisms.md` as applicable |
| Stage 7/8 report construction | `references/report-contract.md`, `references/report-model.schema.json`, `references/inventory-report-template.md` |
| Planning implementation work from inventory facts | `references/planning-contract.md`, `references/report-contract.md` |
| Discussing or planning improvements to this skill itself | [Optimization directions](references/optimization-directions.md) — proposed roadmap, not runtime requirements |
| Navigating script modules, entry points and tests | [Script structure](references/script-structure.md) |

## Choose Execution Depth

Use a targeted workflow for a bounded question about one symbol, file set, caller/callee set, trace, or impact edge. Record the target and scope, run the smallest relevant operation, confirm important candidates at exact source locations, and return evidence, limitations, and unknowns.

Use the full Stage 0–8 workflow for requests such as “find all”, inventory, implementation impact, branch comparison, report completeness, multiple recipient families, or any result whose completeness cannot be demonstrated by a bounded pass.

Do not escalate solely because candidates occur in multiple directories. Escalate when the requested completeness requires ownership expansion, cross-repository boundaries, recipient families, scenario paths, or checked absence.

## Full Inventory

Read `references/staged-execution.md`; for a prepared Stage 0–7 request package also read `references/full-run-package.md`. `inventory-state.json` is the continuation authority. Stages 0–7 produce validated canonical facts and the Stage 7 report model. Stage 8 verifies the trusted Stage 7 digest and renders read-only; it must not research, reinterpret, or repair facts.

A bounded probe may attach evidence to the current stage but cannot advance state. Complete only after Stage 8 closes and every mandatory capability is confirmed, checked absent, or explicitly non-applicable under `references/evidence-rules.md`.

For the public full-run workflow, report one final research result after Stage 8 rather than publishing a stage report after every gate. Brief progress updates and exact blocker questions may still be necessary. Existing low-level stage commands and their `strict`/`adaptive` modes retain their contracts.

## Primary Entry Points

- `scripts/index.js <command> [arguments]` — unified entry to the existing CLI commands, for example `node scripts/index.js prototype_ast --help`.
- `scripts/index.js full_run --package <research-package.json> --state <inventory-state.json> --output-root <directory>` — continuous Stage 0–8 execution and continuation.
- `scripts/cli/src/commands/stage_pipeline.js` — Stage 0–7 transaction coordinator and automatic artifact path.
- `scripts/index.js preflight_stage_request --request <json> [--state <json>] [--output-root <directory>]` — read-only early request check. `ok` is not stage closure; `deferred` leaves an existing pending transaction to the pipeline's recovery path.
- `scripts/index.js batch_source_anchors --request <stage-6-draft.json> --output <stage-6-ready.json>` — fill missing source hash and exact fragment for selected Stage 6 evidence ranges; review the separate ready request before running the stage.
- `scripts/cli/src/commands/query_stage_artifacts.js` — bounded canonical evidence selectors.
- `scripts/cli/src/commands/stage8_runner.js` — digest-bound renderer.
- `scripts/cli/src/commands/diagnose.js` — read-only dependency and index readiness checks.

Write in Russian when the user writes in Russian.
