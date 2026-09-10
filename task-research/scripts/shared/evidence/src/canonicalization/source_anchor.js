"use strict";
const crypto = require("node:crypto");
// Hash and fragment must describe one read; callers own physical containment.
function validateSourceAnchor(row, bytes) {
    const snapshot = Buffer.isBuffer(bytes) ? null : bytes;
    const sourceBytes = snapshot ? snapshot.bytes : bytes;
    const currentHash = snapshot?.sourceHash || crypto.createHash("sha256").update(sourceBytes).digest("hex");
    if (typeof row.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(row.sourceHash) || currentHash !== row.sourceHash.toLowerCase()) return { ok: false, code: "stale-evidence", message: "Evidence hash must equal the current full-file SHA-256" };
    const text = snapshot?.text ?? sourceBytes.toString("utf8");
    const lines = snapshot ? [...snapshot.lines] : text.replace(/\r\n/g, "\n").split("\n");
    if (text === "") lines.length = 0;
    else if (/\r?\n$/.test(text)) lines.pop();
    if (!Number.isInteger(row.line) || !Number.isInteger(row.endLine) || row.line < 1 || row.endLine < row.line || row.endLine > lines.length) return { ok: false, code: "source-anchor", message: "Reconfirm evidence with an existing inclusive 1-based line/endLine range" };
    if (typeof row.sourceFragment !== "string" || row.sourceFragment.replace(/\r\n/g, "\n") !== lines.slice(row.line - 1, row.endLine).join("\n")) return { ok: false, code: "source-anchor", message: "Reconfirm evidence with the exact full sourceFragment for line/endLine; compact snippets are not source anchors" };
    return { ok: true };
}
module.exports = { validateSourceAnchor };
