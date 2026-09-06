"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateState } = require("./state_model.js");
function readJson(file) {
    return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}
function writeJson(file, value) {
    fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`);
}
function loadState(file) {
    return validateState(readJson(file));
}
function sha256File(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
module.exports = {
    writeJson,
    loadState,
    sha256File,
    readJson
};
