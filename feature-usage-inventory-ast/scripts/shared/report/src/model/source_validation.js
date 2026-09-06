"use strict";
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { asArray, cleanText } = require("./rows.js");
function repositoryMap(scope) {
    return new Map(asArray(scope?.repositories).filter((row)=>row && typeof row === "object" && cleanText(row.id) && cleanText(row.root) && cleanText(row.role)).map((row)=>[
            row.id,
            {
                ...row,
                root: path.resolve(row.root)
            }
        ]));
}
function evidenceState(row, repositories) {
    const repository = repositories.get(row?.repository);
    if (!repository) return {
        ok: false,
        code: "evidence-scope",
        message: "Evidence repository must exactly match a declared repository"
    };
    const file = path.resolve(repository.root, cleanText(row.file));
    const relative = path.relative(repository.root, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return {
        ok: false,
        code: "evidence-scope",
        message: "Evidence file must be inside its declared repository root"
    };
    let currentHash;
    try {
        const physicalRoot = fs.realpathSync(repository.root), physicalFile = fs.realpathSync(file), physicalRelative = path.relative(physicalRoot, physicalFile);
        if (!physicalRelative || physicalRelative.startsWith("..") || path.isAbsolute(physicalRelative)) return {
            ok: false,
            code: "evidence-scope",
            message: "Evidence file must physically remain inside its declared repository root"
        };
        if (!fs.statSync(physicalFile).isFile()) throw new Error("not a file");
        currentHash = crypto.createHash("sha256").update(fs.readFileSync(physicalFile)).digest("hex");
    } catch  {
        return {
            ok: false,
            code: "evidence-file",
            message: "Evidence source file is unavailable"
        };
    }
    if (!/^[a-f0-9]{64}$/i.test(cleanText(row.sourceHash)) || currentHash !== cleanText(row.sourceHash).toLowerCase()) return {
        ok: false,
        code: "stale-evidence",
        message: "Evidence hash must equal the current full-file SHA-256"
    };
    return {
        ok: true
    };
}
module.exports = {
    repositoryMap,
    evidenceState
};
