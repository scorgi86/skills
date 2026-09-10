"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function platformKey(file) {
  const normalized = path.normalize(path.resolve(file));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

class SourceSnapshotStore {
  constructor(dependencies = {}) {
    this.readFileSync = dependencies.readFileSync || ((file) => fs.readFileSync(file));
    this.realpathSync = dependencies.realpathSync || ((file) => fs.realpathSync(file));
    this.statSync = dependencies.statSync || ((file) => fs.statSync(file));
    this.snapshots = new Map();
  }

  get(file) {
    const logicalKey = platformKey(file);
    let physicalFile;
    try {
      physicalFile = this.realpathSync(path.resolve(file));
    } catch {
      if (!this.snapshots.has(logicalKey)) this.snapshots.set(logicalKey, null);
      return this.snapshots.get(logicalKey);
    }
    const key = platformKey(physicalFile);
    if (this.snapshots.has(key)) return this.snapshots.get(key);
    let snapshot = null;
    try {
      if (this.statSync(physicalFile).isFile()) {
        const bytes = this.readFileSync(physicalFile);
        const text = bytes.toString("utf8");
        snapshot = {
          file: physicalFile,
          bytes,
          text,
          lines: text.split(/\r?\n/),
          sourceHash: crypto.createHash("sha256").update(bytes).digest("hex")
        };
      }
    } catch {}
    this.snapshots.set(key, snapshot);
    if (logicalKey !== key) this.snapshots.set(logicalKey, snapshot);
    return snapshot;
  }
}

module.exports = { SourceSnapshotStore, platformKey };
