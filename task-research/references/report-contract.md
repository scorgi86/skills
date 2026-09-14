# Report Contract

## Declared coverage and result meaning

New Stage 0 requests require an explicit `coverageProfile.kind`, selected from the user's research goal before searching. `full-inventory` and `full-development` require every existing capability ID and the scenarios and criticalPaths collections; `full-development` additionally requires gaps and implementationEntryPoints. `bounded` preserves explicitly limited investigations with a smaller profile; missing evidence does not justify downgrading a full request to bounded. Full inventory example:

```json
{"kind":"full-inventory","requiredCapabilities":["definition","ownership","storage","serialization","input","mutation","recipients","readback","render-output","lifecycle","theme-style","tests","reference"],"requiredCollections":["scenarios","criticalPaths"],"requiredCriticalPaths":["save","undo"],"notApplicable":{},"notApplicableCriticalPaths":{"undo":{"reasonCode":"architecture","explanation":"The declared operation has no history contract"}}}
```

New Stage 0 requests must declare at least one `requiredCapabilities` id. Stage 7 derives `requiredForFinalReport` from that list, so later requests cannot weaken the declared obligation. A required capability closes only as source-backed `confirmed`, complete `checked-no-usage`, or justified `not-applicable`. New profiles express N/A as `reasonCode` (`task-scope`, `repository-scope`, or `architecture`) plus a non-empty `explanation`; source absence must use `checked-no-usage`. Legacy artifacts without `requiredCapabilities` retain their existing `requiredForFinalReport` and string-reason semantics.

`requiredCriticalPaths` match `criticalPaths[].coverageKey` or exact row ID. N/A reasons must identify declared obligations. Required scenarios, critical paths, gaps and implementation entry points must contain explanatory text or concrete steps/locations; IDs, statuses and references alone do not establish semantic completeness. When both gaps and implementation entry points are required, every `implementation-gap` and `test-gap` must be linked from an implementation entry point. A bounded investigation can declare fewer requirements; every table is not universally mandatory. Stage 0 stores the normalized profile in `summary.coverageProfile`; Stage 7 retains it as `coverage.profile`. Changing requirements requires a new run. Legacy artifacts without a profile remain readable but cannot gain a new profile midway.

For full kinds, each confirmed scenario requires non-empty `entry`, a non-empty array of non-empty string `steps`, and non-empty `result`. A checked-no-usage scenario describes its expected entry and steps and the checked break in result, and still needs the complete absence protocol. A not-applicable scenario uses structured reasonCode and explanation. These fields are displayed in implementation-map.md; a name alone is insufficient. Bounded and saved no-kind models retain their previous content rules.

Profile shape loading and new-run enforcement are separate: saved no-kind Stage 0–7 artifacts can continue and finalize through full_run without changing their profile. Only a new Stage 0 requires kind; changing an existing profile requires new state and output paths.

Evidence strength, research coverage and product decisions are separate. Complete research can confirm a product gap. `coverage.status: partial` and truncated selection cannot close Stage 7; an explicit `decisionStatus: confirmed` does not bypass coverage. Known intermediate proof statuses map conservatively; product categories remain `category` with `originalStatus`, and unsupported statuses report an error. Rendered candidate rows have neutral labels; source links, semantic fields, provenance and conflicts survive projection.

Public direct `stage7_runner --request request.json --output model.json` reads an ordinary Stage 7 request; it does not publish a stage transaction. Use `stage_pipeline` for publication. `stage7_coverage_gate --facts` accepts either a report model or a canonical Stage 7 wrapper and selects its `report-model` fact by kind.

Use this file for report creation, final acceptance, staged artifact validation, and complete inventory answers.

Use `references/inventory-report-template.md` for full inventory reports. Do not invent a shorter final report unless the user explicitly asks for a brief answer.

The canonical source of every final document is the Stage 7 `inventory-report-model/2.0.0` JSON. Markdown is a deterministic projection, not a planning source of truth. Never add facts, statuses, rows, or recommendations during rendering.

