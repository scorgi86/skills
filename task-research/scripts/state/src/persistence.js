"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function readJson(file) {
    return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}
function writeJson(file, value) {
    require("./file_transaction.js").atomicWriteJson(path.resolve(file), value);
}
function sha256File(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
module.exports = {
    writeJson,
    sha256File,
    readJson
};
