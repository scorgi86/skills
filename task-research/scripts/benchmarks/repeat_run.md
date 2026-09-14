# Повторный диагностический запуск

Обвязка работает только с уже исследованным `research-package/1.0.0`. Она не собирает семантический вход обычного запроса и не заменяет исследование с нуля. Требуется соседний с `task-research` скил `trace-ai-actions`: используется его существующий logger.

Из каталога `C:/work/skills/task-research`:

```powershell
node scripts/benchmarks/repeat_run.js --package C:/work/skills/inventory-artifacts/internal-shadows-after-recipient-20260913/research-package.json --output-root C:/work/skills/inventory-artifacts/my-new-run --prepare-only
```

Без `--prepare-only` выполняется штатный полный Stage 0–8 coordinator. Каждый запуск требует нового output root; существующий каталог не перезаписывается. Входной package сохраняется побайтно, claims/statuses/refs не авторятся и не повышаются. SHA-256 и exact source slices проверяются заново с physical containment. Исчезнувший или устаревший anchor останавливает запуск.

Результаты: `summary.json`, `measurements.md`, `operations.jsonl`, `anchor-counts.json`, `diagnose.json`, repository snapshots. Полный запуск также сохраняет stage requests, state и стандартные canonical artifacts/Stage 8 bundle под `artifacts/`. Ошибка coordinator записывается с stage/message/stack и сравнением state до/после. Partial не исправляется автоматически; для продолжения используется существующий `full_run` с сохранёнными state и artifacts.

Exit: `0` prepared/complete, `3` partial, `2` error. Отсутствие рекомендованного GitNexus фиксируется как degraded; required dependency failure блокирует запуск.

`wallMs` начинается при вызове обвязки: это не latency от получения запроса до доставки ответа. В preparation входят read/package validation, fresh anchors, repository state и readiness. В summary stage wall включает coordinator/IO/gates/locks; runner измерен отдельно. Stage 8 — в штатном `artifacts/full-run-metrics.json`. Enclosing full-run duration не суммируется с вложенными stages. Token usage недоступен без provider telemetry; байты не считаются токенами.

Обвязка исключает ручное копирование harness между диагностическими прогонами. Одно измерение не доказывает ускорение обычного исследовательского запроса и не является чистым A/B прежнего запуска.
