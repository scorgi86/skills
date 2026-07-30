# SWC AST Analyzer Implementation Plan

## Output Optimization Addendum (implemented 2026-07-15)

The analyzer keeps the full symbol/relation/evidence index in memory and applies limits only at JSON presentation time.

- Added `scripts/ast/output.js` for stable semantic grouping, evidence/snippet compaction, byte budgeting, group pagination, and detail lookup.
- Added CLI controls: `--output-mode`, `--max-output-bytes`, `--max-evidence-per-item`, `--max-snippet-chars`, `--max-groups`, `--group-offset`, and `--details-for`.
- Added coverage metadata and recommended bounded follow-up queries.
- Added `fixtures/prototype/high-fanout.js` and regression tests for fanout grouping, final-group retrieval, and pagination.
- Default output budget is 32 KiB. Exceeding it changes presentation to summary; it does not discard candidates from the internal analysis.

Optimization DoD:

- [x] Large default query output is no more than 32 KiB on the recorded `ChartSpace.js` benchmark.
- [x] Full item/evidence counts remain visible in `coverage`.
- [x] Every semantic group is addressable by stable `groupKey` and pageable with `groupOffset`.
- [x] A rare final group is retrievable in regression tests.
- [x] Existing parser/query/cache/CLI regression tests still pass.

Статус: SWC MVP реализован, проверен локальными тестами и независимыми forward-test прогонами; `quick_validate.py` недоступен в текущем Python без `PyYAML`, встроенный `validate_skill.js` проходит.

Дата решения: 2026-07-15.

Использовать этот план при замене regex-сканирования в `scripts/prototype_ast.js` на настоящий AST-анализ. Выполнять шаги последовательно. Не менять `sdkjs`, `web-apps` или `desktop-apps` в рамках этой работы.

## Содержание

