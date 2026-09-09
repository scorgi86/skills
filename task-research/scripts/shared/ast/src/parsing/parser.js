const fs = require("fs");
const path = require("path");
const swc = require("@swc/core");

function parserOptions(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".ts" || extension === ".tsx") {
    return { syntax: "typescript", tsx: extension === ".tsx", decorators: true, dynamicImport: true, isModule: "unknown" };
  }
  return { syntax: "ecmascript", jsx: extension === ".jsx", decorators: true, dynamicImport: true, isModule: "unknown" };
}

function parseSource(source, filename) {
  const started = process.hrtime.bigint();
  const options = parserOptions(filename);
  try {
    const ast = swc.parseSync(source, options);
    return {
      ok: true, ast, source, filename: path.resolve(filename),
      parser: { name: "@swc/core", version: swc.version, options },
      elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
      diagnostics: [],
    };
  } catch (error) {
    return {
      ok: false, ast: null, source, filename: path.resolve(filename),
      parser: { name: "@swc/core", version: swc.version, options },
      elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
      diagnostics: [{ message: error.message, status: "не проверено" }],
    };
  }
}

function parseFile(filename) {
  const resolved = path.resolve(filename);
  try {
    return parseSource(fs.readFileSync(resolved, "utf8"), resolved);
  } catch (error) {
    return {
      ok: false, ast: null, source: "", filename: resolved,
      parser: { name: "@swc/core", version: swc.version, options: parserOptions(resolved) },
      elapsedMs: 0,
      diagnostics: [{ message: error.message, status: "не проверено" }],
    };
  }
}

module.exports = { parseFile, parseSource, parserOptions, swcVersion: swc.version };
