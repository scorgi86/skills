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
function refs(row) {
    return (row.evidenceRefs || []).join(", ");
}
function section(title, shows, purpose, headers, rows) {
    return `## ${title}\n\n${explanation(shows, purpose)}\n\n${table(headers, rows)}\n`;
}
module.exports = {
    refs,
    esc,
    section
};
