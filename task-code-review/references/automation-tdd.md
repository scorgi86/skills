# План MVP-автоматизации task-code-review

Статус: план реализации, не активный контракт навыка.

## 1. Цель

Ускорить наиболее повторяемые части ревью, не меняя ответственность режимов:

- coordinator-review отвечает за полный scope и глобальный verdict;
- delegated-review проверяет только переданный packet и возвращает compact handoff;
- скрипты проверяют Git snapshot и структурную целостность данных;
- ИИ извлекает требования, исследует поведение, оценивает доказательства и формирует findings.

MVP считается полезным, если он сокращает ручные Git-команды и повторную проверку ссылок packet/handoff. Он не обязан решать все возможные проблемы переносимости и долгосрочного версионирования.

## 2. Что входит в MVP

Один dependency-free Node CLI `scripts/review-tools.js` с тремя командами:

1. `snapshot` — проверить заданные immutable Git boundaries и вернуть список изменённых файлов.
2. `validate-packet` — проверить обязательные поля и внутренние ссылки delegated packet.
3. `validate-handoff` — проверить handoff относительно полного исходного packet.

CLI не выполняет fetch, remote query, checkout, изменение файлов, запуск тестов, запуск агентов, семантический поиск или вынесение verdict.

## 3. Что сознательно отложено

До появления подтверждённой потребности не реализовывать:

- отдельные пространства версий CLI, документов и digest;
- миграции контрактов;
- RFC 8785/JCS и packet digest;
- бинарный tree-delta format и tree digest;
- base64-представление non-UTF-8 Git paths;
- materialized diff artifacts;
- work graph, state machine и coordinator merge record;
- автоматическую оркестрацию и cache;
- JSON Schema framework и запрет всех unknown fields;
- формальный performance harness и трассировку AI token/tool calls;
- rename detection;
- поддержку symbolic refs во входе.

Эти решения возвращаются в план только после наблюдаемого сбоя MVP или измеримого узкого места.

## 4. Совместимость и активация

MVP автоматизирует текущие поля `coordinator-review.md` и `delegated-review.md`. Новый обязательный пользовательский формат до активации не вводится.

До завершения реализации действует текущий ручной workflow. Скрипты становятся рекомендуемым fast path только после unit/integration tests и независимых пользовательских сценариев. При отсутствии Node или CLI координатор использует существующий ручной workflow.

Fast path не заменяет действующую локальную проверку repository identity: координатор и делегат по-прежнему проверяют соответствие локального repository переданной identity ручным способом. Перед семантическим исследованием делегат повторно вызывает `snapshot` для boundaries каждого repository packet либо выполняет эквивалентную ручную проверку объектов и diff.

Packet с непустым `materialized_diff` не поддерживается MVP. Это известное поле запрещено игнорировать: такой packet переводится на полный ручной workflow на preflight до вызова `validate-packet`. Остальные неизвестные поля валидатор может игнорировать.

Ошибка запущенного CLI не считается успешной проверкой. Координатор либо устраняет причину, либо явно фиксирует ограничение/блокировку по действующим правилам режима.

## 5. Структура реализации

```text
task-code-review/
|-- scripts/
|   |-- review-tools.js
|   |-- lib/
|   |   |-- result.js
|   |   |-- git.js
|   |   `-- validate.js
|   `-- test/
|       |-- unit/
|       |-- integration/
|       `-- scenarios/
`-- references/
    |-- automation.md
    `-- automation-tdd.md
