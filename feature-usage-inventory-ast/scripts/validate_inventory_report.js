#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

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
  "Приемка Полноты Для Задачи Доработки",
];

const REQUIRED_COLUMNS = {
  "Scope И Seed-Словарь": ["Термин", "Роль", "Источник термина", "Где искался", "Тип поиска", "Что найдено", "Статус", "Следующий поиск"],
  "GitNexus Evidence Matrix": ["repo", "tool", "query/symbol", "result", "follow-up", "status"],
  "Граф Передачи И Владения Между Объектами": ["От объекта", "Порядок от", "К объекту", "Порядок к", "Тип связи", "Свойство/метод", "Что передается/хранится", "Направление", "Evidence", "Статус"],
  "Переход Имен Между Слоями": ["Слой", "Имя/термин", "Обязательность", "Почему ожидается", "Где искалось", "Что найдено", "Переход к следующему слою", "Статус"],
  "Словарь По Порядкам": ["Термин", "Порядок", "Роль в графе", "Основание добавления", "Где искался", "Что найдено", "Открыло новые термины", "Статус"],
  "Пользовательские Сценарии": ["Сценарий", "Объекты сценария", "Старт в frontend/product layer", "UI-компонент/команда", "Вызываемый core/sdk API", "Что передается", "Дальше в core/sdk", "Наблюдаемый результат", "Статус"],
  "Точки Старта И Ожидаемые Имена": ["Категория старта", "Ожидаемые имена", "Как выведены", "Где искались", "Что найдено", "Куда должен вести путь", "Недостающий следующий шаг", "Статус"],
  "Группы Объектов И Получатели": ["Группа объектов", "Связь с функциональностью", "Явно/опосредованно", "Как получает значение", "Где хранит состояние", "Где применяет изменение", "Где возвращает/readback", "Где выводит", "Статус"],
  "Эталонные Пути И Пробелы": ["Слой", "Эталонный путь", "Почему применим", "Ожидаемый путь целевой сущности", "Найдено у целевой сущности", "Расхождение", "Статус", "Вывод для доработки"],
  "Где Ожидалась Реализация Пробелов": ["Слой", "Пробел", "Ожидаемое имя/место", "Ожидаемый файл/папка", "Файловая форма", "Owner object", "Форма реализации", "Как выведено", "Где искалось", "Что найдено", "Альтернативный дизайн", "Статус"],
  "Критические Пути": ["Путь", "Шаг", "Файл/символ", "Что передается", "Откуда пришло", "Куда уходит", "Статус", "Риск/вопрос"],
  "Usage Inventory И Checked No Usage": ["Зона", "Файл/символ или область поиска", "Что проверялось", "Что найдено", "Почему релевантно", "Статус", "Evidence"],
  "Приемка Полноты Для Задачи Доработки": ["Пункт приемки", "Статус", "Где доказано", "Что отсутствует", "Следующее действие"],
};

const IMPLEMENTATION_ENTRY_POINTS_SECTION = "Существующие Точки Входа Для Доработки";
const IMPLEMENTATION_ENTRY_POINTS_COLUMNS = ["Слой доработки", "Существующая точка входа", "Существующий объект/метод", "Соседний эталон", "Что здесь уже есть", "Какой пробел закрывать", "Куда ведет дальше", "Риск если пропустить"];
const IMPLEMENTATION_ENTRY_POINTS_LAYER_GATES = [
  { label: "UI/product/frontend", re: /ui|product|frontend|web-apps|пользователь|сценар|команд|меню|панел|кнопк/i },
  { label: "API/DTO", re: /api|dto|public|публич|контракт|свойств/i },
  { label: "Controller/action", re: /controller|action|dispatch|контроллер|действ|команд/i },
  { label: "State mutation", re: /state|mutation|model|set|change|состоя|мутац|измен/i },
  { label: "Recipients", re: /recipient|object|group|получател|объект|групп|семейств/i },
  { label: "Readback", re: /readback|selection|get|getter|выбор|чтен|возвращ/i },
  { label: "Render/output", re: /render|output|draw|preview|print|отрис|вывод|рисован/i },
  { label: "Save/export", re: /save|export|serialize|write|сохран|экспорт|сериал|запис/i },
  { label: "Tests", re: /test|fixture|тест|фикстур|неприменимо/i },
];
if (!REQUIRED_SECTIONS.includes(IMPLEMENTATION_ENTRY_POINTS_SECTION)) {
  const after = REQUIRED_SECTIONS.indexOf("Где Ожидалась Реализация Пробелов");
  REQUIRED_SECTIONS.splice(after >= 0 ? after + 1 : REQUIRED_SECTIONS.length, 0, IMPLEMENTATION_ENTRY_POINTS_SECTION);
}
REQUIRED_COLUMNS[IMPLEMENTATION_ENTRY_POINTS_SECTION] = IMPLEMENTATION_ENTRY_POINTS_COLUMNS;

const EXECUTION_STATUS_SECTION = "Статус Выполнения";
const EXECUTION_STATUS_COLUMNS = ["Этап", "Статус", "Что закрыто", "Что осталось", "Артефакт", "Следующий шаг"];
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
  "Этап 8. Финальная Приемка",
];
const EXPLANATION_LABELS = ["Что показывает", "Зачем нужна", "Как читать", "Как использовать"];
const WEAK_PHRASES = [
  /^проверено$/i,
  /^не найдено$/i,
  /^нет$/i,
  /^да$/i,
  /^пробел$/i,
  /^подтверждено$/i,
  /^см\. выше$/i,
];

