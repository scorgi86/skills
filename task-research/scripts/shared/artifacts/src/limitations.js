"use strict";
const { createHash } = require("node:crypto");
function normalizeLimitations(values = []) {
  if (!Array.isArray(values)) throw new Error("limitations must be an array of strings or structured rows");
  return values.map(value => {
    if (typeof value === "string" && value.trim()) return { id: `limitation-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`, status: "unknown", statement: value };
    if (!value || typeof value !== "object" || Array.isArray(value) || ![value.statement, value.detail, value.description, value.reason].some(text => typeof text === "string" && text.trim())) throw new Error("Each limitation requires a nonempty string or statement/detail/description/reason");
    return { id: `limitation-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`, status: "unknown", ...value };
  });
}
function limitationText(row) { return typeof row === "string" ? row : row.statement || row.detail || row.description || row.reason; }
module.exports = { normalizeLimitations, limitationText };
