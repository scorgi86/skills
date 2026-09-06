"use strict";
const { byteLength, measureValue } = require("../measure_context.js");
const DEFAULT_BUDGETS = Object.freeze({
    factsBytes: 96 * 1024,
    summaryBytes: 24 * 1024,
    evidenceBytes: 48 * 1024,
    reportBytes: 64 * 1024
});
function positiveBytes(value, fallback, minimum = 1024) {
    const number = Number(value);
    return Math.max(minimum, Number.isFinite(number) && number > 0 ? number : fallback);
}
function normalizeBudgets(request = {}, defaults = DEFAULT_BUDGETS) {
    const configured = request.budgets || {};
    return {
        factsBytes: positiveBytes(configured.factsBytes, defaults.factsBytes, 8192),
        summaryBytes: positiveBytes(configured.summaryBytes, defaults.summaryBytes),
        evidenceBytes: positiveBytes(configured.evidenceBytes, defaults.evidenceBytes),
        reportBytes: positiveBytes(configured.reportBytes, defaults.reportBytes)
    };
}
function finalizeSummaryBudget(summary, budgetBytes) {
    summary.output = {
        bytes: 0,
        budget: budgetBytes,
        bounded: true,
        overflow: false,
        policy: "explicit-overflow-preserve-required-summary"
    };
    for(let attempt = 0; attempt < 8; attempt += 1){
        const bytes = byteLength(summary);
        if (summary.output.bytes === bytes) break;
        summary.output.bytes = bytes;
    }
    summary.output.bytes = byteLength(summary);
    summary.output.overflow = summary.output.bytes > budgetBytes;
    summary.output.bounded = !summary.output.overflow;
    if (summary.output.overflow && summary.status !== "partial") summary.status = "partial";
    return summary;
}
module.exports = {
    DEFAULT_BUDGETS,
    finalizeSummaryBudget,
    normalizeBudgets
};
