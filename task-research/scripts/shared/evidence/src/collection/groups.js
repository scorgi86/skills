"use strict";
const path = require("path");
function evidenceGroupIdentity(check, file, patternId) {
    const mode = check.groupBy || "file-pattern";
    if (mode === "file") return {
        label: file,
        identity: {
            file
        }
    };
    if (mode === "pattern") return {
        label: patternId,
        identity: {
            patternId
        }
    };
    return {
        label: `${path.basename(file)} :: ${patternId}`,
        identity: {
            file,
            patternId
        }
    };
}
module.exports = {
    evidenceGroupIdentity
};
