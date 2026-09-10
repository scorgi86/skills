"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function validItems(items) {
  return Array.isArray(items) && items.every(item => item !== null && typeof item === "object" && !Array.isArray(item));
}

function readQueryEntry(directory, identity) {
  let serialized;
  try {
    serialized = fs.readFileSync(path.join(directory, `${identity.key}.json`), "utf8");
  } catch (error) {
    return error.code === "ENOENT" ? { status: "miss" } : { status: "failed", error };
  }
  try {
    const entry = JSON.parse(serialized);
    if (!entry || entry.schemaVersion !== identity.version || entry.key !== identity.key || !validItems(entry.items)) throw new Error("Invalid query cache entry");
    return { status: "hit", items: entry.items };
  } catch (error) {
    return { status: "failed", error };
  }
}

function writeQueryEntry(directory, identity, items) {
  if (!validItems(items)) return { status: "failed", error: new Error("Invalid query cache items") };
  const target = path.join(directory, `${identity.key}.json`), temporary = `${target}.${randomUUID()}.tmp`;
  let owned = false;
  try {
    fs.mkdirSync(directory, { recursive: true });
    const descriptor = fs.openSync(temporary, "wx");
    owned = true;
    try { fs.writeFileSync(descriptor, JSON.stringify({ schemaVersion: identity.version, key: identity.key, items })); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    return { status: "written" };
  } catch (error) {
    return { status: "failed", error };
  } finally {
    if (owned) try { fs.unlinkSync(temporary); } catch { /* Best effort for our temporary file. */ }
  }
}

module.exports = { readQueryEntry, validItems, writeQueryEntry };
