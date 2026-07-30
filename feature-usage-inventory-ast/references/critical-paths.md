# Critical Paths

Критический путь - это минимальная цепочка от источника значения до observable output или persisted result. Не смешивай разные источники: import, UI/API и state-to-save часто проходят через разные файлы.

## Обязательные Пути Для Полной Инвентаризации

### Source/Import -> Internal State -> Output

Используй для бинарных, json, xml, template, clipboard или других входных данных.

Цепочка:

1. source reader/import entry;
2. low-level parse/map/schema ids;
3. converter/adapter;
4. canonical internal state;
5. recalculation/cache/default resolution;
6. consumer/render/export/output.

### User/API Scenario -> Internal State -> Output

Используй для сценариев, начинающихся в UI, public API, command layer или automation.

Цепочка:

1. product/UI/API entry;
2. command/controller/action;
3. bridge to core model;
4. mutation/change model/history;
5. recalculation/cache invalidation;
6. render/preview/export/output.

### Internal State -> Persistence/Export

Используй для сохранения, binary write, json/xml write, export, copy/paste payload.

Цепочка:

1. canonical internal state;
2. resolved/default-expanded state if needed;
3. serializer/export adapter;
4. low-level writer/schema ids;
5. persisted artifact;
6. compatibility/fallback behavior.

## Дополнительные Пути

Добавляй только если они релевантны целевой сущности.

- Defaults/Style/Theme -> Resolved State -> Output.
- Parent/Container -> Child/Recipient -> Output.
- Copy/Paste -> Internal State -> Output.
- History/Undo/Redo -> Internal State -> Output.
- Collaboration/Coauthoring -> Internal State -> Output.
- Import Compatibility -> Fallback -> Output.
- Test Fixture -> Loader -> Assertion/Output.
- Cache/Recalculation -> Derived State -> Output.
- Export-only path, если rendering и export расходятся.
- Preview/thumbnail/print path, если он использует отдельный renderer.

## Таблица Пути

| Путь | Шаг | Файл/символ | Что передается | Evidence | Риск/вопрос |
|---|---|---|---|---|---|
| User/API -> State -> Output | 1 | ... | command payload | ... | ... |

## Правило Проверки

Путь считается подтвержденным только если есть evidence для начала, перехода в internal state и output/persistence. Если найден только serializer или только renderer, путь неполный.