# Staged Execution

Use this file for every full inventory, skill-test request, implementation-impact inventory, branch comparison, report completeness check, and any request that says "по этапам", "по этапной модели", or "с DoD".

## Mandatory Step-By-Step Execution

- Follow the stages in order.
- Default a new full inventory to `continuous` plus `goal`. If no active goal/telemetry driver is available, record the fallback to `interactive` without asking merely for mode selection.
- Execute consecutive stages only as allowed by `references/execution-levels.md`. Never begin a later stage before the previous stage has persisted, passed its gate, and advanced successfully.
- Start at stage 0 unless the user supplies a valid artifact for a later stage.
- Persist each stage's gate, `Stage Execution Report`, and `Execution Status` internally. For the public full-run workflow, give the user the final result after Stage 8 rather than separate stage reports.
- Persist and validate `canonical/stage-result.json` schema `4.0.0`. Markdown is an optional projection and never a transition input.
- If context, tool limits, unresolved gates, or validation issues prevent reliable completion, keep the current stage partial and record exact open checks.
- For `interactive`, resume on `продолжай`, `следующий этап`, or `этап N`. For `goal`, resume automatically after verifying the objective digest. In both cases consume the current artifact and previous stage results instead of restarting discovery.
- Do not skip a stage silently. Stage 6 comparison is optional: close a canonical `skip` artifact when `stage6Decision` is `skip`; do not search for analogs or claim their absence. Other non-applicable stages retain their existing evidence and DoD rules.
- Final report generation is stage 8 work and is forbidden before that stage.
- In `adaptive` mode, a stop at a closed stage boundary is invalid unless `Execution Status` contains a concrete stop condition from `execution-levels.md`. `Safe boundary`, `context reserve`, `complex next stage`, and `conservative estimate` are not valid stop reasons.

## Transition Rules

1. Read the request and the previous transition artifact.
2. Verify that the artifact identifies the preceding stage, scope, status, evidence, open checks, and next stage.
3. Execute only the current stage's goal and DoD from the stage table.
4. Merge new facts into the accumulated state; preserve unresolved checks and candidate/evidence distinctions.
5. Emit a concrete artifact for the next stage.
6. Apply the recorded execution mode and driver: either continue with the next canonical stage, wait for the user, or yield to the active goal for automatic continuation.

If the requested stage is not the recorded next stage, explain the discontinuity. Proceed only when the missing stages are explicitly out of scope or the user accepts the resulting coverage gap.

For Stage 3 → 4, keep the full Stage 3 artifact on disk for the runner, but use a bounded selector for the model's evidence review: `node scripts/index.js query_stage_artifacts --artifact <stage-3-artifact-dir> --limit 200`. Require `status: ok`; if the selector fails, do not advance. If `truncated: true`, query narrower file/repository slices before deciding. Treat returned evidence as candidates, not confirmed recipients or proof of absence. Build the Stage 4 recipient families using these candidates, prior ownership facts, and targeted source checks for receivers not represented in the Stage 3 selection; do not infer that the selection alone covers every receiver.

For Stage 6 source-confirmed evidence, first select the repository, file, and inclusive line range on semantic grounds. When rows lack both `sourceHash` and `sourceFragment`, run `node scripts/index.js batch_source_anchors --request <stage-6-draft.json> --output <stage-6-ready.json>` before Stage 6; use the separate ready request only after `status: ok` and review of the filled rows. Stop on an error or unexpected count; the command does not select evidence or prove a claim. A standalone draft already has `stage: 6`, `repositoryScope`, and `canonicalEvidence`. For a `full_run` package, make the draft from `stages["6"]` plus `stage: 6` and the package-level `repositoryScope`, then copy only the ready `canonicalEvidence` back to `stages["6"]`; do not add runtime fields to the package template. Skip this preparation when no rows need filling.

## Execution Status Block

Use this for incomplete staged answers:

```text
Execution Status: complete|partial|blocked
mode: <strict|adaptive|continuous>
driver: <interactive|goal>
current stage: <stage/step reached>
closed: <stages, passes, and artifacts completed>
current artifact: <report/stage file or compact in-thread artifact to continue from>
open checks: <unclosed DoD, unavailable tools, stale/degraded indexes, skipped scopes, failed validators>
next step: <next stage/pass to run>
continuation: <resume command: продолжай|automatic continuation: active goal>
```

## Stage Execution Report

For skill-test requests or staged work, include:

```text
Stage Execution Report
mode: <strict|adaptive|continuous>
driver: <interactive|goal>
stages completed: <numbered stages completed in this answer; earlier stages may be listed as prior state>
stages completed this run: <ordered stage numbers; earlier stages may be listed as prior state>
stage artifacts: <report file, stage file, or in-thread artifact>
evidence collected: <key evidence grouped by stage>
skipped/forbidden sources: <source -> user-forbidden|tool-unavailable|out-of-scope|missed/deviation>
open checks: <unclosed checks, validators not run, unverified scopes>
protocol deviations: <none, or exact deviations and why>
next step: <next stage, validation, or no-op if complete>
```

