"use strict";
const { EXPLANATION_LABELS, ACCEPTANCE_COVERAGE_GATES, START_POINTS_COVERAGE_GATES, CRITICAL_PATHS_COVERAGE_GATES, EXECUTION_STATUS_SECTION, EXECUTION_STATUS_COLUMNS, REQUIRE_STAGE_ARTIFACT_FOR_OPEN_STATUS } = require("../requirements.js");
const { tableDataRows, rowText, splitRow, findColumn, normalize, rowObject, findSection, findTables } = require("../parser.js");
const { containsExpectedNames, containsSearchArea, isWeakCell, containsCodeEvidence } = require("./evidence.js");
const { validateImplementationEntryPointsRows, validateCandidateImplementationRows } = require("./implementation.js");
function hasExplanation(section, table) {
    const before = section.lines.filter((line)=>line.number < table.startLine).slice(-12).map((line)=>line.text).join("\n");
    return EXPLANATION_LABELS.every((label)=>before.includes(label));
}
function validateCoverage(sectionTitle, table, gates, result, severity) {
    const rows = tableDataRows(table);
    for (const gate of gates){
        const covered = rows.some((row)=>gate.re.test(rowText(row)));
        if (!covered) {
            const message = `${sectionTitle}:${table.startLine}: не раскрыт обязательный аспект: ${gate.label}`;
            result[severity === "error" ? "errors" : "warnings"].push(message);
        }
    }
}
function validateCheckedNoUsageRows(sectionTitle, table, result) {
    const headers = splitRow(table.rows[0].text);
    const rows = tableDataRows(table);
    const whatCheckedIndex = findColumn(headers, [
        "Что проверялось",
        "Ожидаемые имена",
        "Ожидаемый путь"
    ]);
    const searchAreaIndex = findColumn(headers, [
        "Где искалось",
        "Где искались",
        "Файл/символ или область поиска",
        "область поиска"
    ]);
    const foundIndex = findColumn(headers, [
        "Что найдено",
        "Найдено",
        "Расхождение"
    ]);
    const relevanceIndex = findColumn(headers, [
        "Почему релевантно",
        "Почему ожидается",
        "Как выведены",
        "Вывод"
    ]);
    for (const row of rows){
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
function tableHasOpenGate(table) {
    const headers = splitRow(table.rows[0].text);
    const statusIndex = findColumn(headers, [
        "Статус"
    ]);
    const missingIndex = findColumn(headers, [
        "Что отсутствует"
    ]);
    const rows = tableDataRows(table);
    return rows.some((row)=>{
        const status = statusIndex >= 0 ? normalize(row.cells[statusIndex]) : "";
        const missing = missingIndex >= 0 ? normalize(row.cells[missingIndex]) : "";
        return /^(нет|не проверено|не найдено|пробел|неполно|не закрыт)/.test(status) || !!missing && missing !== "-" && missing !== "нет" && missing !== "неприменимо";
    });
}
function shortSummaryDeclaresIncomplete(sections) {
    const root = sections.find((section)=>section.title === "__root__");
    const summary = sections.find((section)=>normalize(section.title) === normalize("Короткий Вывод"));
    const text = [
        ...root?.lines || [],
        ...summary?.lines || []
    ].map((line)=>line.text).join("\n");
    return /отчет\s+неполн|неполный\s+отчет/i.test(text);
}
function validateRow(sectionTitle, headers, cells, lineNumber, result) {
    const joined = cells.join(" | ");
    const statusIndex = findColumn(headers, [
        "Статус"
    ]);
    const status = statusIndex >= 0 ? normalize(cells[statusIndex]) : "";
    const foundIndex = findColumn(headers, [
        "Что найдено",
        "Найдено",
        "Расхождение",
        "Что отсутствует"
    ]);
    const foundOrMissing = foundIndex >= 0 ? normalize(cells[foundIndex]) : "";
    const hasEvidence = containsCodeEvidence(joined);
    const hasSearchArea = containsSearchArea(joined);
    const hasExpected = containsExpectedNames(joined);
    const weakCells = cells.filter(isWeakCell).length;
    const meaningfulCells = cells.length - weakCells;
    const minMeaningfulCells = sectionTitle === "Приемка Полноты Для Задачи Доработки" ? Math.min(3, cells.length) : Math.min(4, cells.length);
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
    for (const column of requiredColumns){
        if (!headerSet.has(normalize(column))) {
            result.errors.push(`${sectionTitle}:${table.startLine}: нет обязательной колонки \`${column}\``);
        }
    }
    const dataRows = table.rows.slice(2).filter((row)=>splitRow(row.text).some((cell)=>normalize(cell) && normalize(cell) !== "..."));
    if (dataRows.length === 0) {
        result.errors.push(`${sectionTitle}:${table.startLine}: таблица без строк данных`);
    }
    for (const row of dataRows){
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
function validateSectionCoverage(sectionTitle, table, result, options, raw, sections) {
    validateImplementationEntryPointsRows(sectionTitle, table, result, raw, sections);
    if (sectionTitle === "Приемка Полноты Для Задачи Доработки") {
        validateCoverage(sectionTitle, table, ACCEPTANCE_COVERAGE_GATES, result, "error");
    } else if (sectionTitle === "Точки Старта И Ожидаемые Имена") {
        validateCoverage(sectionTitle, table, START_POINTS_COVERAGE_GATES, result, "warning");
    } else if (sectionTitle === "Критические Пути") {
        validateCoverage(sectionTitle, table, CRITICAL_PATHS_COVERAGE_GATES, result, "warning");
    } else if (sectionTitle === "Кандидатные Имена Для Пробелов" || sectionTitle === "Где Ожидалась Реализация Пробелов") {
        validateCandidateImplementationRows(sectionTitle, table, result, options);
    }
    if (sectionTitle === "Usage Inventory И Checked No Usage" || sectionTitle === "Точки Старта И Ожидаемые Имена" || sectionTitle === "Эталонные Пути И Пробелы" || sectionTitle === "Где Ожидалась Реализация Пробелов" || sectionTitle === "Приемка Полноты Для Задачи Доработки") {
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
    const stageIndex = findColumn(headers, [
        "Этап"
    ]);
    const statusIndex = findColumn(headers, [
        "Статус"
    ]);
    const nextIndex = findColumn(headers, [
        "Следующий шаг"
    ]);
    const artifactIndex = findColumn(headers, [
        "Артефакт"
    ]);
    const stageText = rows.map((row)=>stageIndex >= 0 ? row.cells[stageIndex] : rowText(row)).join("\n");
    for(let i = 0; i <= 8; i += 1){
        if (!new RegExp("(^|\\D)" + i + "\\.", "m").test(stageText)) {
            result.errors.push("Статус Выполнения:" + tables[0].startLine + ": нет строки для этапа " + i);
        }
    }
    const body = section.lines.map((line)=>line.text).join("\n");
    for (const label of [
        "Режим",
        "Текущий артефакт",
        "Как продолжить"
    ]){
        if (!new RegExp(label, "i").test(body)) {
            result.errors.push("Статус Выполнения: нет поля `" + label + "`");
        }
    }
    if (!/продолжай|automatic continuation|активн(?:ая|ой|ую)\s+цел/i.test(body)) {
        result.errors.push("Статус Выполнения: нет интерактивной или goal-инструкции продолжения");
    }
    for (const row of rows){
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
module.exports = {
    validateTable,
    validateSectionCoverage,
    validateFileNameSearchCoverage,
    hasExplanation,
    tableHasOpenGate,
    shortSummaryDeclaresIncomplete,
    validateExecutionStatus
};
