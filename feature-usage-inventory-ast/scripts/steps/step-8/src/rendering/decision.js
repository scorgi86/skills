"use strict";
const { refs, esc, section, meaning, notes, sourceLabel, semantic, coverageSummary } = require("./markdown.js");
function renderDecision(model) {
    const counts = [
        [
            model.confirmedUsages.every(x => ["confirmed", "source-confirmed"].includes(x.status)) ? "Подтверждённые использования" : "Использования и кандидаты",
            model.confirmedUsages.length
        ],
        [
            "Семейства получателей",
            model.recipientFamilies.length
        ],
        [
            "Критические пути",
            model.criticalPaths.length
        ],
        [
            "Пробелы",
            model.gaps.length
        ],
        [
            "Точки реализации",
            model.implementationEntryPoints.length
        ],
        [
            "Ограничения",
            model.limitations.length
        ],
        [
            "Evidence",
            model.evidenceIndex.length
        ]
    ];
    const usages = model.confirmedUsages.map((x)=>[
            x.id,
            meaning(x),
            notes(x),
            x.status,
            refs(x, model)
        ]);
    const gaps = model.gaps.map((x)=>[
            x.id,
            meaning(x) + (notes(x) ? "; " + notes(x) : ""),
            (x.expectedNames || []).join(", "),
            x.searchScope || "",
            x.status,
            refs(x, model)
        ]);
    const limitations = model.limitations.map((x)=>[
            x.id,
            meaning(x),
            x.status
        ]);
    const capabilities = model.capabilities.map((x)=>[
            x.id,
            x.status,
            refs(x, model),
            x.requiredForFinalReport ? "да" : "нет"
        ]);
    return `# Инвентаризация: ${esc(model.target)}\n\n## Общая картина\n\nСтатус решения: **${esc(model.decisionStatus)}**. Модель Stage 7 закрыта, обязательных открытых проверок: ${model.openChecks.length}. Полнота исследования: **${esc(model.coverage.status || "проверено по обязательствам модели")}**. Готовность продукта: **${esc(model.coverage.productReadiness || (model.gaps.length ? "есть зарегистрированные пробелы; требуется решение по ним" : "не оценивалась"))}**. Подтверждённый результат исследования может включать пробелы продукта.\n\n${coverageSummary(model)}${section("Масштаб исследования", "количественный охват модели", "позволяет быстро оценить полноту и размер blast radius", [
        "Область",
        "Количество"
    ], counts)}\n${section(model.confirmedUsages.every(x => ["confirmed", "source-confirmed"].includes(x.status)) ? "Подтверждённые использования" : "Использования и кандидаты", "наблюдения с явно указанным уровнем доказательства", "даёт краткую картину фактического охвата", [
        "ID",
        "Использование",
        "Результат",
        "Статус",
        "Доказательства"
    ], usages)}\n${section("Пробелы и решения", "проверенные пробелы", "поддерживает принятие решения о доработке", [
        "ID",
        "Пробел",
        "Ожидаемые имена",
        "Область",
        "Статус",
        "Доказательства"
    ], gaps)}\n${section("Ограничения", "границы достоверности отчёта", "не позволяет принять ограничение за подтверждённый факт", [
        "ID",
        "Ограничение",
        "Статус"
    ], limitations)}\n${section("Покрытие возможностей", "обязательные аспекты инвентаризации", "показывает, какими доказательствами закрыта каждая capability", [
        "Capability",
        "Статус",
        "Доказательства",
        "Обязательна"
    ], capabilities)}\n## Переход к деталям\n\n- [Карта реализации](implementation-map.md) — ownership, словарь, сценарии, получатели, пути и точки изменения.\n- [Доказательная база](evidence.md) — полный индекс source evidence, отсутствие использования, эталоны и шум.\n`;
}
module.exports = {
    renderDecision
};