const ACCEPTANCE_COVERAGE_GATES = [
  { id: "required_tables", label: "обязательные таблицы и расшифровки", re: /таблиц|секци|расшифров|описан/i },
  { id: "stages_dod", label: "этапы и DoD", re: /этап|dod|готовност|приемк/i },
  { id: "ownership_graph", label: "граф передачи и владения", re: /граф|владени|передач|поряд/i },
  { id: "name_transition", label: "переход имен между слоями", re: /переход.*имен|имен.*сло|сло.*имен/i },
  { id: "dictionary_expansion", label: "расширение словаря по порядкам", re: /словар|термин|поряд/i },
  { id: "scenario_starts", label: "сценарии и точки старта", re: /сценари|старт|вход/i },
  { id: "recipient_groups", label: "группы получателей", re: /групп|получател|семейств/i },
  { id: "reference_paths", label: "эталонные пути и пробелы", re: /эталон|аналог|пробел|расхожд/i },
  { id: "critical_paths", label: "критические end-to-end пути", re: /критичес|end-to-end|цепоч|путь/i },
  { id: "usage_checked_no_usage", label: "usage inventory и checked-no-usage", re: /usage|checked|использован|не найден|отсутств/i },
  { id: "gitnexus_evidence", label: "GitNexus graph/AST evidence matrix", re: /gitnexus|context|cypher|impact|trace|query|graph|ast/i },
  { id: "tests_or_not_applicable", label: "тесты/fixtures или обоснованное неприменимо", re: /тест|fixture|фикстур|неприменимо/i },
  { id: "file_name_hits_to_candidates", label: "file-name hits превращены в кандидатные точки реализации", re: /file-name|имен.*файл|соседн.*папк|файлов.*форм|кандидатн.*точк/i },
];

ACCEPTANCE_COVERAGE_GATES.push({
  id: "implementation_entry_points",
  label: "существующие точки входа для доработки",
  re: /существующ.*точк.*вход|точк.*доработк|entry point|карта.*правк/i,
});


const START_POINTS_COVERAGE_GATES = [
  { id: "user_visible_start", label: "пользовательский или внешний старт", re: /ui|пользователь|команд|меню|панел|кнопк|внешн/i },
  { id: "integration_start", label: "интеграционный/продуктовый старт", re: /frontend|product|host|интеграц|продукт|хост|слой/i },
  { id: "programmatic_start", label: "программный вход или публичный контракт", re: /api|dto|публичн|контракт|метод|вызов|команд/i },
  { id: "readback_start", label: "selection/readback или обратное чтение", re: /readback|selection|выбор|чтени|возвращ/i },
  { id: "defaults_styles_start", label: "defaults/templates/theme/style/inheritance", re: /default|template|theme|style|inherit|умолчан|шаблон|тем|стил|наслед/i },
  { id: "import_open_paste_start", label: "import/open/paste источник", re: /import|open|paste|импорт|открыт|встав/i },
  { id: "tests_start", label: "tests/fixtures или явное неприменимо", re: /test|fixture|тест|фикстур|неприменимо/i },
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
  "fixture",
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
  "test",
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
  "api style",
];

const TOO_GENERIC_CANDIDATE_VALUES = new Set([
  "api", "dto", "render", "renderer", "controller", "output", "readback",
  "defaults", "theme", "style", "object", "file", "method", "property", "class", "helper",
  "слой", "объект", "файл", "метод", "свойство",
]);
const CRITICAL_PATHS_COVERAGE_GATES = [
  { id: "source_to_state_to_output", label: "source/import/open/paste -> state -> output", re: /(source|import|open|paste|источник|импорт|открыт|встав).*(state|состоя).*(output|вывод|результ|отрис|export|экспорт)/i },
  { id: "user_to_state_to_output", label: "user/API/action -> state -> output", re: /(user|api|action|пользователь|команд|действ|вызов).*(state|состоя).*(output|вывод|результ|отрис|export|экспорт)/i },
  { id: "state_to_save_export", label: "state -> save/export", re: /(state|состоя).*(save|export|сохран|экспорт)/i },
  { id: "additional_lifecycle", label: "дополнительные lifecycle пути или неприменимо", re: /undo|redo|copy|paste|preview|print|history|test|отмен|повтор|копир|встав|предпросмотр|печать|истори|тест|неприменимо/i },
];

function usage() {
  console.log("Usage: node validate_inventory_report.js <report.md> [--json] [--strict] [--warnings-as-errors]");
}

function parseArgs(argv) {
  const args = { file: "", json: false, strict: false, warningsAsErrors: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--strict") {
      args.strict = true;
    } else if (arg === "--warnings-as-errors") {
      args.warningsAsErrors = true;
    } else if (!args.file) {
      args.file = arg;
    }
  }
  if (!args.file) {
    usage();
    process.exit(2);
  }
  return args;
}

