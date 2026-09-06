# Report Contract

Use this file for report creation, final acceptance, staged artifact validation, and complete inventory answers.

Use `references/inventory-report-template.md` for full inventory reports. Do not invent a shorter final report unless the user explicitly asks for a brief answer.

The canonical source of every final document is the Stage 7 `inventory-report-model/2.0.0` JSON. Markdown is a deterministic projection, not a planning source of truth. Never add facts, statuses, rows, or recommendations during rendering.

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