## Stage Table

| Stage | Goal | Output | DoD |
|---|---|---|---|
| 0. Подготовка | Define task, scope, search profile, seed dictionary, repositories, forbidden sources | Scope, seed terms, expected layers, noise exclusions | Target entity, mode, search zones, exclusions, seed terms, expected layers, content/file-name plan are recorded |
| 1. Нижние слои и владение | Find persisted/model/container/serializer and object ownership | Ownership graph and lower-layer objects | Chain from entity to owners/containers/serialization is found or absence is evidence-backed |
| 2. Расширение словаря | Expand by second/third/N-order objects, properties, methods | Search dictionary and next search groups | Every added object has relation method/property, reason, scope, and next search |
| 3. Сценарии и старты | Find user and technical starts | Scenarios, starts, expected names | Frontend/product to core/sdk transition is shown or explicitly not applicable |
| 4. Получатели | Find recipient families and concrete receivers | Recipient matrix and blast radius | Explicit and indirect receivers are checked for get/store/apply/return/output |
| 5. Критические пути | Build end-to-end paths | Import/open/paste, user/API, state, save/export, lifecycle paths | Every path has source, state, readback/output or persistence; breaks are marked |
| 6. Эталон и ожидаемая реализация | When selected, compare with analog paths and identify expected implementation | Reference paths, gaps, expected locations; otherwise a closed skip artifact | Each selected gap has expected path/name/place/owner/form/reason/scope/status; skip has no analog claims |
| 7. Каноническая модель отчёта | Assemble, normalize, validate, and repair the complete report model | Closed `inventory-report-model/2.0.0` JSON with canonical digest | Schema, references, semantics, coverage, evidence, and determinism pass; invalid models remain at Stage 7 |
| 8. Финальная приемка и rendering | Revalidate the closed model read-only, calculate summary indicators, and render documents | Decision report, implementation map, evidence report, and manifest | Input hash is preserved, deterministic outputs are validated, and Stage 8 performs no research or repair |

## Gate Template

```markdown
### Вход
- <artifact/scope/input>

### Действия
- <tools and searches used>

### Выход
- <new facts, candidate files, evidence, gaps>

### DoD
- [x] <closed item>
- [ ] <open item with reason>

### Статус этапа
закрыт|частично|не закрыт

### Артефакт для следующего этапа
- <file link or compact in-thread artifact>

### Следующий этап
<continue according to the recorded mode, stop for interactive continuation with `продолжай`, or yield to the active goal>
```

## Canonical Transition Minimum

`canonical/stage-result.json` must carry these values in `summary.transition.fields`:

```text
target: <feature/concept/model>
scope: <repos, branches/worktrees, source/test zones, exclusions>
stage: <N and name>
status: закрыт|частично|не закрыт
confirmed evidence: <file/symbol/role summaries>
candidate evidence: <unconfirmed graph/AST candidates>
dictionary/graph/path state: <accumulated terms and relations>
skipped/forbidden: <source -> reason category>
open checks: <items carried forward>
next stage: <N+1 and name, or stage 8 completion>
```

Markdown may render these fields for people, but it must never be read by the next runner.

## Stage 7 Closure Contract

See [Workflow integrity](workflow-integrity.md) for resolution receipts, immutable question history, full lineage validation and legacy reissue requirements.

Stage 7 is the only owner of report-model construction and repair. Build the full model defined by `references/report-model.schema.json`, normalize it, validate it, and keep the canonical stage at 7 until every mandatory gate passes. Bounded probes or subagents may close a declared local evidence gap, but must return structured evidence for Stage 7; they never advance state.

The Stage 7 report model must be wrapped by canonical schema 4.0 with `stage: 7`, `status: closed`, a trusted report-model digest, and transition to Stage 8. `node scripts/cli/src/commands/stage_state.js advance --stage 7` rejects any other artifact.

## Stage 8 Read-Only Contract

Stage 8 accepts only a closed, hashed Stage 7 report model. Run model validation again without mutation, render deterministic documents, validate their structural correspondence, and write a manifest containing the input digest and output hashes. If input validation fails, mark Stage 8 `blocked`; do not research, repair, or reinterpret the model at Stage 8.

For full profiles, Stage 2–5 also preserve structural value-flow obligations. A later source-confirmed fork splits an obligation into children; branches are not collapsed merely because they share a file or receiver. Stage 5 confirms a terminal path only when its obligation is open, every ancestry edge exists and is source-confirmed, and every mapped boundary has one exact current structural match. Unresolved leaves keep the stage partial. Stage 7 accounts for terminal leaves recursively. Positive leaves become separate usages, while checked absence and architectural N/A close their leaves without creating a positive usage.
