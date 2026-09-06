"use strict";
const { absenceProjection } = require("../../../../shared/report/src/model/projection.js");
const { canonicalJson } = require("../../../../shared/report/src/model/serialization.js");
const { validateReportModel } = require("../../../../shared/report/src/model/validation.js");
const { refs, esc, section } = require("./markdown.js");
function renderEvidence(model) {
    const evidence = model.evidenceIndex.map((x)=>[
            x.id,
            x.file || (typeof x.scope === "string" ? x.scope : JSON.stringify(x.scope || {})),
            x.line || "",
            x.symbol || x.anchor || "",
            x.result || x.summary || ""
        ]);
    const usages = model.confirmedUsages.map((x)=>[
            x.id,
            x.role || x.title || "",
            x.result || "",
            x.consequence || "",
            refs(x)
        ]);
    const absence = absenceProjection(model);
    const references = model.referenceOnly.map((x)=>[
            x.id,
            x.relation || "",
            x.consequence || "",
            refs(x)
        ]);
    const noise = model.noise.map((x)=>[
            x.id,
            x.category || "",
            typeof x.scope === "string" ? x.scope : JSON.stringify(x.scope || {}),
            x.reason || ""
        ]);
    return `# Доказательная база: ${esc(model.target)}\n\n${section("Подтверждённые выводы", "выводы и их evidence-ссылки", "обеспечивает трассируемость итоговых утверждений", [
        "ID",
        "Роль",
        "Результат",
        "Следствие",
        "Доказательства"
    ], usages)}\n${section("Проверенное отсутствие использования", "проверки отсутствия", "отделяет подтверждённое отсутствие от неизвестности", [
        "ID",
        "Источник",
        "Ожидаемые имена",
        "Основание",
        "Репозиторий",
        "Область",
        "Проверки",
        "Порядки",
        "Связующие механизмы",
        "Полнота",
        "Усечение",
        "Следствие",
        "Статус",
        "Сценарии",
        "Получатели",
        "Пути",
        "Пробелы",
        "Возможности",
        "Тестовые поверхности",
        "Доказательства"
    ], absence)}\n${section("Эталонные подтверждения", "reference-only наблюдения", "не позволяет смешивать текущую реализацию с эталоном", [
        "ID",
        "Связь",
        "Следствие",
        "Доказательства"
    ], references)}\n${section("Шум и исключения", "отфильтрованные нерелевантные области", "объясняет границы поиска", [
        "ID",
        "Категория",
        "Область",
        "Причина"
    ], noise)}\n${section("Полный индекс источников", "конкретные исходные доказательства", "позволяет перейти от любого вывода к файлу и строке", [
        "ID",
        "Файл или область",
        "Строка",
        "Символ",
        "Результат"
    ], evidence)}\n`;
}
module.exports = {
    renderEvidence
};
