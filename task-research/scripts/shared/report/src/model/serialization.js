"use strict";
const crypto = require("node:crypto");
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key)=>[
            key,
            stable(value[key])
        ]));
}
function canonicalJson(value) {
    return `${JSON.stringify(stable(value), null, 2)}\n`;
}
function digest(value) {
    return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function withoutIntegrity(model) {
    const copy = {
        ...model
    };
    delete copy.integrity;
    return copy;
}
module.exports = {
    canonicalJson,
    digest,
    stable,
    withoutIntegrity
};