- [Зафиксированное решение](#зафиксированное-решение)
- [Цель](#цель)
- [Не входит в область](#не-входит-в-область)
- [Планируемая структура](#планируемая-структура)
- [Обязательная подготовка](#обязательная-подготовка)
- [Шаг 1. CLI и JSON contract](#шаг-1-cli-и-json-contract)
- [Шаг 2. SWC parser adapter](#шаг-2-swc-parser-adapter)
- [Шаг 3. Walker и evidence coordinates](#шаг-3-walker-и-evidence-coordinates)
- [Шаг 4. Первый проход: symbol index](#шаг-4-первый-проход-symbol-index)
- [Шаг 5. Второй проход: relations](#шаг-5-второй-проход-relations)
- [Шаг 6. Ownership, recipients и paths](#шаг-6-ownership-recipients-и-paths)
- [Шаг 7. Candidate input и cache](#шаг-7-candidate-input-и-cache)
- [Шаг 8. Regression tests и benchmark](#шаг-8-regression-tests-и-benchmark)
- [Шаг 9. Интеграция со skill workflow](#шаг-9-интеграция-со-skill-workflow)
- [Шаг 10. Финальная валидация и forward-test](#шаг-10-финальная-валидация-и-forward-test)
- [Общий Definition of Done](#общий-definition-of-done)
- [Stop Criteria](#stop-criteria)
- [Команда для начала реализации](#команда-для-начала-реализации)

## Зафиксированное решение

- Использовать `@swc/core` как основной parser.
- Использовать `parseSync`/`parseFileSync` только для построения AST; не применять transforms, plugins или code generation.
- Реализовать собственный read-only walker.
- Строить индекс в два прохода: symbols, затем relations.
- Изолировать parse failure на уровне отдельного файла.
- Не добавлять Babel fallback в MVP. При ошибке SWC оставлять файл `не проверено` и передавать его на targeted search/manual read.
- Сохранять `scripts/prototype_ast.js` как совместимый CLI entry point.
- Считать любой AST-результат candidate evidence до независимого подтверждения в исходнике.
- Запускать анализатор на версии Node.js, фактически доступной в среде выполнения skill; не вводить отдельную обязательную поддержку Node.js 16.
- Устанавливать `@swc/core` и прочие runtime-зависимости локально в корень `feature-usage-inventory-ast`; не использовать project/global `node_modules`.
- До создания постоянных результатов анализа спрашивать у пользователя формат и место сохранения; до ответа не создавать report, stage, cache и raw-output artifacts.

```text
SWC candidate + targeted search + manual source read = confirmed evidence
```

## Цель

Получить детерминированный анализатор для legacy JavaScript/TypeScript, который:

- разбирает JS/JSX/TS/TSX настоящим parser;
- находит symbols, fields, reads, writes, calls, assignments, owners и recipients;
- поддерживает ES5 prototype-паттерны `sdkjs`;
- строит ограниченные ownership/data-flow chains;
- возвращает компактное evidence с точными координатами;
- не делает выводов об отсутствии использования по неполному AST-покрытию.

## Не входит в область

- Изменение исходников проектов R7.
- Полный type checker уровня TypeScript.
- Точное разрешение динамического dispatch.
- Taint analysis или полноценный interprocedural data-flow engine.
- Подтверждение бизнес-смысла без чтения исходника.
- Автоматическое доказательство отсутствия использования.

## Планируемая структура

```text
feature-usage-inventory-ast/
├── package.json
├── package-lock.json
├── scripts/
│   ├── prototype_ast.js
│   ├── prototype_ast.test.js
│   └── ast/
│       ├── parser.js
│       ├── walker.js
│       ├── evidence.js
│       ├── index.js
│       ├── relations.js
│       └── queries.js
├── fixtures/prototype/
└── references/
    ├── ast-workflow.md
    └── local-ast-analyzer-implementation-plan.md
```

Не создавать README, changelog или отдельную пользовательскую документацию. Детали CLI держать в `references/ast-workflow.md`.

## Обязательная подготовка

### P0. Разрешения

До изменений получить:

- явное разрешение на изменение skill-файлов;
- разрешение на сетевую установку `@swc/core`;
- разрешение на создание `package.json` и `package-lock.json`;
- отдельное разрешение, если возникнет необходимость менять проектные исходники.

### P1. Runtime и dependency compatibility

Проверить:

- фактическую версию Node.js для запуска skills;
- версию Node.js, фактически доступную в среде выполнения skill; Node.js 16 не является отдельной целевой версией;
- совместимую версию `@swc/core`;
- Windows x64 native binding;
- запуск без глобально установленных пакетов;
- установку в локальный `node_modules` корня skill и разрешение модулей только из него;
- воспроизводимость установки по lock-файлу;
- отсутствие `node_modules` в итоговых изменениях.

Артефакт: таблица `runtime -> @swc/core version -> binding status`.

### P2. Baseline текущего анализатора

Зафиксировать для существующих fixtures:

- выводы `analyze`, `owners`, `chain`;
- exit codes;
- время и размер JSON;
- semantic edges;
- дубли, false positives и пропуски;
- поведение `--help` и неизвестной команды.

Обязательные baseline edges:

```text
Shape.fill -> GradFill
Page.shapes[] -> Shape
Document.pages[] -> Page
Theme.fills[key] -> GradFill
setter argument -> Shape.fill
```

### P3. Representative corpus

Использовать read-only corpus:

- `sdkjs/word/Editor/Paragraph.js`;
- `sdkjs/common/Drawings/Format/Format.js`;
- `sdkjs/cell/model/Workbook.js`;
- один характерный файл `web-apps`;
- fixtures для JSX, TS/TSX, comments, regex literals и template literals;
- намеренно некорректный файл для parse-failure isolation.

Для каждого файла записать размер, parser mode и ожидаемые конструкции.

### P4. Compatibility impact

GitNexus impact для skill-каталога неприменим. Вместо него:

- найти все упоминания `prototype_ast.js`;
- найти все вызовы `analyze`, `owners`, `chain`;
- определить consumers текущей JSON-схемы;
- проверить связь со stage artifacts и validators;
- составить таблицу `старый CLI -> новый CLI`;
- перечислить сохраняемые и выводимые из эксплуатации поля.

## Шаг 1. CLI и JSON contract

Цель: зафиксировать интерфейс до реализации.

Поддержать команды:

```text
index, analyze, find, symbols, fields, methods,
reads, writes, assignments, calls, callers, callees,
owners, recipients, collections, chain, summary, stats, doctor
```

Поддержать параметры:

```text
--file, --scope, --files-from, --type, --owner, --field,
--terms, --kind, --max-depth, --max-paths, --max-branches,
--max-results, --min-confidence, --cache, --format
```

Стандартизировать exit codes:

- `0`: успешное выполнение, включая честный `not-found`;
- `1`: parse или analysis failure;
- `2`: ошибка аргументов или неизвестная команда.

Писать в stdout только JSON, диагностику — в stderr.

Артефакт: версия JSON schema и compatibility matrix.

DoD:

- [ ] Все команды и обязательные аргументы описаны.
- [ ] `--help` работает независимо от позиции.
- [ ] Старые `analyze`, `owners`, `chain` имеют совместимый контракт или migration rule.
- [ ] Output schema содержит `schemaVersion`, `parser`, `stats`, `warnings`, `errors`.
- [ ] Exit codes покрыты тестами.

## Шаг 2. SWC parser adapter

Цель: изолировать конфигурацию parser и ошибки файлов.

Выбирать режим по расширению:

- `.js`: `ecmascript`;
- `.jsx`: `ecmascript + jsx`;
- `.ts`: `typescript`;
- `.tsx`: `typescript + tsx`.

Возвращать:

```text
ast, filename, syntax mode, SWC version,
elapsed time, parse diagnostics
```

Артефакт: `scripts/ast/parser.js` и parser fixtures.

DoD:

- [ ] Все валидные fixtures разбираются.
- [ ] Все выбранные валидные representative files разбираются.
- [ ] Ошибка одного файла не прерывает candidate set.
- [ ] Parse failure получает статус `не проверено`, а не `not-found`.
- [ ] Parser mode и SWC version присутствуют в diagnostics.

## Шаг 3. Walker и evidence coordinates

Цель: обеспечить один read-only обход AST и точные ссылки на источник.

Walker должен хранить:

- parent stack;
- lexical/function/class scope;
- current symbol;
- pre-order и post-order hooks;
- module и file context.

Evidence mapper должен возвращать:

```text
file, start offset/line/column, end offset/line/column,
bounded snippet, extractor, confidence, status
```

Построить line-start index один раз на файл; переводить offset в строку бинарным поиском.

Артефакт: `walker.js`, `evidence.js`, location tests.

DoD:

- [ ] Walker не изменяет AST.
- [ ] Все evidence ranges указывают на исходный fragment.
- [ ] Multiline node получает корректные start/end.
- [ ] Comments, regex literals и template literals не ломают traversal.
- [ ] Evidence extraction не пересчитывает все предыдущие строки для каждого узла.

## Шаг 4. Первый проход: symbol index

Цель: построить таблицу symbols до извлечения отношений.

Извлечь:

- functions, classes и constructors;
- class methods;
- assignment constructors;
- prototype assignment methods;
- prototype object methods;
- prototype aliases;
- variables и parameters;
- imports/exports;
- namespace-qualified names;
- object literal identities;
- return expressions.

Использовать qualified name как основной ключ. Короткое имя хранить только как secondary candidate key.

Артефакт: `scripts/ast/index.js` и symbol-index fixtures.

DoD:

- [ ] ES5 prototype-паттерны `sdkjs` индексируются без regex.
- [ ] Namespace constructors сохраняют qualified name.
- [ ] Одинаковые short names из разных namespaces не сливаются.
- [ ] Alias resolution хранит путь разрешения.
- [ ] Unresolved symbol остаётся candidate.

## Шаг 5. Второй проход: relations

Цель: извлечь структурные связи с использованием symbol index.

Извлечь:

- field reads и writes;
- direct и computed assignments;
- parameter-to-field;
- field-to-return;
- call-result-to-field;
- field-to-call-argument;
- getter/setter relations;
- instance, multiple и conditional assignments;
- `push`, indexed assignment, `Map.set`, `add`;
- factory, clone и read candidates;
- direct calls и unresolved dynamic calls;
- import/export relations.

Артефакт: `scripts/ast/relations.js` и relation fixtures.

DoD:

- [ ] Exact AST relation отделена от name-inferred candidate.
- [ ] Dynamic key/dispatch не превращается в точную связь.
- [ ] Parameter-to-field проходит через setter call.
- [ ] Конфликтующие типы сохраняются отдельными evidence.
- [ ] Строки и комментарии не создают relations.

## Шаг 6. Ownership, recipients и paths

Цель: нормализовать relations в ограниченный query graph.

Semantic edge:

```text
ownerQualifiedName, relation, field/method,
targetQualifiedName, module, evidence[], confidence
```

Поддержать запросы:

```text
fields --owner Shape --field fill
methods --owner Shape --writes fill
assignments --field fill --value-type GradFill
owners --type GradFill
recipients --type GradFill
calls --symbol Shape.setFill
chain --type GradFill
summary --terms GradFill
```

Ограничить graph traversal:

- semantic deduplication;
- qualified-name matching;
- cycle protection;
- `max-depth`, `max-paths`, `max-branches`;
- `min-confidence`;
- same-module/cross-module mode;
- `truncated` marker;
- confidence ordering.

Артефакт: `queries.js`, query fixtures, bounded path output.

DoD:

- [ ] Одинаковые semantic edges объединены с сохранением `evidence[]`.
- [ ] `ambiguous` определяется разными owners/types, а не числом строк.
- [ ] Short-name match не становится exact cross-module edge.
- [ ] Циклы завершаются явно.
- [ ] Default chain/summary output не превышает 200 строк.
- [ ] Обрезанный результат содержит `truncated: true` и счётчики.

## Шаг 7. Candidate input и cache

Цель: ускорить повторные этапы и исключить широкий неуправляемый scan.

Добавить `--files-from` с UTF-8 списком candidate paths.

Cache key:

```text
schema version + SWC version + parser options + normalized path + content hash
```

Артефакт: candidate loader, cache, stats.

DoD:

- [ ] Repo-root scan по умолчанию заблокирован.
- [ ] `--files-from` принимает абсолютные и относительные пути.
- [ ] Повторный запуск использует cache для неизменённых файлов.
- [ ] Изменённый файл переиндексируется.
- [ ] `stats` показывает hits, misses, parsed, skipped, failed и elapsed time.

## Шаг 8. Regression tests и benchmark

Цель: превратить fixtures в исполняемый контракт.

Использовать встроенный `node:test`.

Покрыть:

- constructors и prototype methods;
- aliases и qualified names;
- getters/setters;
- arrays/maps и computed keys;
- conditional/multiple assignments;
- factory/clone/read candidates;
- ownership и recipients;
- namespace collisions;
- cycles и truncation;
- JS/JSX/TS/TSX;
- malformed file isolation;
- CLI JSON и exit codes;
- noise fixture.

Сравнить baseline и SWC:

- cold/warm time;
- peak memory;
- parse failures;
- semantic edges;
- duplicates;
- false positives;
- missed expected edges;
- JSON size.

Артефакт: test report и benchmark table.

DoD:

- [ ] Все positive и negative fixtures проходят.
- [ ] Все обязательные baseline edges найдены.
- [ ] Noise fixture не создаёт type ownership.
- [ ] На representative valid corpus нет parse failures.
- [ ] Cache warm run подтверждён метриками.
- [ ] Performance regression и memory ceiling либо приемлемы, либо согласованы отдельно.

## Шаг 9. Интеграция со skill workflow

Цель: синхронизировать реализованный CLI и этапную модель.

Обновить `references/ast-workflow.md`:

- перечислить только реализованные команды;
- описать dependency и `doctor`;
- закрепить `--files-from`;
- описать parse failures и limitations;
- связать AST operations с этапами inventory.

Роли по этапам:

- этап 1: fields, owners, containers, persistence candidates;
- этап 2: methods, aliases, dictionary expansion;
- этап 4: recipients и fanout candidates;
- этап 5: bounded ownership/call paths;
- этап 7: AST candidate matrix и source confirmation status.

Каждый stage artifact должен фиксировать:

```text
parser/schema version, candidate files, command,
parsed/skipped/failed, returned/truncated,
confidence distribution, limitations,
source confirmations still required
```

Артефакт: обновлённые `ast-workflow.md`, `SKILL.md` при необходимости и UI metadata review.

DoD:

- [ ] Документация не содержит отсутствующих команд.
- [ ] `SKILL.md` остаётся кратким router.
- [ ] AST candidates отделены от confirmed evidence.
- [ ] Parse failure не используется для absence claim.
- [ ] `agents/openai.yaml` соответствует фактическому поведению.

## Шаг 10. Финальная валидация и forward-test

Запустить:

```text
node --check
node --test
scripts/validate_skill.js
skill-creator quick_validate.py
prototype_ast.js doctor
fixture smoke matrix
representative-file benchmark
```

Проверить отсутствие:

- временных файлов;
- `node_modules` в итоговом наборе;
- изменений в проектных исходниках;
- расхождений CLI и reference;
- необъяснённых parse failures.

После отдельного подтверждения провести независимый forward-test на ограниченном candidate set без передачи ожидаемого ответа.

DoD:

- [ ] Syntax, unit, integration и skill validation проходят.
- [ ] Compatibility matrix закрыта.
- [ ] Benchmark и limitations опубликованы в артефакте этапа.
- [ ] Forward-test использует filtered commands и не делает full AST dump.
- [ ] AST candidates не повышаются до confirmed без чтения исходника.
- [ ] Исходники `sdkjs`, `web-apps`, `desktop-apps` не изменены.

## Общий Definition of Done

- [ ] Структурное извлечение использует SWC AST, а не regex.
- [ ] Версия `@swc/core` закреплена и воспроизводима.
- [ ] Анализатор работает на Node.js, фактически доступной в среде выполнения skill, и Windows runtime.
- [ ] Зависимости установлены локально в skill и не зависят от project/global `node_modules`.
- [ ] Перед созданием report, stage, cache и raw-output artifacts получен ответ пользователя о формате и месте сохранения.
- [ ] Реализован двухпроходный symbol/relation index.
- [ ] Qualified names являются основным ключом.
- [ ] Поддержаны legacy ES5 prototype-паттерны `sdkjs`.
- [ ] Реализованы filtered queries и bounded chains.
- [ ] Все relations содержат source range, snippet, extractor, confidence и status.
- [ ] Dynamic relations остаются candidates.
- [ ] Parse failure остаётся `не проверено`.
- [ ] Semantic edges дедуплицированы с сохранением `evidence[]`.
- [ ] Default output укладывается в 200 строк.
- [ ] `--files-from` и content-hash cache работают.
- [ ] Fixtures покрыты positive и negative regression tests.
- [ ] CLI возвращает согласованные exit codes и валидный JSON.
- [ ] Документация соответствует реализации.
- [ ] Skill validators и forward-test проходят.
- [ ] Проектные исходники не изменены.

## Stop Criteria

Остановить работу и вернуться к пользователю, если:

- отсутствует одобрение правок или установки зависимости;
- пользователь не согласовал формат и место сохранения результатов, а следующий шаг создаёт report, stage, cache или raw-output artifact;
- `@swc/core` несовместим с обязательным Node.js runtime;
- Windows native binding не устанавливается воспроизводимо;
- требуется глобальная установка пакета;
- SWC не разбирает representative valid file;
- spans нельзя надёжно связать с source coordinates;
- новый контракт требует необратимо сломать существующий CLI;
- fixture parity меняется без однозначного ожидаемого поведения;
- chain остаётся неограниченным или создаёт искусственные cross-module paths;
- validator или regression tests не проходят;
- benchmark показывает неприемлемые время или память без локализованной причины;
- продолжение требует изменений в `sdkjs`, `web-apps` или `desktop-apps`;
- обнаружен HIGH/CRITICAL impact на проектные исходники — тогда выполнить отдельный GitNexus impact и запросить новое одобрение.

## Команда для начала реализации

Начинать только после явного сообщения пользователя, например:

```text
можно править skill и установить @swc/core
```
