"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { validateSourceAnchor } = require("../../../evidence/src/canonicalization/source_anchor.js");
const { SourceSnapshotStore } = require("../../../evidence/src/source_snapshot.js");
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
function evidenceState(row, repositories, context = {}) {
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
    const sourceSnapshots = context.sourceSnapshots || new SourceSnapshotStore();
    let snapshot;
    try {
        const physicalRoot = fs.realpathSync(repository.root);
        const physicalFile = fs.realpathSync(file);
        const physicalRelative = path.relative(physicalRoot, physicalFile);
        if (!physicalRelative || physicalRelative.startsWith("..") || path.isAbsolute(physicalRelative)) return {
            ok: false,
            code: "evidence-scope",
            message: "Evidence file must physically remain inside its declared repository root"
        };
        snapshot = sourceSnapshots.get(physicalFile);
        if (!snapshot) throw new Error("not a file");
    } catch  {
        return {
            ok: false,
            code: "evidence-file",
            message: "Evidence source file is unavailable"
        };
    }
    return validateSourceAnchor(row, snapshot);
}
module.exports = {
    repositoryMap,
    evidenceState
};
