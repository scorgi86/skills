"use strict";
const { REQUIRED_SECTIONS, EXECUTION_STATUS_SECTION } = require("./requirements.js");
function normalize(text) {
    return String(text || "").replace(/<[^>]+>/g, "").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
function splitRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell)=>cell.trim());
}
function isSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}
function isKnownBareSection(line) {
    const title = line.trim();
    if (!title || title.length > 80) return false;
    if (REQUIRED_SECTIONS.some((section)=>normalize(section) === normalize(title))) return true;
    return normalize(title) === normalize("Приемка Полноты") || normalize(title) === normalize("Gaps И Следующие Проверки") || normalize(title) === normalize(EXECUTION_STATUS_SECTION);
}
function parseSections(lines) {
    const sections = [];
    let current = {
        title: "__root__",
        level: 0,
        start: 0,
        lines: []
    };
    sections.push(current);
    lines.forEach((line, index)=>{
        const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
        if (match && match[1].length === 2) {
            current = {
                title: match[2].trim(),
                level: 2,
                start: index + 1,
                lines: []
            };
            sections.push(current);
        } else if (isKnownBareSection(line)) {
            current = {
                title: line.trim(),
                level: 2,
                start: index + 1,
                lines: []
            };
            sections.push(current);
        } else {
            current.lines.push({
                text: line,
                number: index + 1
            });
        }
    });
    return sections;
}
function findSection(sections, title) {
    const exact = sections.find((section)=>normalize(section.title) === normalize(title));
    if (exact) return exact;
    if (title === "Приемка Полноты Для Задачи Доработки") {
        return sections.find((section)=>normalize(section.title) === normalize("Приемка Полноты"));
    }
    return null;
}
function tsvToTableLine(line) {
    return `| ${line.split("\t").map((cell)=>cell.trim()).join(" | ")} |`;
}
function separatorForHeader(line) {
    const count = splitRow(line).length;
    return `| ${Array.from({
        length: count
    }, ()=>"---").join(" | ")} |`;
}
function findTables(section) {
    const tables = [];
    let i = 0;
    while(i < section.lines.length){
        const line = section.lines[i].text;
        if (/^\s*\|/.test(line) && i + 1 < section.lines.length && isSeparator(section.lines[i + 1].text)) {
            const rows = [
                section.lines[i],
                section.lines[i + 1]
            ];
            i += 2;
            while(i < section.lines.length && /^\s*\|/.test(section.lines[i].text)){
                rows.push(section.lines[i]);
                i += 1;
            }
            tables.push({
                startLine: rows[0].number,
                rows
            });
            continue;
        }
        if (line.includes("\t") && i + 1 < section.lines.length && section.lines[i + 1].text.includes("\t")) {
            const headerLine = {
                text: tsvToTableLine(section.lines[i].text),
                number: section.lines[i].number
            };
            const rows = [
                headerLine,
                {
                    text: separatorForHeader(headerLine.text),
                    number: section.lines[i].number
                }
            ];
            i += 1;
            while(i < section.lines.length && section.lines[i].text.trim() && section.lines[i].text.includes("\t")){
                rows.push({
                    text: tsvToTableLine(section.lines[i].text),
                    number: section.lines[i].number
                });
                i += 1;
            }
            tables.push({
                startLine: headerLine.number,
                rows
            });
            continue;
        }
        i += 1;
    }
    return tables;
}
function rowObject(headers, cells) {
    const row = {};
    headers.forEach((header, index)=>{
        row[header] = cells[index] || "";
    });
    return row;
}
function findColumn(headers, candidates) {
    const normalized = headers.map(normalize);
    for (const candidate of candidates){
        const idx = normalized.findIndex((header)=>header.includes(normalize(candidate)));
        if (idx !== -1) return idx;
    }
    return -1;
}
function tableDataRows(table) {
    return table.rows.slice(2).map((row)=>({
            lineNumber: row.number,
            cells: splitRow(row.text)
        })).filter((row)=>row.cells.some((cell)=>normalize(cell) && normalize(cell) !== "..."));
}
function rowText(row) {
    return row.cells.join(" | ");
}
module.exports = {
    parseSections,
    findSection,
    findTables,
    normalize,
    tableDataRows,
    rowText,
    splitRow,
    findColumn,
    rowObject
};