function normalize(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isKnownBareSection(line) {
  const title = line.trim();
  if (!title || title.length > 80) return false;
  if (REQUIRED_SECTIONS.some((section) => normalize(section) === normalize(title))) return true;
  return normalize(title) === normalize("Приемка Полноты") || normalize(title) === normalize("Gaps И Следующие Проверки") || normalize(title) === normalize(EXECUTION_STATUS_SECTION);
}

function parseSections(lines) {
  const sections = [];
  let current = { title: "__root__", level: 0, start: 0, lines: [] };
  sections.push(current);
  lines.forEach((line, index) => {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (match && match[1].length === 2) {
      current = { title: match[2].trim(), level: 2, start: index + 1, lines: [] };
      sections.push(current);
    } else if (isKnownBareSection(line)) {
      current = { title: line.trim(), level: 2, start: index + 1, lines: [] };
      sections.push(current);
    } else {
      current.lines.push({ text: line, number: index + 1 });
    }
  });
  return sections;
}

function findSection(sections, title) {
  const exact = sections.find((section) => normalize(section.title) === normalize(title));
  if (exact) return exact;
  if (title === "Приемка Полноты Для Задачи Доработки") {
    return sections.find((section) => normalize(section.title) === normalize("Приемка Полноты"));
  }
  return null;
}

function tsvToTableLine(line) {
  return `| ${line.split("\t").map((cell) => cell.trim()).join(" | ")} |`;
}

function separatorForHeader(line) {
  const count = splitRow(line).length;
  return `| ${Array.from({ length: count }, () => "---").join(" | ")} |`;
}

function findTables(section) {
  const tables = [];
  let i = 0;
  while (i < section.lines.length) {
    const line = section.lines[i].text;
    if (/^\s*\|/.test(line) && i + 1 < section.lines.length && isSeparator(section.lines[i + 1].text)) {
      const rows = [section.lines[i], section.lines[i + 1]];
      i += 2;
      while (i < section.lines.length && /^\s*\|/.test(section.lines[i].text)) {
        rows.push(section.lines[i]);
        i += 1;
      }
      tables.push({ startLine: rows[0].number, rows });
      continue;
    }
    if (line.includes("\t") && i + 1 < section.lines.length && section.lines[i + 1].text.includes("\t")) {
      const headerLine = { text: tsvToTableLine(section.lines[i].text), number: section.lines[i].number };
      const rows = [headerLine, { text: separatorForHeader(headerLine.text), number: section.lines[i].number }];
      i += 1;
      while (i < section.lines.length && section.lines[i].text.trim() && section.lines[i].text.includes("\t")) {
        rows.push({ text: tsvToTableLine(section.lines[i].text), number: section.lines[i].number });
        i += 1;
      }
      tables.push({ startLine: headerLine.number, rows });
      continue;
    }
    i += 1;
  }
  return tables;
}

function hasExplanation(section, table) {
  const before = section.lines.filter((line) => line.number < table.startLine).slice(-12).map((line) => line.text).join("\n");
  return EXPLANATION_LABELS.every((label) => before.includes(label));
}

function containsCodeEvidence(text) {
  return /\[[^\]]+\]\([^\)]+:\d+\)/.test(text) ||
    /\b[\w.-]+\.(js|ts|jsx|tsx|py|cs|cpp|h|java|json|xml|md)\b/i.test(text) ||
    /\b[A-ZА-Я][A-Za-zА-Яа-я0-9_]*\.(prototype\.)?[A-Za-zА-Яа-я0-9_]+\b/.test(text) ||
    /\b[A-Za-zА-Яа-я0-9_]+\([^)]*\)/.test(text) ||
    /[A-Za-z0-9_.-]+[\\/][A-Za-z0-9_.\\/ -]+/.test(text) ||
    /\b(line|строка)\s*\d+\b/i.test(text);
}