For full inventory, persist container operations, concrete receiver bindings and protocol results in the existing typed Stage 1–6 collections before their dependent stages close. State the actual result, not just IDs and anchors: distinguish copy/merge/clear semantics, defaults/units/null versus undefined, shared routes and concrete limitations. If evidence was missed in a closed stage, use the existing revision flow; do not repair completeness by adding report prose at Stage 7/8.

Plan search scope/exclusions and relevant language surfaces before broad discovery. Preserve actual nameCoverage `query.fileArgs/matchArgs` and targeted JS `sourceEvidence.checks[].spec` with completeness, errors and skipped-file results. These mechanisms use different supported syntax. If canonical projection omits required execution metadata, retain the existing raw runner output; do not reconstruct success from request parameters. A JS-only check cannot establish non-JS absence.

For implementation planning, Stage 7 must project typed facts from Stages 1–6 according to `references/planning-contract.md`. Do not rebuild planning collections from memory or free-form Markdown.

Produce exactly three linked detail levels from the same model: `decision-report.md`, `implementation-map.md`, and `evidence.md`. The strict bundle validator treats them as one report: a missing, extra, empty, or cross-reference-incomplete document fails Stage 8. Stage 8 writes manifest schema `2.0.0` with the trusted Stage 7 digest, `validation.strictBundle: passed`, and the exact three unique safe relative output paths with their full-file SHA-256 values.

## Tables

Before every required table include:

```markdown
Что показывает: ...
Зачем нужна: ...
Как читать: ...
Как использовать: ...
```

A table is incomplete without this explanation block.

## Evidence Rows

Each evidence row must include:

- concrete file, symbol, property, method, or search scope;
- role in ownership graph or critical path;
- what was checked;
- result;
- status;
- consequence: what the row closes, opens, or leaves unverified.

Do not use vague rows such as `проверено в репозитории`, `получатель не найден`, `вывод отсутствует`, or `нет использования` without expected names, scope, and evidence.

## Existing Entry Points For Implementation

For implementation or gap-analysis tasks, add `Существующие Точки Входа Для Доработки` after `Где Ожидалась Реализация Пробелов`.

Include only existing entry points: file, object, method, property, command, API, recipient, rendering path, persistence path, test, or exact search scope. If a point is missing, state the checked scope and expected names instead of inventing a new file.

## Validation

Before rendering, validate the canonical model:

```bash
node scripts/cli/src/commands/stage7_coverage_gate.js --facts <report-model.json>
```

Render and create the manifest only at Stage 8:

```bash
node scripts/cli/src/commands/stage8_runner.js --model <report-model.json> --output-dir <report-directory> --state <inventory-state.json>
```

For isolated reproducibility tests, `--expected-digest <sha256>` may replace `--state`. Normal Stage 8 execution must use the digest recorded by `stage_state.js` when Stage 7 closed; the model's self-declared digest is not a trusted closure record.

`stage8_runner.js` invokes the shared bundle validator in strict mode before it writes a closed manifest. The legacy single-Markdown validator remains available only for pre-v4 template reports; it cannot close Stage 8.

Advance state with the generated `manifest.json`. `stage_state.js` rechecks its schema, strict gate, trusted input digest, exact output set, safe sibling paths, file existence, and current SHA-256 values. A copied, incomplete, stale, duplicate, or path-traversing manifest cannot advance Stage 8.

If validation fails and cannot be fixed in the current answer, mark the report incomplete and list validation errors.

## Final Gate

Before a final report, check:

- all applicable stages and DoD are closed or explicitly open;
- required sections and tables are present;
- every confirmation has concrete evidence;
- every checked absence has expected names and scope;
- noise is separated from source evidence;
- graph/AST limitations are recorded;
- validators ran or a reason for not running is recorded;
- token-control deviations are reported.
