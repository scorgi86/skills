"use strict";
const { refs, esc, section, meaning, notes, sourceLabel, semantic, coverageSummary } = require("./markdown.js");
function renderImplementation(model) {
    const ownership = model.ownership.map((x)=>[
            x.id,
            meaning(x) + (x.object ? "; " + semantic(x.object) : ""),
            x.order ?? "",
            [x.role, notes(x)].filter(Boolean).join("; "),
            x.relation || "",
            x.status,
            refs(x, model)
        ]);
    const dictionary = model.dictionary.map((x)=>[
            x.id,
            meaning(x),
            x.order ?? "",
            (x.relations || []).join("; "),
            x.status
        ]);
    const scenarios = model.scenarios.map((x)=>[
            x.id,
            meaning(x),
            typeof x.scope === "string" ? x.scope : JSON.stringify(x.scope || {}),
            x.status,
            refs(x, model)
        ]);
    const recipients = model.recipientFamilies.map((x)=>[
            x.id,
            meaning(x),
            x.relation || "",
            x.totalMatches ?? "",
            x.status,
            refs(x, model)
        ]);
    const paths = model.criticalPaths.map((x)=>[
            x.id,
            meaning(x),
            x.status || "unknown",
            refs(x, model)
        ]);
    const references = model.referencePaths.map((x)=>[
            x.id,
            x.layer || "",
            x.path || "",
            [...new Set([x.role, ...(x.roles || [])].filter(Boolean))].join("; ") || x.name || "",
            x.status,
            refs(x, model)
        ]);
    const entries = model.implementationEntryPoints.map((x)=>[
            x.id,
            x.layer || "",
            x.path || "",
            meaning(x),
            (x.gapRefs || []).join(", "),
            x.status,
            refs(x, model)
        ]);
    return `# Карта реализации: ${esc(model.target)}\n\n${coverageSummary(model)}${section("Владение", "цепочку владения сущностью", "показывает, где хранится и передаётся состояние", [
        "ID",
        "Объект",
        "Порядок",
        "Роль",
        "Связь",
        "Статус",
        "Доказательства"
    ], ownership)}\n${section("Словарь и переходы имён", "объекты и связи, расширившие поиск", "помогает проследить переход между слоями", [
        "ID",
        "Термин",
        "Порядок",
        "Связи",
        "Статус"
    ], dictionary)}\n${section("Сценарии", "пользовательские и технические старты", "показывает границы подтверждённых переходов", [
        "ID",
        "Сценарий",
        "Область",
        "Статус",
        "Доказательства"
    ], scenarios)}\n${section("Получатели", "семейства получателей", "показывает blast radius", [
        "ID",
        "Получатель",
        "Связь",
        "Совпадения",
        "Статус",
        "Доказательства"
    ], recipients)}\n${section("Критические пути", "сквозные пути механизма", "показывает границы реализации и разрывы", [
        "ID",
        "Путь",
        "Статус",
        "Доказательства"
    ], paths)}\n${section("Эталонные пути", "существующие соседние механизмы", "показывает, с чем сравнивать доработку", [
        "ID",
        "Слой",
        "Путь",
        "Роль",
        "Статус",
        "Доказательства"
    ], references)}\n${section("Существующие точки входа для доработки", "конкретные существующие места изменения", "связывает пробелы с реализацией", [
        "ID",
        "Слой",
        "Путь",
        "Роль",
        "Пробелы",
        "Статус",
        "Доказательства"
    ], entries)}\n`;
}
module.exports = {
    renderImplementation
};
