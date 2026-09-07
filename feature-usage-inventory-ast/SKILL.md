---
name: feature-usage-inventory-ast
description: 'Find and document direct and indirect feature usage with GitNexus, AST, ownership, boundary, and source evidence. Use only when the user explicitly requests feature-usage-inventory-ast; topical similarity, AST inventory, call graphs, impact analysis, cross-repository usage mapping, implementation-gap research, or a need for stronger completeness checks do not authorize automatic activation. Full inventories run as canonical schema 4.0 stages with continuous execution by default; graph and AST candidates require source confirmation.'
---

# Feature Usage Inventory AST

Runtime version: `4.1.0`; canonical artifact and state schema: `4.0.0`. Execute full inventories through `scripts/cli/src/commands/stage_pipeline.js`; treat Stage 8 as the separate digest-bound renderer.

## Essential Contract

- Do not activate or use this skill unless the user explicitly requests `feature-usage-inventory-ast`. Do not treat a request for inventory, impact analysis, call graphs, AST analysis, planning, or completeness checking as sufficient authorization by itself.
- Require explicit search roots with stable repository ids and roles. If the request and active workspace do not identify every root unambiguously, ask the user for the folders to search and their roles. Read `references/repository-scope.md`.
- Default a new full inventory to `continuous`. Prefer the `goal` driver when an explicit active goal is available; otherwise record the required `interactive` fallback. Reuse both values on continuation.
- Save automatically under `.codex/inventory-artifacts/<target-slug>-<target-and-scope-digest>/stage-N`, unless another path is explicitly selected. The pipeline checks write readiness before research; on denial select an authorized `--output-root` and record the path change.
- Declare `coverageProfile` at Stage 0 before research: task-required collections and lifecycle paths, with justified N/A where applicable. Carry it unchanged through lineage; missing required paths block Stage 7/8. See `references/report-contract.md`.
- For Stages 0–7 accept only validated `canonical-stage-result/4.0.0` handoffs. Never use raw output or Markdown as transition input; create raw artifacts only for explicit diagnostics.
- Treat graph, AST, ownership, boundary, and text results as candidates until exact source evidence and a current source SHA-256 confirm them. Empty, unresolved, stale, or AST-only results never prove absence.
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

Read `references/staged-execution.md` and initialize or advance through `scripts/cli/src/commands/stage_pipeline.js`; `inventory-state.json` is the continuation authority. Stages 0–7 produce validated canonical facts and the Stage 7 report model. Stage 8 verifies the trusted Stage 7 digest and renders read-only; it must not research, reinterpret, or repair facts.

A bounded probe may attach evidence to the current stage but cannot advance state. Complete only after Stage 8 closes and every mandatory capability is confirmed, checked absent, or explicitly non-applicable under `references/evidence-rules.md`.

## Primary Entry Points

- `scripts/index.js <command> [arguments]` — unified entry to the existing CLI commands, for example `node scripts/index.js prototype_ast --help`.
- `scripts/cli/src/commands/stage_pipeline.js` — Stage 0–7 transaction coordinator and automatic artifact path.
- `scripts/cli/src/commands/query_stage_artifacts.js` — bounded canonical evidence selectors.
- `scripts/cli/src/commands/stage8_runner.js` — digest-bound renderer.
- `scripts/cli/src/commands/diagnose.js` — read-only dependency and index readiness checks.

Write in Russian when the user writes in Russian.
