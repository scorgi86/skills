# Internal shadows A/B benchmark checkpoint

Зафиксировано: 2026-09-09. Работа остановлена по запросу пользователя до запуска нового A/B.

## Цель

Собрать все реализованные оптимизации `task-research`, измерить состояние до и после них на запросе «Исследуй все о внутренних тенях» и зафиксировать воспроизводимую методологию оценки и тестирования.

## Выбранные точки

- Baseline A: `16ced79` — исходное состояние навыка до серии оптимизационных коммитов.
- Current B: `ec3e8a6` — зафиксированное текущее состояние реализации.
- `5211e47` содержит только результаты предыдущего gradient AST benchmark и не меняет реализацию.

Коммиты серии между A и B:

1. `d6fe138` — реорганизация runtime и исправление файлового AST-кеша.
2. `ef483aa` — усиление staged evidence workflow.
3. `07f56ec` — централизованное транзакционное состояние.
4. `ee9a3f3` — единый transactional StageContext.
5. `ec3e8a6` — переименование в `task-research`, актуальные runtime-оптимизации и тесты.

## Установленный факт о прежних 29,28%

Число `29,28%` в `optimization-directions.md` относится к промежуточному benchmark Stage 1+2 (`16024 → 11333 мс`). Его временная baseline-копия runtime и `implementationDigest` не сохранены в Git. Поэтому результат исторически полезен, но не воспроизводим как строгий A/B и не должен смешиваться с новым сравнением крайних коммитов.

Старый полный inventory benchmark находится в:

- `C:\work\R7\projects\context\inventories\benchmark-shadows-20260730-summary.md`
- `C:\work\R7\projects\context\inventories\benchmark-shadows-20260730-metrics.json`
- `C:\work\R7\projects\context\inventories\optimization-old-instrumented-20260730`

## Подготовлено

- Baseline A извлечён без изменения Git в `C:\work\skills\.all-opt-before-runtime\feature-usage-inventory-ast`.
- Проверено наличие старого `scripts/ast/batch.js`.
- Новые измерения ещё не запускались.
- Временную baseline-копию пока не удалять: она нужна для продолжения.

## Следующие действия

1. Зафиксировать общий неизменяемый workload внутренних теней из сохранённых Stage 1/2 request.
2. Создать воспроизводимый A/B harness, который поддерживает старый плоский и текущий структурированный runtime.
3. Выполнить один прогрев и две независимые серии минимум по пять чередующихся A/B-прогонов.
4. На каждый образец создавать новый cache-каталог и передавать его из Stage 1 в Stage 2.
5. Проверить равенство request digests, repository HEAD/worktree digests, окружения, AST semantic digests, cache hit/miss и состава файлов.
6. Отдельно измерить Stage 1 AST, Stage 2 AST и их сумму. Не выдавать исторический end-to-end результат за строгий A/B при несовместимых pipeline-схемах.
7. Сохранить workload, сырые серии, агрегированное сравнение, перечень оптимизаций и методологию.
8. После завершения удалить `C:\work\skills\.all-opt-before-runtime` и прочие временные файлы.