function containsExpectedNames(text) {
  return /[`"«][^`"»]{2,}[`"»]/.test(text) ||
    /\b[A-Za-zА-Яа-я0-9_./*-]{2,}\s*(,|\/|\||;)\s*[A-Za-zА-Яа-я0-9_./*-]{2,}/.test(text) ||
    /\b(ожидаем|искал|проверял|паттерн|термин|имя|признак|ключ|поле|метод|свойств|команд|формат|слой)\b/i.test(text);
}

function containsSearchArea(text) {
  return /[A-Za-z0-9_.-]+[\\/][A-Za-z0-9_.\\/ -]+/.test(text) ||
    /\b[\w.-]+\.(js|ts|jsx|tsx|py|cs|cpp|h|java|json|xml|md|yml|yaml|css|less|scss)\b/i.test(text) ||
    /\b(файл|директор|каталог|модул|пакет|слой|зона|область|секци|таблиц|тест|fixture|фикстур|поиск|rg|grep|паттерн|маск)\b/i.test(text);
}

function isWeakCell(cell) {
  const value = normalize(cell);
  return !value || value === "..." || value === "-" || value === "неприменимо" || WEAK_PHRASES.some((re) => re.test(value));
}

function rowObject(headers, cells) {
  const row = {};
  headers.forEach((header, index) => {
    row[header] = cells[index] || "";
  });
  return row;
}

function findColumn(headers, candidates) {
  const normalized = headers.map(normalize);
  for (const candidate of candidates) {
    const idx = normalized.findIndex((header) => header.includes(normalize(candidate)));
    if (idx !== -1) return idx;
  }
  return -1;
}

function tableDataRows(table) {
  return table.rows.slice(2)
    .map((row) => ({ lineNumber: row.number, cells: splitRow(row.text) }))
    .filter((row) => row.cells.some((cell) => normalize(cell) && normalize(cell) !== "..."));
}

function rowText(row) {
  return row.cells.join(" | ");
}

function validateCoverage(sectionTitle, table, gates, result, severity) {
  const rows = tableDataRows(table);
  for (const gate of gates) {
    const covered = rows.some((row) => gate.re.test(rowText(row)));
    if (!covered) {
      const message = `${sectionTitle}:${table.startLine}: не раскрыт обязательный аспект: ${gate.label}`;
      result[severity === "error" ? "errors" : "warnings"].push(message);
    }
  }
}

function validateCheckedNoUsageRows(sectionTitle, table, result) {
  const headers = splitRow(table.rows[0].text);
  const rows = tableDataRows(table);
  const whatCheckedIndex = findColumn(headers, ["Что проверялось", "Ожидаемые имена", "Ожидаемый путь"]);
  const searchAreaIndex = findColumn(headers, ["Где искалось", "Где искались", "Файл/символ или область поиска", "область поиска"]);
  const foundIndex = findColumn(headers, ["Что найдено", "Найдено", "Расхождение"]);
  const relevanceIndex = findColumn(headers, ["Почему релевантно", "Почему ожидается", "Как выведены", "Вывод"]);

  for (const row of rows) {
    const text = rowText(row).toLowerCase();
    const statesAbsence = /не найден|использования нет|проверено нет|отсутств|покрытия нет/.test(text);
    if (!statesAbsence) continue;

    const whatChecked = whatCheckedIndex >= 0 ? row.cells[whatCheckedIndex] : rowText(row);
    const searchArea = searchAreaIndex >= 0 ? row.cells[searchAreaIndex] : rowText(row);
    const found = foundIndex >= 0 ? row.cells[foundIndex] : rowText(row);
    const relevance = relevanceIndex >= 0 ? row.cells[relevanceIndex] : rowText(row);

    if (!containsExpectedNames(whatChecked)) {
      result.errors.push(`${sectionTitle}:${row.lineNumber}: отрицательное утверждение без ожидаемых признаков/имен в колонке проверки`);
    }
    if (!containsSearchArea(searchArea)) {
      result.errors.push(`${sectionTitle}:${row.lineNumber}: отрицательное утверждение без конкретной области поиска`);
    }
    if (isWeakCell(found)) {
      result.errors.push(`${sectionTitle}:${row.lineNumber}: отрицательное утверждение без результата поиска`);
    }
    if (isWeakCell(relevance)) {
      result.errors.push(`${sectionTitle}:${row.lineNumber}: отрицательное утверждение без объяснения релевантности`);
    }
  }
}

function containsCandidateSymbol(text) {
  const value = normalize(text);
  if (!value || TOO_GENERIC_CANDIDATE_VALUES.has(value)) return false;
  const raw = String(text || "");
  return /[`"«][^`"»]{2,}[`"»]/.test(raw) ||
    /\b[A-Za-zА-Яа-я_$][A-Za-zА-Яа-я0-9_$]*(\.[A-Za-zА-Яа-я_$][A-Za-zА-Яа-я0-9_$]*)+\b/.test(raw) ||
    /\b[A-Za-zА-Яа-я_$][A-Za-zА-Яа-я0-9_$]*(?:\([^)]*\)|[A-Za-zА-Яа-я0-9_$]*[A-ZА-Я][A-Za-zА-Яа-я0-9_$]*)\b/.test(raw);
}

function containsImplementationPlace(text) {
  const value = normalize(text);
  if (!value || TOO_GENERIC_CANDIDATE_VALUES.has(value)) return false;
  const raw = String(text || "");
  return containsSearchArea(raw) || /\b[A-Za-z0-9_.-]+[\\/][A-Za-z0-9_.\\/ -]+\b/.test(raw);
}

function containsOwnerObject(text) {
  const value = normalize(text);
  if (!value || TOO_GENERIC_CANDIDATE_VALUES.has(value)) return false;
  return containsCandidateSymbol(text) || /\b(owner|dto|controller|renderer|recipient|namespace|prototype|shape|image|group|smartart|theme|style)\b/i.test(String(text || ""));
}

function formMatches(formText, expectedForm) {
  return normalize(formText).split(/[,;/|]+/).map((part) => part.trim()).includes(normalize(expectedForm));
}

function hasAnyAllowedForm(formText) {
  return ALLOWED_IMPLEMENTATION_FORMS.some((form) => formMatches(formText, form));
}

function hasAnyAllowedFileForm(fileFormText) {
  const normalized = normalize(fileFormText);
  return ALLOWED_FILE_FORMS.some((form) => normalized.includes(normalize(form))) ||
    /нов(ый|ого) файл|существующ(ий|его) файл|соседн(яя|ей) папк|класс|метод|свойств|рендер|шаблон|получател|тест/i.test(String(fileFormText || ""));
}

function hasDerivationHint(text) {
  const raw = String(text || "");
  const value = normalize(raw);
  return DERIVATION_HINTS.some((hint) => value.includes(normalize(hint))) || /эталон|owner|владел|prototype|сосед|target|style|паттерн|получател|recipient|lower-level/i.test(raw);
}

function candidateLayerMatches(layer, patterns) {
  const value = normalize(layer);
  return patterns.some((pattern) => pattern.test(value));
}

function pushCandidateIssue(result, strict, message) {
  result[strict ? "errors" : "warnings"].push(message);
}

function validateCandidateImplementationRows(sectionTitle, table, result, options) {
  const strict = !!(options && options.strict);
  const headers = splitRow(table.rows[0].text);
  const rows = tableDataRows(table);
  const layerIndex = findColumn(headers, ["Слой"]);
  const candidateIndex = findColumn(headers, ["Ожидаемое имя/место", "Кандидатное имя"]);
  const placeIndex = findColumn(headers, ["Ожидаемый файл/папка", "Ожидаемый файл", "Ожидаемая папка"]);
  const ownerIndex = findColumn(headers, ["Owner object", "Владелец", "Owner"]);
  const formIndex = findColumn(headers, ["Форма реализации", "Тип кандидата"]);
  const derivedIndex = findColumn(headers, ["Как выведено", "Как выведены"]);
  const fileFormIndex = findColumn(headers, ["Файловая форма", "File form", "Форма файла"]);
  const searchIndex = findColumn(headers, ["Где искалось", "Где искались"]);
  const foundIndex = findColumn(headers, ["Что найдено"]);

  for (const row of rows) {
    const layer = layerIndex >= 0 ? row.cells[layerIndex] : "";
    const candidate = candidateIndex >= 0 ? row.cells[candidateIndex] : "";
    const place = placeIndex >= 0 ? row.cells[placeIndex] : "";
    const owner = ownerIndex >= 0 ? row.cells[ownerIndex] : "";
    const form = formIndex >= 0 ? row.cells[formIndex] : "";
    const fileForm = fileFormIndex >= 0 ? row.cells[fileFormIndex] : "";
    const derived = derivedIndex >= 0 ? row.cells[derivedIndex] : "";
    const search = searchIndex >= 0 ? row.cells[searchIndex] : "";
    const found = foundIndex >= 0 ? row.cells[foundIndex] : "";

    if (!containsCandidateSymbol(candidate)) {
      pushCandidateIssue(result, strict, `${sectionTitle}:${row.lineNumber}: ожидаемое имя/место слишком общее или не похоже на точный symbol/method/property`);
    }
    if (!containsImplementationPlace(place)) {
      pushCandidateIssue(result, strict, `${sectionTitle}:${row.lineNumber}: нет точного ожидаемого файла/папки для места реализации пробела`);
    }
    if (!containsOwnerObject(owner)) {
      pushCandidateIssue(result, strict, `${sectionTitle}:${row.lineNumber}: нет конкретного owner object для места реализации пробела`);
    }
    if (!hasAnyAllowedForm(form)) {
      pushCandidateIssue(result, strict, `${sectionTitle}:${row.lineNumber}: форма реализации должна быть одной из: ${ALLOWED_IMPLEMENTATION_FORMS.join(", ")}`);
    }
    if (!hasAnyAllowedFileForm(fileForm)) {
      pushCandidateIssue(result, strict, `${sectionTitle}:${row.lineNumber}: файловая форма должна быть одной из: ${ALLOWED_FILE_FORMS.join(", ")}`);
    }
    if (!hasDerivationHint(derived)) {
      pushCandidateIssue(result, strict, `${sectionTitle}:${row.lineNumber}: \`Как выведено\` не содержит универсального основания вывода имени`);
    }
    if (/не найден|not found|no hits|отсутств/i.test(found) && !containsSearchArea(search)) {
      pushCandidateIssue(result, strict, `${sectionTitle}:${row.lineNumber}: отрицательный результат ожидаемого места реализации без точной области поиска`);
    }
    if (!containsExpectedNames(layer)) {
      pushCandidateIssue(result, strict, `${sectionTitle}:${row.lineNumber}: слой ожидаемого места реализации не указан конкретно`);
    }
  }

  const layerRows = (patterns) => rows.filter((row) => layerIndex >= 0 && candidateLayerMatches(row.cells[layerIndex], patterns));
  const hasFormInRows = (filteredRows, form) => filteredRows.some((row) => formIndex >= 0 && formMatches(row.cells[formIndex], form));
  const requireForms = (label, filteredRows, forms) => {
    if (filteredRows.length === 0) return;
    for (const form of forms) {
      if (!hasFormInRows(filteredRows, form)) {
        pushCandidateIssue(result, strict, `${sectionTitle}:${table.startLine}: слой ${label} требует форму реализации \`${form}\``);
      }
    }
  };

  requireForms("API/DTO", layerRows([/api/, /dto/, /public/, /публич/, /contract/, /контракт/]), ["property", "prototype method", "serializer attr"]);
  requireForms("render/output", layerRows([/render/, /output/, /draw/, /отрис/, /вывод/]), ["renderer", "object-specific draw path"]);
  requireForms("defaults/templates", layerRows([/default/, /template/, /preset/, /умолчан/, /шаблон/]), ["defaults"]);
  requireForms("theme/style/inheritance", layerRows([/theme/, /style/, /inherit/, /тем/, /стил/, /наслед/]), ["readback"]);
}
function tableHasOpenGate(table) {
  const headers = splitRow(table.rows[0].text);
  const statusIndex = findColumn(headers, ["Статус"]);
  const missingIndex = findColumn(headers, ["Что отсутствует"]);
  const rows = tableDataRows(table);
  return rows.some((row) => {
    const status = statusIndex >= 0 ? normalize(row.cells[statusIndex]) : "";
    const missing = missingIndex >= 0 ? normalize(row.cells[missingIndex]) : "";
    return /^(нет|не проверено|не найдено|пробел|неполно|не закрыт)/.test(status) ||
      (!!missing && missing !== "-" && missing !== "нет" && missing !== "неприменимо");
  });
}

function shortSummaryDeclaresIncomplete(sections) {
  const root = sections.find((section) => section.title === "__root__");
  const summary = sections.find((section) => normalize(section.title) === normalize("Короткий Вывод"));
  const text = [...(root?.lines || []), ...(summary?.lines || [])].map((line) => line.text).join("\n");
  return /отчет\s+неполн|неполный\s+отчет/i.test(text);
}

function validateRow(sectionTitle, headers, cells, lineNumber, result) {
  const joined = cells.join(" | ");
  const statusIndex = findColumn(headers, ["Статус"]);
  const status = statusIndex >= 0 ? normalize(cells[statusIndex]) : "";
  const foundIndex = findColumn(headers, ["Что найдено", "Найдено", "Расхождение", "Что отсутствует"]);
  const foundOrMissing = foundIndex >= 0 ? normalize(cells[foundIndex]) : "";
  const hasEvidence = containsCodeEvidence(joined);
  const hasSearchArea = containsSearchArea(joined);
  const hasExpected = containsExpectedNames(joined);
  const weakCells = cells.filter(isWeakCell).length;
  const meaningfulCells = cells.length - weakCells;
  const minMeaningfulCells = sectionTitle === "Приемка Полноты Для Задачи Доработки"
    ? Math.min(3, cells.length)
    : Math.min(4, cells.length);

  if (meaningfulCells < minMeaningfulCells) {
    result.warnings.push(`${sectionTitle}:${lineNumber}: строка выглядит формально заполненной: мало содержательных ячеек`);
  }

  if (/подтвержден|checked|проверено, использования нет|проверено нет/.test(status) && !hasEvidence && !hasSearchArea) {
    result.errors.push(`${sectionTitle}:${lineNumber}: статус требует evidence или точной области поиска`);
  }

  if (/не найден|использования нет|покрытия нет/.test(joined.toLowerCase())) {
    if (!hasExpected) {
      result.errors.push(`${sectionTitle}:${lineNumber}: \`не найдено\` без ожидаемых имен`);
    }
    if (!hasSearchArea) {
      result.errors.push(`${sectionTitle}:${lineNumber}: \`не найдено\` без области поиска`);
    }
  }

  if ((/пробел|gap|отсутств/.test(status) || /пробел|gap|отсутств/.test(foundOrMissing)) && !hasExpected) {
    result.warnings.push(`${sectionTitle}:${lineNumber}: пробел указан без ожидаемого имени или пути`);
  }

  if (/подтвержден/.test(status) && !hasEvidence) {
    result.warnings.push(`${sectionTitle}:${lineNumber}: подтверждение без ссылки на файл, символ или точную область`);
  }

  if (sectionTitle === "Приемка Полноты Для Задачи Доработки") {
    const row = rowObject(headers, cells);
    const statusText = normalize(row[headers[1]] || "");
    const missingText = normalize(row[headers[3]] || "");
    if (statusText === "да" && /^(отсутств|не найден|не проверено|пробел|неполно|не закрыт)/.test(missingText)) {
      result.warnings.push(`${sectionTitle}:${lineNumber}: приемка со статусом \`да\` содержит признаки незакрытого пункта`);
    }
  }
}

function validateTable(sectionTitle, section, table, requiredColumns, result) {
  if (!hasExplanation(section, table)) {
    result.errors.push(`${sectionTitle}:${table.startLine}: перед таблицей нет полного блока Что показывает/Зачем нужна/Как читать/Как использовать`);
  }

  const headers = splitRow(table.rows[0].text);
  const headerSet = new Set(headers.map(normalize));
  for (const column of requiredColumns) {
    if (!headerSet.has(normalize(column))) {
      result.errors.push(`${sectionTitle}:${table.startLine}: нет обязательной колонки \`${column}\``);
    }
  }

  const dataRows = table.rows.slice(2).filter((row) => splitRow(row.text).some((cell) => normalize(cell) && normalize(cell) !== "..."));
  if (dataRows.length === 0) {
    result.errors.push(`${sectionTitle}:${table.startLine}: таблица без строк данных`);
  }

  for (const row of dataRows) {
    const cells = splitRow(row.text);
    validateRow(sectionTitle, headers, cells, row.number, result);
  }
}

function validateFileNameSearchCoverage(sectionTitle, table, result) {
  if (sectionTitle !== "Scope И Seed-Словарь") return;
  const rows = tableDataRows(table);
  const text = rows.map(rowText).join("\n");
  if (!/file-name|им[её]н[а-я]* файлов|имен[а-я]* директор|директор/i.test(text)) {
    result.errors.push(`${sectionTitle}:${table.startLine}: нет подтверждения поиска по именам файлов/директорий`);
  }
}

function hasConcreteImplementationEntry(value) {
  const text = normalize(value);
  if (!text || text === "..." || text === "-" || text === "нет") return false;
  if (/неприменимо/.test(text)) return true;
  if (/[\\/][^\s|]+/.test(value)) return true;
  if (/\b[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\(|#)/.test(value)) return true;
  return /файл|папк|область поиска|метод|свойств|класс|команд|контроллер|получател|serializer|renderer|controller|api|dto|test|fixture/i.test(value);
}

function isFormalImplementationValue(value) {
  const text = normalize(value);
  if (!text || text === "..." || text === "-" || text === "todo") return true;
  return /^(проверить|уточнить|добавить|реализовать|см выше|см\. выше|нет данных|не найдено)$/.test(text);
}

function hasEarlierEvidenceForImplementationEntry(rawBeforeSection, value) {
  const tokens = String(value || "")
    .split(/[^A-Za-zА-Яа-я0-9_$./\\-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 5 && !/^(неприменимо|область|поиска|соседний|эталон|текущий|существующий)$/i.test(token));
  if (tokens.length === 0) return false;
  const raw = rawBeforeSection.toLowerCase();
  return tokens.some((token) => raw.includes(token.toLowerCase()));
}

function validateImplementationEntryPointsRows(sectionTitle, table, result, raw, sections) {
  if (sectionTitle !== IMPLEMENTATION_ENTRY_POINTS_SECTION) return;

  const headers = splitRow(table.rows[0].text);
  const rows = tableDataRows(table);
  const layerIndex = findColumn(headers, ["Слой доработки"]);
  const entryIndex = findColumn(headers, ["Существующая точка входа"]);
  const symbolIndex = findColumn(headers, ["Существующий объект/метод"]);
  const referenceIndex = findColumn(headers, ["Соседний эталон"]);
  const existingIndex = findColumn(headers, ["Что здесь уже есть"]);
  const gapIndex = findColumn(headers, ["Какой пробел закрывать"]);
  const nextIndex = findColumn(headers, ["Куда ведет дальше"]);
  const riskIndex = findColumn(headers, ["Риск если пропустить"]);
  const section = findSection(sections, IMPLEMENTATION_ENTRY_POINTS_SECTION);
  const rawBeforeSection = section ? raw.split(/\r?\n/).slice(0, Math.max(0, section.start - 1)).join("\n") : raw;

  const layerText = rows.map((row) => layerIndex >= 0 ? row.cells[layerIndex] : rowText(row)).join("\n");
  for (const gate of IMPLEMENTATION_ENTRY_POINTS_LAYER_GATES) {
    if (!gate.re.test(layerText)) {
      result.errors.push(sectionTitle + ":" + table.startLine + ": нет обязательного слоя точки входа: " + gate.label);
    }
  }

  for (const row of rows) {
    const get = (index) => index >= 0 ? row.cells[index] : "";
    const entry = get(entryIndex);
    const symbol = get(symbolIndex);
    const reference = get(referenceIndex);
    const existing = get(existingIndex);
    const gap = get(gapIndex);
    const next = get(nextIndex);
    const risk = get(riskIndex);

    for (const pair of [
      ["Существующая точка входа", entry],
      ["Существующий объект/метод", symbol],
      ["Что здесь уже есть", existing],
      ["Какой пробел закрывать", gap],
      ["Куда ведет дальше", next],
      ["Риск если пропустить", risk],
    ]) {
      if (isFormalImplementationValue(pair[1])) {
        result.errors.push(sectionTitle + ":" + row.lineNumber + ": колонка '" + pair[0] + "' заполнена формально");
      }
    }

    if (!hasConcreteImplementationEntry(entry)) {
      result.errors.push(sectionTitle + ":" + row.lineNumber + ": 'Существующая точка входа' должна содержать текущий файл, объект, метод или точную область поиска");
    }
    if (!hasConcreteImplementationEntry(symbol)) {
      result.errors.push(sectionTitle + ":" + row.lineNumber + ": 'Существующий объект/метод' должен содержать объект, метод, свойство или обоснованное 'неприменимо'");
    }
    if (/будущ|new file|создать|новый файл/i.test(entry) && !/существ|current|existing|область поиска/i.test(entry)) {
      result.errors.push(sectionTitle + ":" + row.lineNumber + ": точка входа похожа на будущий файл, а не на существующую точку текущего кода");
    }
    if (!hasEarlierEvidenceForImplementationEntry(rawBeforeSection, entry + " " + symbol + " " + reference + " " + existing)) {
      result.errors.push(sectionTitle + ":" + row.lineNumber + ": точка входа не связана с доказательствами в предыдущих разделах");
    }
  }
}


function validateSectionCoverage(sectionTitle, table, result, options, raw, sections) {
  validateImplementationEntryPointsRows(sectionTitle, table, result, raw, sections);
  if (sectionTitle === "Приемка Полноты Для Задачи Доработки") {
    validateCoverage(sectionTitle, table, ACCEPTANCE_COVERAGE_GATES, result, "error");
  } else if (sectionTitle === "Точки Старта И Ожидаемые Имена") {
    validateCoverage(sectionTitle, table, START_POINTS_COVERAGE_GATES, result, "warning");
  } else if (sectionTitle === "Критические Пути") {
    validateCoverage(sectionTitle, table, CRITICAL_PATHS_COVERAGE_GATES, result, "warning");
  } else if (sectionTitle === "Кандидатные Имена Для Пробелов" ||
      sectionTitle === "Где Ожидалась Реализация Пробелов") {
    validateCandidateImplementationRows(sectionTitle, table, result, options);
  }

  if (sectionTitle === "Usage Inventory И Checked No Usage" ||
      sectionTitle === "Точки Старта И Ожидаемые Имена" ||
      sectionTitle === "Эталонные Пути И Пробелы" ||
      sectionTitle === "Где Ожидалась Реализация Пробелов" ||
      sectionTitle === "Приемка Полноты Для Задачи Доработки") {
    validateCheckedNoUsageRows(sectionTitle, table, result);
  }
}

function validateExecutionStatus(sections, result) {
  const section = findSection(sections, EXECUTION_STATUS_SECTION);
  if (!section) {
    result.errors.push("Статус Выполнения: неполный отчет обязан содержать этот раздел с этапами, текущим артефактом и способом продолжения");
    return;
  }

  const tables = findTables(section);
  if (tables.length === 0) {
    result.errors.push("Статус Выполнения: нет таблицы статуса этапов");
    return;
  }

  validateTable(EXECUTION_STATUS_SECTION, section, tables[0], EXECUTION_STATUS_COLUMNS, result);

  const headers = splitRow(tables[0].rows[0].text);
  const rows = tableDataRows(tables[0]);
  const stageIndex = findColumn(headers, ["Этап"]);
  const statusIndex = findColumn(headers, ["Статус"]);
  const nextIndex = findColumn(headers, ["Следующий шаг"]);
  const artifactIndex = findColumn(headers, ["Артефакт"]);
  const stageText = rows.map((row) => stageIndex >= 0 ? row.cells[stageIndex] : rowText(row)).join("\n");

  for (let i = 0; i <= 8; i += 1) {
    if (!new RegExp("(^|\\D)" + i + "\\.", "m").test(stageText)) {
      result.errors.push("Статус Выполнения:" + tables[0].startLine + ": нет строки для этапа " + i);
    }
  }

  const body = section.lines.map((line) => line.text).join("\n");
  for (const label of ["Режим", "Текущий артефакт", "Как продолжить"]) {
    if (!new RegExp(label, "i").test(body)) {
      result.errors.push("Статус Выполнения: нет поля `" + label + "`");
    }
  }
  if (!/продолжай|automatic continuation|активн(?:ая|ой|ую)\s+цел/i.test(body)) {
    result.errors.push("Статус Выполнения: нет интерактивной или goal-инструкции продолжения");
  }

  for (const row of rows) {
    const status = statusIndex >= 0 ? normalize(row.cells[statusIndex]) : "";
    const next = nextIndex >= 0 ? normalize(row.cells[nextIndex]) : "";
    const artifact = artifactIndex >= 0 ? normalize(row.cells[artifactIndex]) : "";
    const open = /частично|не начат|не закрыт|нет|не проверено|неполно/.test(status);
    if (open && (!next || next === "..." || next === "-" || next === "нет" || next === "неприменимо")) {
      result.errors.push("Статус Выполнения:" + row.lineNumber + ": открытый этап без следующего шага");
    }
    if (open && (!artifact || artifact === "..." || artifact === "-")) {
      if (REQUIRE_STAGE_ARTIFACT_FOR_OPEN_STATUS) {
        result.errors.push("Статус Выполнения:" + row.lineNumber + ": открытый этап без текущего артефакта");
      } else {
        result.warnings.push("Статус Выполнения:" + row.lineNumber + ": открытый этап без текущего артефакта");
      }
    }
  }
}

function validate(raw, options = {}) {
  const result = { ok: true, errors: [], warnings: [], strict: !!options.strict };
  for (const marker of REQUIRED_STAGE_MARKERS) {
    if (!raw.includes(marker)) {
      result.errors.push(`Нет обязательного этапа: ${marker}`);
    }
  }

  const dodCount = (raw.match(/DoD этапа/g) || []).length;
  if (dodCount < REQUIRED_STAGE_MARKERS.length) {
    result.errors.push(`Недостаточно DoD этапов: найдено ${dodCount}, ожидается ${REQUIRED_STAGE_MARKERS.length}`);
  }
  const lines = raw.split(/\r?\n/);
  const sections = parseSections(lines);
  let acceptanceTable = null;

  for (const title of REQUIRED_SECTIONS) {
    const section = findSection(sections, title);
    if (!section) {
      result.errors.push(`Нет обязательной секции: ${title}`);
      continue;
    }
    const tables = findTables(section);
    if (tables.length === 0) {
      result.errors.push(`${title}: нет обязательной таблицы`);
      continue;
    }
    validateTable(title, section, tables[0], REQUIRED_COLUMNS[title], result);
    validateSectionCoverage(title, tables[0], result, options, raw, sections);
    validateFileNameSearchCoverage(title, tables[0], result);
    if (title === "Приемка Полноты Для Задачи Доработки") {
      acceptanceTable = tables[0];
    }
  }

  const allTables = sections.flatMap((section) => findTables(section).map((table) => ({ section, table })));
  for (const { section, table } of allTables) {
    if (!hasExplanation(section, table)) {
      result.errors.push(`${section.title}:${table.startLine}: таблица без полной расшифровки`);
    }
  }

  if (acceptanceTable && tableHasOpenGate(acceptanceTable) && !shortSummaryDeclaresIncomplete(sections)) {
    result.errors.push("Короткий Вывод: приемка содержит незакрытые пункты, но нет явного статуса `Отчет неполный`");
  }

  const needsExecutionStatus = (acceptanceTable && tableHasOpenGate(acceptanceTable)) || shortSummaryDeclaresIncomplete(sections) || result.errors.length > 0;
  if (needsExecutionStatus) {
    validateExecutionStatus(sections, result);
  }

  result.ok = result.errors.length === 0;
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = path.resolve(args.file);
  if (!fs.existsSync(file)) {
    console.error(`Report not found: ${file}`);
    process.exit(2);
  }
  const raw = fs.readFileSync(file, "utf8");
  const result = validate(raw, { strict: args.strict });
  if (args.warningsAsErrors && result.warnings.length > 0) {
    result.errors.push(...result.warnings.map((warning) => `WARN-AS-ERROR: ${warning}`));
    result.warnings = [];
    result.ok = false;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.ok ? "OK: inventory report validation passed" : "FAILED: inventory report validation failed");
    for (const error of result.errors) console.log(`ERROR: ${error}`);
    for (const warning of result.warnings) console.log(`WARN: ${warning}`);
  }
  process.exit(result.ok ? 0 : 1);
}

main();