```

Не создавать отдельный модуль, пока логика не используется более чем одной командой или не требует изолированного тестирования.

## 6. Общий интерфейс CLI

Вызов:

```text
node scripts/review-tools.js <command> --input <json-file>
```

Дополнительно поддержать `--input -` для stdin. stdout содержит один JSON object. Диагностика выполнения направляется в stderr.

Успех:

```json
{"ok":true,"command":"snapshot","result":{}}
```

Ошибка входных данных:

```json
{
  "ok":false,
  "command":"validate-packet",
  "errors":[{"code":"missing_field","path":"requirements","message":"requirements is required"}]
}
```

Exit codes:

- `0` — команда выполнена;
- `2` — невалидный JSON или входная структура;
- `3` — Git snapshot невозможно воспроизвести;
- `4` — CLI или Git не смогли корректно выполниться.

Не вводить protocol version в MVP. Поле `command` и формы результатов покрываются regression tests; несовместимое изменение требует явного обновления тестов и runtime reference.

## 7. Примитивы

### 7.1 JSON

Использовать стандартный `JSON.parse`. Вход обязан быть UTF-8 JSON object. Проверять только поля, необходимые команде; неизвестные поля сохранять без интерпретации или игнорировать.

Malformed JSON возвращает exit 2, `malformed_json`. Специальный parser для duplicate keys не реализовывать.

### 7.2 Идентификаторы

`assignment_id`, `repository_id`, Requirement IDs и scope IDs — непустые строки. Сравнение выполняется стандартным exact string equality. Проверять уникальность только там, где её требует текущий delegated contract.

Не вводить Unicode normalization до появления реального несовместимого примера.

### 7.3 Пути

Сохранять текущий формат string path с `/` как Git separator. Отклонять:

- пустой path;
- NUL;
- leading `/`;
- Windows drive/UNC path;
- segments `.` и `..`.

MVP поддерживает только paths, которые Git-команда и Node успешно декодировали как UTF-8. При обнаружении non-UTF-8 path команда `snapshot` завершается exit 3 `unsupported_path_encoding`; она не искажает и не пропускает файл.

### 7.4 Immutable OID

Принимать только full lowercase hexadecimal OID длиной 40 или 64 символа. Для каждого boundary выполнить `git cat-file -e <oid>^{commit}`. Не принимать branch names, tags и сокращённые SHA.

## 8. Безопасный Git runner

Запускать Git через `execFile`, без shell, из явно переданного repository path.

Обязательные ограничения:

- `GIT_NO_REPLACE_OBJECTS=1`;
- отключённый pager и interactive prompt;
- не использовать hooks, external diff и textconv;
- не выполнять fetch или remote query;
- не изменять index, working tree, refs или config;
- не смешивать непроверенные OID и pathspec в одном argv.

MVP использует:

```text
git cat-file -e <oid>^{commit}
git diff-tree -r --name-status -z --no-renames --no-commit-id <diff_from_sha> <diff_to_sha>
```

Разбирать только NUL-delimited output. Поддержать статусы `A`, `M`, `D`, `T`. Неожиданный статус возвращает exit 3 `unsupported_diff_status`.

## 9. Команда snapshot

Вход:

```json
{
  "repository_id":"sdkjs",
  "repository_path":"C:\\work\\sdkjs",
  "base_sha":"<full-oid>",
  "head_sha":"<full-oid>",
  "merge_base_sha":"<full-oid>",
  "diff_from_sha":"<full-oid>",
  "diff_to_sha":"<full-oid>",
  "diff_semantics":"merge-base-to-head"
}
```

Все поля обязательны. Для `merge-base-to-head` потребовать `diff_from_sha == merge_base_sha` и `diff_to_sha == head_sha`. `repository_path` используется только локально и не попадает в результат.

Результат:

```json
{
  "repository_id":"sdkjs",
  "base_sha":"<full-oid>",
  "head_sha":"<full-oid>",
  "merge_base_sha":"<full-oid>",
  "diff_from_sha":"<full-oid>",
  "diff_to_sha":"<full-oid>",
  "diff_semantics":"merge-base-to-head",
  "changed_files":[
    {"repository_id":"sdkjs","path":"src/a.js","status":"M"}
  ]
}
```

`changed_files` сортируется по path стандартным byte order Buffer comparison после UTF-8 encoding. Duplicate path в output считается ошибкой `duplicate_changed_file`.

CLI подтверждает только наличие локальных commit objects и построенный между ними список изменений. Он не подтверждает remote freshness или правильность выбора boundaries координатором.

## 10. Команда validate-packet

Вход — полный packet текущего delegated contract.

Проверить:

- непустой `assignment_id`; уникальность между несколькими assignments проверяет координатор, потому что команда видит только один packet;
- непустые repositories с уникальными `repository_id`;
- обязательные SHA и `diff_semantics` каждого repository;
- непустые requirements с уникальными IDs, criterion и `source_ref`;
- наличие хотя бы одного элемента в `changed_files`, `inspection_scope` или `absence_search_scope`;
- уникальность scope IDs и exact `file_ref`;
- существование `repository_id` во всех repository-qualified refs;
- существование Requirement IDs во всех структурах, где они используются;
- permissions и hard exclusions как обязательные arrays/objects текущего контракта.

Не проверять Git, содержательность criterion, полноту scope или достаточность требований.

### 10.1 Минимальные формы packet

В таблицах `R` — required, `O` — optional. Unknown fields игнорируются, кроме известного неподдерживаемого `materialized_diff`.

| Объект | Поля |
|---|---|
| packet | `assignment_id:string R`, `repositories:repository[1..n] R`, `requirements:requirement[1..n] R`, `changed_files:file_ref[] R`, `inspection_scope:inspection_scope_ref[] R`, `absence_search_scope:search_scope_ref[] R`, `semantic_scope:array R`, `hard_exclusions:array R`, `permissions:object R` |
| repository | `repository_id:string R`, `path:string R`, `canonical_remote:string R`, `base_sha:string R`, `head_sha:string R`, `merge_base_sha:string R`, `diff_from_sha:string R`, `diff_to_sha:string R`, `diff_semantics:string R` |
| requirement | `id:string R`, `criterion:string R`, `constraints:array R`, `source_ref:source_ref R` |
| file_ref | `repository_id:string R`, `path:string R` |
| code_ref | `repository_id:string R`, `path:string R`, `start_line:positive integer O`, `end_line:positive integer O`, `symbol:string O`; один `start_line` означает одну строку, `end_line` без `start_line` запрещён, при наличии обеих границ `start_line <= end_line` |
| inspection_scope_ref | `id:string R`, `repository_id:string R`; хотя бы одно из `path:string`, `path_prefix:string`, `component:string`, `symbols:string[]` R |
| search_scope_ref | `id:string R`, `repository_id:string R`, `queries:string[] O`; хотя бы одно из `path:string`, `path_prefix:string`, `component:string`, `symbols:string[]` R |

`source_ref` — один из вариантов:

| kind | Поля |
|---|---|
| `repository` | `kind R`, `code_ref R` |
| `attachment` | `kind R`, `source_id:string R`, `section:string O` |
| `url` | `kind R`, `url:string R`, `section:string O` |
| `task` | `kind R`, `source_id:string R`, `section:string O` |

`changed_files`, `inspection_scope` и `absence_search_scope` обязательны как массивы; минимум один из них непустой. `path` repository — локальный native path действующего контракта; Git paths во refs проверяются по правилам раздела 7.3.

Результат:

```json
{"assignment_id":"metrics-contract","valid":true,"counts":{"repositories":1,"requirements":2,"changed_files":3}}
```

При ошибке `result` отсутствует, errors содержат стабильный code, dotted path и message.

## 11. Команда validate-handoff

Вход:

```json
{"packet":{},"handoff":{}}
```

Оба полных документа обязательны. Сначала выполнить packet validation, затем проверить handoff.

Проверить:

- точное совпадение `assignment_id`;
- `scope_status` из `passed|failed|blocked`;
- snapshot echo для всех и только repositories packet;
- точное совпадение boundary SHA и `diff_semantics`;
- ровно один requirement status на каждый Requirement ID packet;
- допустимые requirement statuses и evidence sufficiency из текущего delegated contract;
- существование Requirement IDs, repository IDs и scope IDs во findings/evidence/scope structures;
- уникальность finding `local_id`;
- отсутствие top-level полей `verdict`, `global_verdict`, `final_verdict`;
- правило приоритета `failed`/`blocked`/`passed` из delegated contract.

Не проверять истинность evidence, достижимость сценария, полноту поиска или правильность локального finding.

### 11.1 Минимальные формы handoff

Все top-level массивы из примера обязательны, даже когда пусты:

```json
{
  "assignment_id":"metrics-contract",
  "scope_status":"passed",
  "snapshot_echo":{"repositories":[]},
  "requirement_statuses":[],
  "findings":[],
  "reviewed_files":[],
  "discovered_consumers":[],
  "scope_expansions":[],
  "scope_requests":[],
  "unresolved":[],
  "verification":[],
  "limitations":[]
}
```

| Объект | Поля |
|---|---|
| snapshot repository echo | все repository identity/boundary поля packet кроме локального `path`; optional `materialized_diff` в fast path запрещён |
| requirement status | `id:string R`, `status:enum R`, `evidence_sufficiency:enum R`, `evidence_refs:code_ref[] R`, `search_scope_refs:string[] R`, `evidence:string R` |
| defect finding | `local_id:string R`, `kind:"defect" R`, `priority:P0|P1|P2|P3 R`, `requirement_ids:string[] R`, `contract_refs:array R`, `location:code_ref R`, `evidence_refs:code_ref[1..n] R`, `reachable_scenario:string R`, `impact:string R`, `evidence:string R`; минимум один из `requirement_ids` или `contract_refs` непустой |
| implementation-gap finding | `local_id:string R`, `kind:"implementation_gap" R`, `priority:P0|P1|P2|P3 R`, `requirement_ids:string[1..n] R`, `search_scope_refs:string[1..n] R`, `evidence_refs:code_ref[] R`, `absence_evidence:string R`, `expected_owner:owner R`, `impact:string R` |
| owner | `kind:repository|external|unknown R`; для repository `repository_id R`, `component O`; для external `identity O`; для unknown дополнительных обязательных полей нет |
| reviewed file | `file_ref R`, `requirement_ids:string[] R`, `summary:string R` |
| discovered consumer | `code_ref R`, `requirement_ids:string[] R`, `relevance:string R` |
| scope expansion | `added_scope:scope_ref R`, `reason:string R`, `requirement_ids:string[1..n] R` |
| scope request | `requested_scope_ref R`, `reason:string R`, `requirement_ids:string[1..n] R` |
| unresolved | `reason:string R`, `requirement_ids:string[] R`, `scope_refs:array R` |
| verification | `status:passed|failed|not_run R`, `summary:string R`, `scope_refs:array R` |
| limitation | `description:string R`, `requirement_ids:string[] R`, `scope_refs:array R` |

`requested_scope_ref` содержит `requested_repository_id:string R`, optional `canonical_remote`, optional `snapshot`, optional arrays `path_prefixes`, `components`, `symbols`, и `whole_repository:boolean R`; требуется `whole_repository=true` либо хотя бы одна непустая область.

Каждый `scope_ref` использует различимый wrapper:

```json
{"kind":"inspection_scope_ref","value":{"id":"IS-001","repository_id":"sdkjs","path_prefix":"src"}}
```

`kind` имеет enum `file_ref|code_ref|inspection_scope_ref|search_scope_ref|source_ref`, а `value` обязан соответствовать выбранной форме. `scope_refs` — массив таких wrappers. Тот же wrapper используется в `scope_expansion.added_scope` и fixtures.

CLI не ищет слова verdict или Markdown-заголовки внутри свободного текста: это было бы недетерминированной семантической проверкой. Отсутствие глобального заголовка в фактическом ответе делегата проверяет независимый агент в S2; CLI запрещает только перечисленные top-level verdict-поля.

Requirement status enum: `реализовано`, `частично реализовано`, `не реализовано`, `реализовано с отклонением`, `невозможно подтвердить`, `не применимо`. Evidence sufficiency: `достаточно`, `частично`, `недостаточно`.

### 11.2 Вычисление scope_status

Валидатор вычисляет ожидаемый статус и сравнивает с заявленным:

1. `failed`, если есть хотя бы один finding либо requirement status `частично реализовано`, `не реализовано` или `реализовано с отклонением`.
2. Иначе `blocked`, если есть `невозможно подтвердить`, любой scope request, любой unresolved item либо evidence sufficiency `частично|недостаточно`.
3. Иначе `passed`, только если каждый requirement имеет `реализовано + достаточно` либо `не применимо + достаточно`, findings/scope requests/unresolved отсутствуют.

Если ни одно правило не даёт допустимый статус, handoff невалиден. `limitations` сами по себе статус не понижают.

Результат:

```json
{"assignment_id":"metrics-contract","valid":true,"scope_status":"passed","counts":{"requirements":2,"findings":0}}
```

## 12. Оркестрация

CLI не оркестрирует работу. Координатор вызывает команды в таком порядке:

1. Зафиксировать authoritative boundaries действующим способом.
2. Вызвать `snapshot` для каждого repository.
3. Сформировать packet из требований и snapshot results.
4. Вызвать `validate-packet` перед делегированием.
5. Делегат выполняет семантическое исследование.
6. Вызвать `validate-handoff` перед объединением результата.
7. Координатор самостоятельно проверяет доказательства и формирует глобальный verdict.

Для нескольких repositories независимые `snapshot` и независимые assignments можно запускать параллельно средствами агента. Отдельный scheduler или work graph не нужен.

Coordinator-only review использует только `snapshot`; создавать фиктивные packet/handoff запрещено.

### 12.1 Runtime-инструкции для сокращения работы ИИ

После реализации CLI обновить runtime references следующими правилами.

#### Доверять пройденному структурному gate

После успешного `snapshot`, `validate-packet` или `validate-handoff` не повторять вручную проверки, входящие в контракт этой команды. Повторная проверка допустима только при конкретном противоречии между результатом CLI и новым исходным доказательством. CLI подтверждает структуру; ИИ по-прежнему отвечает за repository identity, authoritative boundaries, смысл требований, истинность evidence и verdict.

#### Вести единое внутреннее состояние ревью

Координатор ведёт компактный внутренний `review_state`: sources, repositories, requirements, changed files, evidence, findings и limitations. Это эфемерное рабочее состояние ИИ, а не новый сериализованный документ, schema или пользовательский результат. Packet и итоговый отчёт формируются из уже собранных записей без повторного извлечения тех же фактов.

#### Выполнять два смысловых прохода

1. Маршрутизация: связать requirements с changed files, определить затронутые компоненты, применимые категории риска и необходимость consumer search или делегирования.
2. Доказательство: исследовать только выбранные пути до наблюдаемой границы поведения, заполнить evidence/status/findings.

Не выполнять углублённую проверку категории риска без сигнала из требования, diff, контракта или найденного consumer. Общие категории качества остаются checklist полноты, но не требуют одинаковой глубины для каждого файла.

#### Делегировать только с положительной ожидаемой выгодой

Coordinator-only является нормальным вариантом. Делегировать срез, когда он независим по требованиям и компонентам и параллельность либо изоляция большого контекста вероятно окупает создание packet, ожидание handoff и merge. Не делегировать небольшой связный срез только ради использования delegated mode. Причина делегирования либо отказа от него фиксируется одной внутренней фразой, без нового поля контракта.

#### Ограничивать и переиспользовать поиск consumers

Начинать с непосредственных definitions/callers/tests. Расширять поиск до семейств consumers при изменении публичного API, формата, persistence, serialization, config, feature flag, межрепозиторного контракта либо когда найденный consumer передаёт изменение дальше. Остановиться на наблюдаемой границе поведения и записать проверенный scope.

Не повторять одинаковый отрицательный поиск. Один search scope можно связать с несколькими Requirement IDs, если repository, snapshot, область и искомые признаки совпадают.

#### Записывать evidence один раз

Полное доказательство хранится в соответствующем requirement status или finding. Coverage, merge и итоговый отчёт используют ссылку/краткое основание, а не повторяют рассуждение. Пользовательский отчёт формируется один раз после закрытия requirements, changed files и handoffs; промежуточный draft отчёта не является рабочим реестром.

## 13. Реализация снизу вверх

### Этап 1. Базовые validators

Реализовать result envelope, проверку JSON object, строк, массивов, IDs, SHA и paths.

Тесты: positive/negative unit test на каждый примитив и exit code.

### Этап 2. Packet и handoff

Реализовать `validate-packet`, затем `validate-handoff` поверх тех же ref helpers.

Тесты: минимальный валидный документ, missing fields, duplicates, dangling refs, invalid status, packet/handoff mismatch и global verdict.

### Этап 3. Snapshot

Реализовать Git runner, boundary checks и NUL-delimited name-status parser.

Тесты: temporary repositories с empty diff, A/M/D/T, missing commit, invalid SHA, spaces/newlines в UTF-8 path и отсутствие изменений working tree/index/refs.

### Этап 4. CLI

Подключить три команды к одному dispatcher. Добавить black-box tests stdout, stderr и exit codes.

### Этап 5. Интеграция навыка

Добавить краткий `references/automation.md` с командами и fallback. Обновить coordinator/delegated references в местах вызова скриптов и добавить компактные правила раздела 12.1: не дублировать успешные gates, вести единое внутреннее состояние, выполнять маршрутизацию перед доказательством, делегировать условно, ограничивать consumer search и не повторять evidence. Не переносить схемы и объяснения этого TDD в runtime instructions.

### Этап 6. Пользовательские сценарии

Проверить MVP независимым агентом на реалистичных fixtures. После успешной проверки сделать automated path рекомендуемым, сохранив manual fallback при отсутствии CLI.

## 14. Пользовательские сценарии

### S1. Coordinator-only, один repository

`snapshot` возвращает полный список изменённых файлов. Координатор выполняет обычное семантическое ревью и выдаёт глобальный verdict.

### S2. Один delegated packet

Packet проходит validation, делегат возвращает compact handoff, handoff проходит validation. Делегат не выводит глобальный verdict.

### S3. Невалидный packet

Dangling repository или Requirement ID обнаруживается до запуска делегата. Команда возвращает exit 2 и точный путь ошибки.

### S4. Недоступная boundary

`snapshot` возвращает exit 3. CLI не выполняет fetch. Координатор не выдаёт локальный snapshot за подтверждённый.

### S5. Несколько repositories

Координатор параллельно вызывает `snapshot` для каждого repository. Одинаковые paths не конфликтуют, потому что каждый file ref содержит `repository_id`.

### S6. Scope request

Handoff с корректным `scope_request` проходит structural validation. Координатор решает, выдавать ли новый packet; CLI не расширяет scope.

### S7. Малый связный diff

Один repository, один компонент и связанные requirements проверяются coordinator-only. После `snapshot` не создаются packet/handoff, а применимые риски выбираются на проходе маршрутизации.

### S8. Повторно используемый search scope

Два requirements требуют одного отрицательного поиска в одинаковом repository/snapshot и области. Поиск выполняется один раз, а его scope связывается с обоими requirements без потери evidence.

### S9. Успешные CLI gates без ручного дубля

После успешных `snapshot`, `validate-packet` и `validate-handoff` агент не повторяет проверки SHA existence, duplicate/dangling refs, snapshot echo и вычисление `scope_status`; он продолжает с semantic evidence и verdict.

## 15. Приёмка MVP

Для S7–S9 использовать обычный transcript и журнал tool calls тестового запуска. Отдельный tracing harness не требуется. Приёмка оценивает только наблюдаемые команды, чтения и поиски; скрытое внутреннее reasoning критерием не является.

Реализация готова к активации, если:

1. Все unit, integration и black-box tests проходят.
2. `quick_validate.py task-code-review` проходит в настроенном окружении.
3. S1–S9 пройдены независимым агентом.
4. Агент подтверждает, что scripts не делают semantic claims и delegated handoff не содержит global verdict.
5. На одном зафиксированном single-repository fixture automated snapshot требует меньше отдельных AI-инициированных Git-команд, чем текущий manual workflow.
6. Packet/handoff validation обнаруживает подготовленный набор dangling/duplicate/mismatch defects до делегирования или merge.
7. В S7 coordinator-only path не создаёт фиктивные packet/handoff и фиксирует применимые категории исследования до углублённого анализа.
8. В S8 один фактически выполненный search scope подтверждает оба requirements; идентичный поиск не запускается повторно.
9. В S9 журнал tool calls не содержит ручных Git-команд или структурных шагов, повторяющих успешно пройденные проверки CLI. Повторная структурная проверка допустима только при зафиксированном противоречии. Проверка координатором истинности evidence, достижимости сценария и итогового verdict выполняется всегда и не считается дублем CLI.
10. В журнале tool calls формирование packet и отчёта не вызывает повторных чтений источников или поисков, выполненных только для смены формата уже собранных requirement/evidence records.

Не задавать процент ускорения до появления первого измерения. Не блокировать MVP из-за отсутствия поддержки редких path encodings, cache или формального protocol versioning: такие ограничения должны быть явными и безопасными.

## 16. Условия возврата отложенных решений

Добавлять усложнение только при наблюдаемом основании:

| Решение | Основание для добавления |
|---|---|
| Contract/protocol version | Появился второй несовместимый producer или consumer |
| Packet digest/JCS | Обнаружена реальная подмена или рассинхронизация packet |
| Lossless base64 paths | В целевом repository встречен non-UTF-8 path |
| Tree digest | Textual snapshot оказался нестабильным или недостаточным для identity |
| Work graph | Координатор регулярно теряет ownership или зависимости assignments |
| Scheduler | Ручная параллельность стала измеримым узким местом |
| Cache | Повторное построение одинакового snapshot занимает значимую долю review |
| Strict unknown-field policy | Несогласованные расширения начали менять поведение validators |
| Formal benchmark harness | Появилось несколько реализаций или regression скорости |

Каждое такое изменение оформлять отдельным небольшим TDD с наблюдаемым failure case и собственными критериями приёмки.
