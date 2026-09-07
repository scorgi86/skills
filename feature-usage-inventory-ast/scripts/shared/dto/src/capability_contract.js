"use strict";
const { normalizeStatus } = require("./planning_contract.js");
const IDS = new Set(["definition", "ownership", "storage", "serialization", "input", "mutation", "recipients", "readback", "render-output", "lifecycle", "theme-style", "tests", "reference"]);
const STATUSES = new Set(["confirmed", "unchecked", "checked-no-usage", "not-applicable", "reference-only", "candidate", "partial", "unknown"]);

function normalizeCapabilities(items = []) {
    if (!Array.isArray(items)) throw new Error("capabilities must be an array");
    return items.map((item) => {
        if (!item || !IDS.has(item.id)) throw new Error(`Invalid capability id: ${item?.id}`);
        const originalStatus = item.status;
        const status = originalStatus === "unchecked" ? "unchecked" : normalizeStatus(originalStatus);
        item = { ...item, status, ...(originalStatus !== status ? { originalStatus } : {}) };
        if (!STATUSES.has(status)) throw new Error(`Unsupported capability status: ${originalStatus}`);
        if (status === "confirmed" && (!Array.isArray(item.evidenceRefs) || !item.evidenceRefs.length)) {
            throw new Error(`Confirmed capability ${item.id} requires evidenceRefs`);
        }
        if (status === "checked-no-usage") {
            const lists = ["expectedNames", "performedChecks", "ordersChecked", "linkingMethodsChecked", "evidenceRefs"];
            const texts = ["reason", "repository", "searchScope", "consequence"];
            if (lists.some((key) => !Array.isArray(item[key]) || !item[key].length) ||
                texts.some((key) => !String(item[key] || "").trim()) || item.resultComplete !== true || item.resultTruncated !== false) {
                throw new Error(`Checked absence ${item.id} requires the complete absence protocol`);
            }
        }
        const normalized = { ...item, requiredForFinalReport: item.requiredForFinalReport !== false };
        for (const key of ["expectedNames", "performedChecks", "ordersChecked", "linkingMethodsChecked", "evidenceRefs"]) {
            if (Array.isArray(normalized[key])) normalized[key] = [...new Set(normalized[key].map(String))].sort();
        }
        return normalized;
    });
}
module.exports = { IDS, STATUSES, normalizeCapabilities };
