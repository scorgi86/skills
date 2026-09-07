"use strict";

const fs = require("node:fs");
const { atomicWriteJson } = require("../file_transaction.js");

class JournalStore {
  constructor(file) { this.file = file; }
  exists() { return fs.existsSync(this.file); }
  read() { return JSON.parse(fs.readFileSync(this.file, "utf8")); }
  write(value) { atomicWriteJson(this.file, value); }
  remove() { fs.unlinkSync(this.file); }
}

module.exports = { JournalStore };
