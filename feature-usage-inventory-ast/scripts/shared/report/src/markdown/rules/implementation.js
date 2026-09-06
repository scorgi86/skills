"use strict";
const { normalize, splitRow, tableDataRows, findColumn, findSection, rowText } = require("../parser.js");
const { TOO_GENERIC_CANDIDATE_VALUES, ALLOWED_IMPLEMENTATION_FORMS, ALLOWED_FILE_FORMS, DERIVATION_HINTS, IMPLEMENTATION_ENTRY_POINTS_SECTION, IMPLEMENTATION_ENTRY_POINTS_LAYER_GATES } = require("../requirements.js");
const { containsSearchArea, containsExpectedNames } = require("./evidence.js");
function containsCandidateSymbol(text) {
    const value = normalize(text);
    if (!value || TOO_GENERIC_CANDIDATE_VALUES.has(value)) return false;
    const raw = String(text || "");
    return /[`"«][^`"»]{2,}[`"»]/.test(raw) || /\b[A-Za-zА-Яа-я_$][A-Za-zА-Яа-я0-9_$]*(\.[A-Za-zА-Яа-я_$][A-Za-zА-Яа-я0-9_$]*)+\b/.test(raw) || /\b[A-Za-zА-Яа-я_$][A-Za-zА-Яа-я0-9_$]*(?:\([^)]*\)|[A-Za-zА-Яа-я0-9_$]*[A-ZА-Я][A-Za-zА-Яа-я0-9_$]*)\b/.test(raw);
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
    return containsCandidateSymbol(text) || /\b(owner|adapter|consumer|namespace|prototype|container|registry|output)\b/i.test(String(text || ""));
}
function formMatches(formText, expectedForm) {
    return normalize(formText).split(/[,;/|]+/).map((part)=>part.trim()).includes(normalize(expectedForm));
}
function hasAnyAllowedForm(formText) {
    return ALLOWED_IMPLEMENTATION_FORMS.some((form)=>formMatches(formText, form));
}
function hasAnyAllowedFileForm(fileFormText) {
    const normalized = normalize(fileFormText);
    return ALLOWED_FILE_FORMS.some((form)=>normalized.includes(normalize(form))) || /нов(ый|ого) файл|существующ(ий|его) файл|соседн(яя|ей) папк|класс|метод|свойств|рендер|шаблон|получател|тест/i.test(String(fileFormText || ""));
}
function hasDerivationHint(text) {
    const raw = String(text || "");
    const value = normalize(raw);
    return DERIVATION_HINTS.some((hint)=>value.includes(normalize(hint))) || /эталон|owner|владел|prototype|сосед|target|style|паттерн|получател|recipient|lower-level/i.test(raw);
}
function candidateLayerMatches(layer, patterns) {
    const value = normalize(layer);
    return patterns.some((pattern)=>pattern.test(value));
}
function pushCandidateIssue(result, strict, message) {
    result[strict ? "errors" : "warnings"].push(message);
}
function validateCandidateImplementationRows(sectionTitle, table, result, options) {
    const strict = !!(options && options.strict);
    const headers = splitRow(table.rows[0].text);
    const rows = tableDataRows(table);
    const layerIndex = findColumn(headers, [
        "Слой"
    ]);
    const candidateIndex = findColumn(headers, [
        "Ожидаемое имя/место",
        "Кандидатное имя"
    ]);
    const placeIndex = findColumn(headers, [
        "Ожидаемый файл/папка",
        "Ожидаемый файл",
        "Ожидаемая папка"
    ]);
    const ownerIndex = findColumn(headers, [
        "Owner object",
        "Владелец",
        "Owner"
    ]);
    const formIndex = findColumn(headers, [
        "Форма реализации",
        "Тип кандидата"
    ]);
    const derivedIndex = findColumn(headers, [
        "Как выведено",
        "Как выведены"
    ]);
    const fileFormIndex = findColumn(headers, [
        "Файловая форма",
        "File form",
        "Форма файла"
    ]);
    const searchIndex = findColumn(headers, [
        "Где искалось",
        "Где искались"
    ]);
    const foundIndex = findColumn(headers, [
        "Что найдено"
    ]);
    for (const row of rows){
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
    const layerRows = (patterns)=>rows.filter((row)=>layerIndex >= 0 && candidateLayerMatches(row.cells[layerIndex], patterns));
    const hasFormInRows = (filteredRows, form)=>filteredRows.some((row)=>formIndex >= 0 && formMatches(row.cells[formIndex], form));
    const requireForms = (label, filteredRows, forms)=>{
        if (filteredRows.length === 0) return;
        for (const form of forms){
            if (!hasFormInRows(filteredRows, form)) {
                pushCandidateIssue(result, strict, `${sectionTitle}:${table.startLine}: слой ${label} требует форму реализации \`${form}\``);
            }
        }
    };
    requireForms("API/DTO", layerRows([
        /api/,
        /dto/,
        /public/,
        /публич/,
        /contract/,
        /контракт/
    ]), [
        "property",
        "prototype method",
        "serializer attr"
    ]);
    requireForms("render/output", layerRows([
        /render/,
        /output/,
        /draw/,
        /отрис/,
        /вывод/
    ]), [
        "renderer",
        "object-specific draw path"
    ]);
    requireForms("defaults/templates", layerRows([
        /default/,
        /template/,
        /preset/,
        /умолчан/,
        /шаблон/
    ]), [
        "defaults"
    ]);
    requireForms("theme/style/inheritance", layerRows([
        /theme/,
        /style/,
        /inherit/,
        /тем/,
        /стил/,
        /наслед/
    ]), [
        "readback"
    ]);
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
    const tokens = String(value || "").split(/[^A-Za-zА-Яа-я0-9_$./\\-]+/).map((token)=>token.trim()).filter((token)=>token.length >= 5 && !/^(неприменимо|область|поиска|соседний|эталон|текущий|существующий)$/i.test(token));
    if (tokens.length === 0) return false;
    const raw = rawBeforeSection.toLowerCase();
    return tokens.some((token)=>raw.includes(token.toLowerCase()));
}
function validateImplementationEntryPointsRows(sectionTitle, table, result, raw, sections) {
    if (sectionTitle !== IMPLEMENTATION_ENTRY_POINTS_SECTION) return;
    const headers = splitRow(table.rows[0].text);
    const rows = tableDataRows(table);
    const layerIndex = findColumn(headers, [
        "Слой доработки"
    ]);
    const entryIndex = findColumn(headers, [
        "Существующая точка входа"
    ]);
    const symbolIndex = findColumn(headers, [
        "Существующий объект/метод"
    ]);
    const referenceIndex = findColumn(headers, [
        "Соседний эталон"
    ]);
    const existingIndex = findColumn(headers, [
        "Что здесь уже есть"
    ]);
    const gapIndex = findColumn(headers, [
        "Какой пробел закрывать"
    ]);
    const nextIndex = findColumn(headers, [
        "Куда ведет дальше"
    ]);
    const riskIndex = findColumn(headers, [
        "Риск если пропустить"
    ]);
    const section = findSection(sections, IMPLEMENTATION_ENTRY_POINTS_SECTION);
    const rawBeforeSection = section ? raw.split(/\r?\n/).slice(0, Math.max(0, section.start - 1)).join("\n") : raw;
    const layerText = rows.map((row)=>layerIndex >= 0 ? row.cells[layerIndex] : rowText(row)).join("\n");
    for (const gate of IMPLEMENTATION_ENTRY_POINTS_LAYER_GATES){
        if (!gate.re.test(layerText)) {
            result.errors.push(sectionTitle + ":" + table.startLine + ": нет обязательного слоя точки входа: " + gate.label);
        }
    }
    for (const row of rows){
        const get = (index)=>index >= 0 ? row.cells[index] : "";
        const entry = get(entryIndex);
        const symbol = get(symbolIndex);
        const reference = get(referenceIndex);
        const existing = get(existingIndex);
        const gap = get(gapIndex);
        const next = get(nextIndex);
        const risk = get(riskIndex);
        for (const pair of [
            [
                "Существующая точка входа",
                entry
            ],
            [
                "Существующий объект/метод",
                symbol
            ],
            [
                "Что здесь уже есть",
                existing
            ],
            [
                "Какой пробел закрывать",
                gap
            ],
            [
                "Куда ведет дальше",
                next
            ],
            [
                "Риск если пропустить",
                risk
            ]
        ]){
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
module.exports = {
    validateImplementationEntryPointsRows,
    validateCandidateImplementationRows
};
