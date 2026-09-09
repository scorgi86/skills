"use strict";
function esc(value) {
    return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function table(headers, rows) {
    return [
        `| ${headers.join(" | ")} |`,
        `| ${headers.map(()=>"---").join(" | ")} |`,
        ...rows.map((row)=>`| ${row.map(esc).join(" | ")} |`)
    ].join("\n");
}
function explanation(shows, purpose) {
    return `Что показывает: ${shows}\n\nЗачем нужна: ${purpose}\n\nКак читать: каждая строка имеет стабильный идентификатор и статус.\n\nКак использовать: переходить по идентификаторам к детальной доказательной базе.`;
}
function semantic(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(semantic).filter(Boolean).join("; ");
    if (typeof value === "object") return Object.entries(value).map(([key, item]) => key + ": " + semantic(item)).join("; ");
    return String(value);
}
function meaning(row) {
    return [...new Set(["title", "name", "receiver", "object", "term", "terms", "statement", "description", "detail", "steps", "result", "summary", "expectedPath", "expectedName", "expectedPlace", "reason"].map(key => semantic(row[key])).filter(Boolean))].concat(notes(row) || []).join("; ") || "Описание не предоставлено";
}
function sourceLabel(row) { return [row.repository, row.file && row.file + (row.line ? ":" + row.line + (row.endLine && row.endLine !== row.line ? "–" + row.endLine : "") : ""), row.symbol || row.anchor].filter(Boolean).join(" / ") || meaning(row); }
function refs(row, model) {
    return (row.evidenceRefs || []).map(id => { const source = model?.evidenceIndex?.find(item => item.id === id); return source ? "[" + sourceLabel(source) + "](evidence.md#" + encodeURIComponent(id) + ") (" + id + ")" : id; }).join(", ");
}
function notes(row) { return [semantic(row.roles), row.category, row.originalStatus && row.originalStatus !== row.status ? "Исходный статус: " + row.originalStatus : "", row.sourceStages ? "Стадии: " + semantic(row.sourceStages) : row.sourceStage != null ? "Стадия: " + row.sourceStage : "", row.provenance ? "Происхождение: " + semantic(row.provenance) : "", row.conflicts?.length ? "Конфликты: " + semantic(row.conflicts) : ""].filter(Boolean).join("; "); }
function coverageSummary(model) {
    const profile = model.coverage?.profile;
    if (!profile) return "";
    const rows = [...(profile.requiredCollections || []).map(name => [name, profile.notApplicable?.[name] ? "Неприменимо: " + profile.notApplicable[name] : "Обязательно; строк: " + (model[name] || []).length]), ...(profile.requiredCriticalPaths || []).map(key => ["criticalPaths / " + key, profile.notApplicableCriticalPaths?.[key] ? "Неприменимо: " + profile.notApplicableCriticalPaths[key] : "Обязательный путь"])];
    return rows.length ? section("Заявленная полнота исследования", "обязательства задачи и причины неприменимости", "отличает пропущенный обязательный материал от обоснованного N/A", ["Область", "Применимость"], rows) + "\n" : "";
}
function section(title, shows, purpose, headers, rows) {
    return `## ${title}\n\n${explanation(shows, purpose)}\n\n${table(headers, rows)}\n`;
}
module.exports = {
    refs,
    meaning,
    notes,
    sourceLabel,
    semantic,
    coverageSummary,
    esc,
    section
};
