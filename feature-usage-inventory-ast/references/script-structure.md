# Физическая структура скриптов

Runtime разделён по ответственности. Общий вход — `scripts/index.js`; реализация CLI находится в `scripts/cli/src`. Алгоритмы, схемы и порядок этапов сохранены.

## Входы и CLI

```text
scripts/index.js
scripts/cli/index.js
scripts/cli/src/dispatch.js
scripts/cli/src/commands/<command>.js
scripts/cli/tests/
```

Диспетчер выбирает одну из 37 существующих команд. Файлы commands содержат обработчики, а не оболочки над прежними runCli. Их импорт не запускает команду. Прямой запуск нового файла команды поддерживается. Прежний каталог cli/commands удалён без совместимости.

```text
node scripts/index.js prototype_ast --help
node scripts/index.js stage_pipeline --request request.json --state inventory-state.json
node scripts/index.js stage8_runner --model report-model.json --output-dir stage-8 --state inventory-state.json
```

CLI обрабатывает запуск и вывод; предметная логика остаётся в подсистемах. Публичные функции main/parseArgs, используемые программно, сохраняются в своих API: например, state.main(argv) управляет состоянием и вызывается pipeline. Core не импортирует CLI.

## Внутренние блоки

Каждая подсистема имеет публичный index.js, реализации в src и тесты в tests. Внутренние папки группируют связные обязанности и не получают обязательных дополнительных index.js.

| Подсистема | Блоки внутри src |
|---|---|
| shared/ast | parsing — parser/walker; analysis — файлы, анализ, символы, связи, evidence; cache — идентичность и проверяемое файловое хранение; query — запросы и цепочки; output — идентификация, группировка, проекция и политика; batch — пакетный анализ |
| shared/evidence | collection — координатор, проверки, обход, группировка и выбор; canonicalization — адаптеры, идентификация, подтверждение и канонизация кандидатов |
| shared/output | stage_facts — facts; summary — сборка, проекция, бюджет и compaction; остальные инструменты сохраняют собственные реализации |
| shared/artifacts | canonical — facts, result, validation, checks, lineage и receipt_evidence; хранение и запросы артефактов отдельно |
| shared/report | model — строки и контракт, нормализация, сериализация, проверки, проекции; markdown — parser, requirements, validate_report и rules; bundle — состав и проверка документов |
| state | state_model, persistence, stage_state; file_transaction — атомарная запись и блокировка; artifacts — проверки canonical и Stage 8; goal_contract отдельно |
| steps/step-0 | execution_scope — согласование входов и параметры поиска; runner — поиск по репозиториям и подготовка результата |
| steps/step-1 | context — GitNexus и ownership; summary; runner и существующие gate/render |
| steps/step-8 | rendering — Markdown-функции и три документа; runner — проверка входа и сохранение |
| flows/full-flow | stage_pipeline — один запрошенный этап 0–7 за вызов, Stage 0 execution-scope preflight; transaction — prepare/archive/publish/advance и проверка кандидата перед публикацией/восстановлением |
| shared/dto, ownership, diagnostics, search; остальные steps | Существующие обязанности сохранены; CLI-выполнение вынесено в команды |

Индексы общих подсистем сохраняют именованные ленивые API. Для разбитых реализаций индекс собирает стабильный объект из выделенных функций. Индексы state и steps сохраняют прежние функции основного API. Внутренние файлы импортируют конкретные зависимости напрямую, без обращения через собственный индекс. У shared/search нет пустого индекса: его внутренние операции вызываются обработчиками поиска.

Stage 7 возвращает модель с digest без последующего изменения. Stage 8 остаётся отдельным запуском. Имя full-flow не означает автоматическое выполнение всех этапов. Кэши source evidence принадлежат одному запросу; форматы digest canonical result и report model остаются разными.

References, schemas и fixtures находятся на прежних местах. Перенос сохраняет базы разрешения ресурсов и относительных пользовательских путей, включая cwd там, где он использовался.

## Тесты и карты миграции

`npm test` запускает `scripts/tests/all.test.js` с прежним режимом изоляции. Перенесённые наборы подключены один раз в исходном порядке; новые контрактные проверки добавлены после них. Сквозные тесты остаются на уровне подсистемы, профильные — в соответствующих логических папках.

- [Текущая карта разбивки](script-split-layout.json) перечисляет новые пути, экспортируемые функции и команды.
- [Историческая карта переноса](script-layout.json) сохраняет предыдущую миграцию целых файлов. Её пути описывают состояние до текущей разбивки и не являются реестром запуска.

Старые scripts/*.js и scripts/ast/*.js из исторической карты не восстанавливаются. Единственный файл в корне scripts — index.js.
