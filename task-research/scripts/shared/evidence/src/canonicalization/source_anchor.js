"use strict";
const crypto = require("node:crypto");
// Hash and fragment must describe one read; callers own physical containment.
function validateSourceAnchor(row, bytes) {
    const currentHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (typeof row.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(row.sourceHash) || currentHash !== row.sourceHash.toLowerCase()) return { ok: false, code: "stale-evidence", message: "Evidence hash must equal the current full-file SHA-256" };
    const text = bytes.toString("utf8").replace(/\r\n/g, "\n");
    const lines = text === "" ? [] : text.split("\n");
    if (text.endsWith("\n")) lines.pop();
    if (!Number.isInteger(row.line) || !Number.isInteger(row.endLine) || row.line < 1 || row.endLine < row.line || row.endLine > lines.length) return { ok: false, code: "source-anchor", message: "Reconfirm evidence with an existing inclusive 1-based line/endLine range" };
    if (typeof row.sourceFragment !== "string" || row.sourceFragment.replace(/\r\n/g, "\n") !== lines.slice(row.line - 1, row.endLine).join("\n")) return { ok: false, code: "source-anchor", message: "Reconfirm evidence with the exact full sourceFragment for line/endLine; compact snippets are not source anchors" };
    return { ok: true };
}
module.exports = { validateSourceAnchor };
