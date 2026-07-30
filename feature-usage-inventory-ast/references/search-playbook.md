# Search Playbook

Цель playbook - не найти много строк, а восстановить граф использования целевой сущности.

## 0. Область Поиска И Фильтры

Перед широким поиском определи основной набор каталогов и фильтры шума.

Для первичного поиска по исходному коду обычно исключай:

- зависимости и сторонний код: `node_modules`, `vendor`, внешние snapshots;
- кэши и временные артефакты: `.cache`, `.webpack-cache`, `tmp`, `temp`;
- сборочные результаты и карты: `dist`, `build`, `out`, `coverage`, `*.map`, minified bundles;
- бинарные и пакетные файлы, если они не являются целевым persisted format;
- локализации, справку, search indexes и документационные примеры без связи с поведением;
- lock-файлы и generated-файлы, если они не являются источником схемы или публичного контракта.

Не удаляй эти зоны из исследования полностью. Если зона ожидаемо может содержать источник значения, формат сохранения, fixture, публичный контракт или проверку отсутствия использования, ищи в ней отдельным проходом и помечай статус: `подтвержденное использование`, `проверено, использования нет` или `шум`.

Если репозиторий использует linked directories или junctions, обычный поиск может пропустить исходники. В таком случае используй поиск с переходом по ссылкам и теми же фильтрами шума.
## 1. Seed Terms

Собери несколько групп терминов:

- canonical names: имена классов, интерфейсов, полей, функций;
- persisted names: ключи binary/json/xml/schema, enum ids, tags;
- API names: public getters, setters, methods, DTO, commands;
- UI names: labels, menu commands, toolbar ids, settings fields;
- lifecycle names: read/write/load/save/serialize/deserialize/render/export/copy/paste/history;
- abbreviated names: короткие варианты, legacy aliases, casing variants.

## 2. Definition Search

Найди место определения и ближайшие владельцы:

- class/interface/type/struct/schema definitions;
- constructors/default values;
- clone/copy/merge/reset/equality methods;
- validation and normalization;
- import/export adapters.

## 3. Alias Expansion

После каждого найденного файла расширяй словарь:

- новые wrapper names;
- method names вокруг чтения/записи;
- enum constants;
- persisted field ids;
- shared property containers;
- recipient family names.

## 4. Owner Expansion

Для каждого владельца ищи:

- кто создает владельца;
- кто хранит владельца;
- кто читает владельца;
- кто передает владельца дальше;
- кто превращает владельца в output;
- кто пишет владельца в persisted data.

## 5. Recipient Expansion

Если сущность является свойством контейнера, найди все семейства объектов, которые могут получить этот контейнер. Не ограничивайся первым известным получателем.

Ищи по:

- assignment sites;
- factory/build functions;
- inheritance chains;
- common base classes;
- render dispatch;
- serializer dispatch;
- UI object selection and object-type branching;
- tests/fixtures for each family.

## 6. Scenario Starts

Отдельно ищи места, где сценарий начинается:

- UI command/menu/settings panel;
- public API call;
- importer/loader;
- paste/drop/open document;
- template/default/style application;
- automated test or fixture setup.

## 7. Downstream Consumers

Проверь downstream независимо от прямых совпадений:

- renderer and preview;
- export to supported formats;
- serializer and binary writer;
- copy/paste payload;
- history/change tracking;
- recalculation/cache invalidation;
- compatibility/fallback code.

## 8. Negative Evidence

Для ожидаемых зон фиксируй checked-no-usage:

- какие термины искались;
- какие каталоги/файлы проверены;
- какие фильтры применялись и какие зоны исключались из основного поиска;
- почему зона ожидалась;
- что отсутствие означает для реализации.

## 9. Noise Control

Отмечай как шум:

- generated maps/minified bundles;
- unrelated CSS/theme names;
- localization/help text без связи с behavior;
- vendor code вне ownership path;
- совпадения по общему слову без структурной связи.