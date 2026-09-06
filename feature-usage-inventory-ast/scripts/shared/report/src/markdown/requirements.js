"use strict";
const REQUIRED_SECTIONS = [
    "Scope И Seed-Словарь",
    "GitNexus Evidence Matrix",
    "Граф Передачи И Владения Между Объектами",
    "Переход Имен Между Слоями",
    "Словарь По Порядкам",
    "Пользовательские Сценарии",
    "Точки Старта И Ожидаемые Имена",
    "Группы Объектов И Получатели",
    "Эталонные Пути И Пробелы",
    "Где Ожидалась Реализация Пробелов",
    "Критические Пути",
    "Usage Inventory И Checked No Usage",
    "Приемка Полноты Для Задачи Доработки"
];
const REQUIRED_COLUMNS = {
    "Scope И Seed-Словарь": [
        "Термин",
        "Роль",
        "Источник термина",
        "Где искался",
        "Тип поиска",
        "Что найдено",
        "Статус",
        "Следующий поиск"
    ],
    "GitNexus Evidence Matrix": [
        "repo",
        "tool",
        "query/symbol",
        "result",
        "follow-up",
        "status"
    ],
    "Граф Передачи И Владения Между Объектами": [
        "От объекта",
        "Порядок от",
        "К объекту",
        "Порядок к",
        "Тип связи",
        "Свойство/метод",
        "Что передается/хранится",
        "Направление",
        "Evidence",
        "Статус"
    ],
    "Переход Имен Между Слоями": [
        "Слой",
        "Имя/термин",
        "Обязательность",
        "Почему ожидается",
        "Где искалось",
        "Что найдено",
        "Переход к следующему слою",
        "Статус"
    ],
    "Словарь По Порядкам": [
        "Термин",
        "Порядок",
        "Роль в графе",
        "Основание добавления",
        "Где искался",
        "Что найдено",
        "Открыло новые термины",
        "Статус"
    ],
    "Пользовательские Сценарии": [
        "Сценарий",
        "Объекты сценария",
        "Старт в frontend/product layer",
        "UI-компонент/команда",
        "Вызываемый core/sdk API",
        "Что передается",
        "Дальше в core/sdk",
        "Наблюдаемый результат",
        "Статус"
    ],
    "Точки Старта И Ожидаемые Имена": [
        "Категория старта",
        "Ожидаемые имена",
        "Как выведены",
        "Где искались",
        "Что найдено",
        "Куда должен вести путь",
        "Недостающий следующий шаг",
        "Статус"
    ],
    "Группы Объектов И Получатели": [
        "Группа объектов",
        "Связь с функциональностью",
        "Явно/опосредованно",
        "Как получает значение",
        "Где хранит состояние",
        "Где применяет изменение",
        "Где возвращает/readback",
        "Где выводит",
        "Статус"
    ],
    "Эталонные Пути И Пробелы": [
        "Слой",
        "Эталонный путь",
        "Почему применим",
        "Ожидаемый путь целевой сущности",
        "Найдено у целевой сущности",
        "Расхождение",
        "Статус",
        "Вывод для доработки"
    ],
    "Где Ожидалась Реализация Пробелов": [
        "Слой",
        "Пробел",
        "Ожидаемое имя/место",
        "Ожидаемый файл/папка",
        "Файловая форма",
        "Owner object",
        "Форма реализации",
        "Как выведено",
        "Где искалось",
        "Что найдено",
        "Альтернативный дизайн",
        "Статус"
    ],
    "Критические Пути": [
        "Путь",
        "Шаг",
        "Файл/символ",
        "Что передается",
        "Откуда пришло",
        "Куда уходит",
        "Статус",
        "Риск/вопрос"
    ],
    "Usage Inventory И Checked No Usage": [
        "Зона",
        "Файл/символ или область поиска",
        "Что проверялось",
        "Что найдено",
        "Почему релевантно",
        "Статус",
        "Evidence"
    ],
    "Приемка Полноты Для Задачи Доработки": [
        "Пункт приемки",
        "Статус",
        "Где доказано",
        "Что отсутствует",
        "Следующее действие"
    ]
};
const IMPLEMENTATION_ENTRY_POINTS_SECTION = "Существующие Точки Входа Для Доработки";
const IMPLEMENTATION_ENTRY_POINTS_COLUMNS = [
    "Слой доработки",
    "Существующая точка входа",
    "Существующий объект/метод",
    "Соседний эталон",
    "Что здесь уже есть",
    "Какой пробел закрывать",
    "Куда ведет дальше",
    "Риск если пропустить"
];
const IMPLEMENTATION_ENTRY_POINTS_LAYER_GATES = [
    {
        label: "declared entry/consumer",
        re: /entry|consumer|пользователь|сценар|команд|получател/i
    },
    {
        label: "API/DTO",
        re: /api|dto|public|публич|контракт|свойств/i
    },
    {
        label: "Controller/action",
        re: /controller|action|dispatch|контроллер|действ|команд/i
    },
    {
        label: "State mutation",
        re: /state|mutation|model|set|change|состоя|мутац|измен/i
    },
    {
        label: "Recipients",
        re: /recipient|object|group|получател|объект|групп|семейств/i
    },
    {
        label: "Readback",
        re: /readback|selection|get|getter|выбор|чтен|возвращ/i
    },
    {
        label: "Render/output",
        re: /render|output|draw|preview|print|отрис|вывод|рисован/i
    },
    {
        label: "Save/export",
        re: /save|export|serialize|write|сохран|экспорт|сериал|запис/i
    },
    {
        label: "Tests",
        re: /test|fixture|тест|фикстур|неприменимо/i
    }
];
const EXECUTION_STATUS_SECTION = "Статус Выполнения";
const EXECUTION_STATUS_COLUMNS = [
    "Этап",
    "Статус",
    "Что закрыто",
    "Что осталось",
    "Артефакт",
    "Следующий шаг"
];
const REQUIRE_STAGE_ARTIFACT_FOR_OPEN_STATUS = true;
const REQUIRED_STAGE_MARKERS = [
    "Этап 0. Подготовка",
    "Этап 1. Нижние Слои И Владение",
    "Этап 2. Переход Имен И Расширение Словаря",
    "Этап 3. Пользовательские Сценарии И Точки Старта",
    "Этап 4. Группы Объектов И Получатели",
    "Этап 5. Эталонные Пути, Пробелы И Ожидаемая Реализация",
    "Этап 6. Критические Пути",
    "Этап 7. Usage Inventory И Checked No Usage",
    "Этап 8. Финальная Приемка"
];
const EXPLANATION_LABELS = [
    "Что показывает",
    "Зачем нужна",
    "Как читать",
    "Как использовать"
];
const WEAK_PHRASES = [
    /^проверено$/i,
    /^не найдено$/i,
    /^нет$/i,
    /^да$/i,
    /^пробел$/i,
    /^подтверждено$/i,
    /^см\. выше$/i
];
const ACCEPTANCE_COVERAGE_GATES = [
    {
        id: "required_tables",
        label: "обязательные таблицы и расшифровки",
        re: /таблиц|секци|расшифров|описан/i
    },
    {
        id: "stages_dod",
        label: "этапы и DoD",
        re: /этап|dod|готовност|приемк/i
    },
    {
        id: "ownership_graph",
        label: "граф передачи и владения",
        re: /граф|владени|передач|поряд/i
    },
    {
        id: "name_transition",
        label: "переход имен между слоями",
        re: /переход.*имен|имен.*сло|сло.*имен/i
    },
    {
        id: "dictionary_expansion",
        label: "расширение словаря по порядкам",
        re: /словар|термин|поряд/i
    },
    {
        id: "scenario_starts",
        label: "сценарии и точки старта",
        re: /сценари|старт|вход/i
    },
    {
        id: "recipient_groups",
        label: "группы получателей",
        re: /групп|получател|семейств/i
    },
    {
        id: "reference_paths",
        label: "эталонные пути и пробелы",
        re: /эталон|аналог|пробел|расхожд/i
    },
    {
        id: "critical_paths",
        label: "критические end-to-end пути",
        re: /критичес|end-to-end|цепоч|путь/i
    },
    {
        id: "usage_checked_no_usage",
        label: "usage inventory и checked-no-usage",
        re: /usage|checked|использован|не найден|отсутств/i
    },
    {
        id: "gitnexus_evidence",
        label: "GitNexus graph/AST evidence matrix",
        re: /gitnexus|context|cypher|impact|trace|query|graph|ast/i
    },
    {
        id: "tests_or_not_applicable",
        label: "тесты/fixtures или обоснованное неприменимо",
        re: /тест|fixture|фикстур|неприменимо/i
    },
    {
        id: "file_name_hits_to_candidates",
        label: "file-name hits превращены в кандидатные точки реализации",
        re: /file-name|имен.*файл|соседн.*папк|файлов.*форм|кандидатн.*точк/i
    }
];
const START_POINTS_COVERAGE_GATES = [
    {
        id: "user_visible_start",
        label: "пользовательский или внешний старт",
        re: /ui|пользователь|команд|меню|панел|кнопк|внешн/i
    },
    {
        id: "integration_start",
        label: "интеграционный/продуктовый старт",
        re: /frontend|product|host|интеграц|продукт|хост|слой/i
    },
    {
        id: "programmatic_start",
        label: "программный вход или публичный контракт",
        re: /api|dto|публичн|контракт|метод|вызов|команд/i
    },
    {
        id: "readback_start",
        label: "selection/readback или обратное чтение",
        re: /readback|selection|выбор|чтени|возвращ/i
    },
    {
        id: "defaults_styles_start",
        label: "defaults/templates/theme/style/inheritance",
        re: /default|template|theme|style|inherit|умолчан|шаблон|тем|стил|наслед/i
    },
    {
        id: "import_open_paste_start",
        label: "import/open/paste источник",
        re: /import|open|paste|импорт|открыт|встав/i
    },
    {
        id: "tests_start",
        label: "tests/fixtures или явное неприменимо",
        re: /test|fixture|тест|фикстур|неприменимо/i
    }
];
const ALLOWED_IMPLEMENTATION_FORMS = [
    "class",
    "property",
    "prototype method",
    "helper",
    "renderer",
    "defaults",
    "serializer attr",
    "controller dispatch",
    "readback",
    "object-specific draw path",
    "command",
    "fixture"
];
const ALLOWED_FILE_FORMS = [
    "new file",
    "existing file",
    "neighbor folder",
    "class",
    "method",
    "property",
    "renderer",
    "defaults",
    "DTO/property",
    "controller",
    "readback",
    "recipient",
    "test"
];
const DERIVATION_HINTS = [
    "target name",
    "owner naming style",
    "эталон",
    "соседняя папка",
    "prototype pattern",
    "existing file pattern",
    "recipient-specific path",
    "lower-level",
    "api style"
];
const TOO_GENERIC_CANDIDATE_VALUES = new Set([
    "api",
    "dto",
    "render",
    "renderer",
    "controller",
    "output",
    "readback",
    "defaults",
    "theme",
    "style",
    "object",
    "file",
    "method",
    "property",
    "class",
    "helper",
    "слой",
    "объект",
    "файл",
    "метод",
    "свойство"
]);
const CRITICAL_PATHS_COVERAGE_GATES = [
    {
        id: "source_to_state_to_output",
        label: "source/import/open/paste -> state -> output",
        re: /(source|import|open|paste|источник|импорт|открыт|встав).*(state|состоя).*(output|вывод|результ|отрис|export|экспорт)/i
    },
    {
        id: "user_to_state_to_output",
        label: "user/API/action -> state -> output",
        re: /(user|api|action|пользователь|команд|действ|вызов).*(state|состоя).*(output|вывод|результ|отрис|export|экспорт)/i
    },
    {
        id: "state_to_save_export",
        label: "state -> save/export",
        re: /(state|состоя).*(save|export|сохран|экспорт)/i
    },
    {
        id: "additional_lifecycle",
        label: "дополнительные lifecycle пути или неприменимо",
        re: /undo|redo|copy|paste|preview|print|history|test|отмен|повтор|копир|встав|предпросмотр|печать|истори|тест|неприменимо/i
    }
];
module.exports = {
    REQUIRED_STAGE_MARKERS,
    REQUIRED_SECTIONS,
    REQUIRED_COLUMNS,
    EXECUTION_STATUS_SECTION,
    WEAK_PHRASES,
    EXPLANATION_LABELS,
    ACCEPTANCE_COVERAGE_GATES,
    START_POINTS_COVERAGE_GATES,
    CRITICAL_PATHS_COVERAGE_GATES,
    EXECUTION_STATUS_COLUMNS,
    REQUIRE_STAGE_ARTIFACT_FOR_OPEN_STATUS,
    TOO_GENERIC_CANDIDATE_VALUES,
    ALLOWED_IMPLEMENTATION_FORMS,
    ALLOWED_FILE_FORMS,
    DERIVATION_HINTS,
    IMPLEMENTATION_ENTRY_POINTS_SECTION,
    IMPLEMENTATION_ENTRY_POINTS_LAYER_GATES
};
