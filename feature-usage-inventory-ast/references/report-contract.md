# Report Contract

Use this file for report creation, final acceptance, staged artifact validation, and complete inventory answers.

## Compatibility

The report contract follows `feature-usage-inventory` and the local `references/inventory-report-template.md`. Do not invent a shorter final report for full inventory unless the user explicitly asks for a brief answer.

The canonical source of every final document is the Stage 7 `inventory-report-model/1.0.0` JSON defined by `references/report-model.schema.json`. Markdown is a deterministic projection, not a planning source of truth. Never add facts, statuses, rows, or recommendations during rendering.

Produce three linked detail levels from the same model: a decision report for the general picture, an implementation map for recipients and critical paths, and an evidence report for source anchors and checked absences. Stage 8 writes `manifest.json` with the canonical input digest and every output hash.

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

Do not use vague rows such as `проверено в sdkjs`, `UI не найден`, `render отсутствует`, or `нет использования` without expected names, scope, and evidence.

## Existing Entry Points For Implementation

For implementation or gap-analysis tasks, add `Существующие Точки Входа Для Доработки` after `Где Ожидалась Реализация Пробелов`.

Include only existing entry points: file, object, method, property, command, API, recipient, rendering path, persistence path, test, or exact search scope. If a point is missing, state the checked scope and expected names instead of inventing a new file.

## Validation

Before rendering, validate the canonical model:

```bash
node scripts/stage7_coverage_gate.js --facts <report-model.json>
```

Render and create the manifest only at Stage 8:

```bash
node scripts/stage8_runner.js --model <report-model.json> --output-dir <report-directory> --state <inventory-state.json>
```

For isolated reproducibility tests, `--expected-digest <sha256>` may replace `--state`. Normal Stage 8 execution must use the digest recorded by `stage_state.js` when Stage 7 closed; the model's self-declared digest is not a trusted closure record.

For a staged artifact:

```bash
node scripts/validate_inventory_stage.js <artifact.md> --stage N
```

For a full report:

```bash
node scripts/validate_inventory_report.js <report.md>
```

For strict review, implementation planning, or branch comparison:

```bash
node scripts/validate_inventory_report.js <report.md> --strict
```

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
