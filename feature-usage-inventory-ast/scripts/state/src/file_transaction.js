const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function atomicWriteJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let owned = false;
  try {
    const fd = fs.openSync(temporary, "wx");
    owned = true;
    try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally {
    if (owned && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function withFileLock(file, run) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let fd;
  try { fd = fs.openSync(file, "wx"); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Transaction locked: ${file}. Verify the owner has stopped before manually removing an orphan lock.`);
    throw error;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return run();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(file);
  }
}
module.exports = { atomicWriteJson, withFileLock };
