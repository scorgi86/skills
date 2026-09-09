"use strict";
const { REQUIRED_STAGE_MARKERS, REQUIRED_SECTIONS, REQUIRED_COLUMNS } = require("./requirements.js");
const { parseSections, findSection, findTables } = require("./parser.js");
const { validateTable, validateSectionCoverage, validateFileNameSearchCoverage, hasExplanation, tableHasOpenGate, shortSummaryDeclaresIncomplete, validateExecutionStatus } = require("./rules/report.js");
function validate(raw, options = {}) {
    const result = {
        ok: true,
        errors: [],
        warnings: [],
        strict: !!options.strict
    };
    for (const marker of REQUIRED_STAGE_MARKERS){
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
    for (const title of REQUIRED_SECTIONS){
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
    const allTables = sections.flatMap((section)=>findTables(section).map((table)=>({
                section,
                table
            })));
    for (const { section, table } of allTables){
        if (!hasExplanation(section, table)) {
            result.errors.push(`${section.title}:${table.startLine}: таблица без полной расшифровки`);
        }
    }
    if (acceptanceTable && tableHasOpenGate(acceptanceTable) && !shortSummaryDeclaresIncomplete(sections)) {
        result.errors.push("Короткий Вывод: приемка содержит незакрытые пункты, но нет явного статуса `Отчет неполный`");
    }
    const needsExecutionStatus = acceptanceTable && tableHasOpenGate(acceptanceTable) || shortSummaryDeclaresIncomplete(sections) || result.errors.length > 0;
    if (needsExecutionStatus) {
        validateExecutionStatus(sections, result);
    }
    result.ok = result.errors.length === 0;
    return result;
}
module.exports = {
    validate
};
