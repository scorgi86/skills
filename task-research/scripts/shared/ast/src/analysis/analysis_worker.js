"use strict";

const { parentPort } = require("node:worker_threads");
const { analyzeFile } = require("./analysis.js");

parentPort.on("message", ({ index, filename, options }) => {
  const analyzed = analyzeFile(filename, options);
  parentPort.postMessage({ index, analyzed: { result: analyzed.result, cache: analyzed.cache, identityKey: analyzed.identityKey } });
});
