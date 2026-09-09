"use strict";
const { normalize } = require("../parser.js");
const { WEAK_PHRASES } = require("../requirements.js");
function containsCodeEvidence(text) {
    return /\[[^\]]+\]\([^\)]+:\d+\)/.test(text) || /\b[\w.-]+\.(js|ts|jsx|tsx|py|cs|cpp|h|java|json|xml|md)\b/i.test(text) || /\b[A-ZА-Я][A-Za-zА-Яа-я0-9_]*\.(prototype\.)?[A-Za-zА-Яа-я0-9_]+\b/.test(text) || /\b[A-Za-zА-Яа-я0-9_]+\([^)]*\)/.test(text) || /[A-Za-z0-9_.-]+[\\/][A-Za-z0-9_.\\/ -]+/.test(text) || /\b(line|строка)\s*\d+\b/i.test(text);
}
function containsExpectedNames(text) {
    return /[`"«][^`"»]{2,}[`"»]/.test(text) || /\b[A-Za-zА-Яа-я0-9_./*-]{2,}\s*(,|\/|\||;)\s*[A-Za-zА-Яа-я0-9_./*-]{2,}/.test(text) || /\b(ожидаем|искал|проверял|паттерн|термин|имя|признак|ключ|поле|метод|свойств|команд|формат|слой)\b/i.test(text);
}
function containsSearchArea(text) {
    return /[A-Za-z0-9_.-]+[\\/][A-Za-z0-9_.\\/ -]+/.test(text) || /\b[\w.-]+\.(js|ts|jsx|tsx|py|cs|cpp|h|java|json|xml|md|yml|yaml|css|less|scss)\b/i.test(text) || /\b(файл|директор|каталог|модул|пакет|слой|зона|область|секци|таблиц|тест|fixture|фикстур|поиск|rg|grep|паттерн|маск)\b/i.test(text);
}
function isWeakCell(cell) {
    const value = normalize(cell);
    return !value || value === "..." || value === "-" || value === "неприменимо" || WEAK_PHRASES.some((re)=>re.test(value));
}
module.exports = {
    containsExpectedNames,
    containsSearchArea,
    isWeakCell,
    containsCodeEvidence
};
