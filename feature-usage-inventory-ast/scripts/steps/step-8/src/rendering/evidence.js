"use strict";
const { absenceProjection } = require("../../../../shared/report/src/model/projection.js");
const { refs, esc, section, meaning, notes, sourceLabel, semantic } = require("./markdown.js");
function renderEvidence(model) {
    const evidence = model.evidenceIndex.map((x)=>[
            x.id + ' <a id="' + esc(x.id).replace(/"/g, "&quot;") + '"></a>',
            sourceLabel(x),
            x.line || "",
            x.symbol || x.anchor || "",
            meaning(x) + "; " + (x.status || "unknown")
        ]);
    const usages = model.confirmedUsages.map((x)=>[
            x.id,
            meaning(x),
            [x.status || "unknown", notes(x)].filter(Boolean).join("; "),
            x.consequence || "",
            refs(x, model)
        ]);
    const absence = absenceProjection(model);
    const references = model.referenceOnly.map((x)=>[
            x.id,
            x.relation || "",
            x.consequence || "",
            refs(x, model)
        ]);
    const noise = model.noise.map((x)=>[
            x.id,
            x.category || "",
            typeof x.scope === "string" ? x.scope : JSON.stringify(x.scope || {}),
            x.reason || ""
        ]);
    return `# Доказательная база: ${esc(model.target)}\n\n${section(model.confirmedUsages.every(x => ["confirmed", "source-confirmed"].includes(x.status)) ? "Подтверждённые выводы" : "Выводы и кандидаты", "выводы, уровень доказательства и ссылки на исходники", "обеспечивает трассируемость итоговых утверждений", [
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
