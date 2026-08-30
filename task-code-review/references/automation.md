# Автоматизированный fast path

Использовать этот reference только когда доступны Node и `scripts/review-tools.js`. CLI выполняет структурные проверки; он не подтверждает remote freshness, repository identity, истинность evidence, полноту исследования или verdict.

## Команды

```text
node scripts/review-tools.js snapshot --input <json-file|->
node scripts/review-tools.js validate-packet --input <json-file|->
node scripts/review-tools.js validate-handoff --input <json-file|->
```

stdout содержит один JSON object. Exit codes: `0` — успех, `2` — невалидный вход, `3` — snapshot нельзя воспроизвести локально, `4` — ошибка CLI/Git.

`snapshot` принимает repository path, полные base/head/merge-base/diff SHA и `diff_semantics=merge-base-to-head`; возвращает проверенные boundaries и отсортированный `changed_files`. Он не выполняет fetch и не проверяет remote.

`validate-packet` принимает полный delegated packet. Packet с непустым `materialized_diff` не поддерживается fast path и проверяется по ручному контракту.

`validate-handoff` принимает `{packet, handoff}` и проверяет их структурную согласованность и вычисляемый `scope_status`. Смысл findings и evidence всегда проверяет координатор.

## Использование результата

После успешной команды не повторять вручную входящие в неё структурные проверки без конкретного противоречия с новым исходным доказательством. Ошибка команды не означает успешный gate.

Если Node или CLI недоступны до fast path, выполнить текущий ручной workflow. После запуска CLI устранить его ошибку либо зафиксировать blocker/ограничение по правилам выбранного режима; не скрывать ошибку автоматическим fallback.

Координатор ведёт единое внутреннее состояние sources, repositories, requirements, changed files, evidence, findings и limitations. Сначала маршрутизирует requirements и изменения, затем исследует применимые риски. Делегировать только независимый срез, когда параллельность или изоляция контекста окупает packet/handoff.

Consumer search начинать с непосредственных definitions, callers и tests. Расширять его при изменении публичного или межрепозиторного контракта либо когда consumer передаёт поведение дальше. Одинаковый отрицательный search scope выполнять один раз и связывать со всеми применимыми Requirement IDs.

Полное evidence записывать один раз в requirement status или finding. Итоговый отчёт формировать после закрытия requirements, changed files и handoffs.
