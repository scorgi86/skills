"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");

function normalizeConcurrency(value, fileCount) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new TypeError("AST concurrency must be a positive integer");
  }
  if (fileCount < 1) return 1;
  return Math.min(value === undefined ? 1 : value, fileCount);
}

function defaultCreateWorker() {
  return new Worker(path.join(__dirname, "analysis_worker.js"));
}

async function analyzeInWorkers(files, options, dependencies = {}) {
  const concurrency = normalizeConcurrency(options.concurrency, files.length);
  const createWorker = dependencies.createWorker || defaultCreateWorker;
  const results = new Array(files.length);
  const workers = [];
  let next = 0;
  let completed = 0;
  let settled = false;

  return await new Promise((resolve, reject) => {
    const stop = async (error) => {
      if (settled) return;
      settled = true;
      await Promise.allSettled(workers.map(worker => worker.terminate()));
      reject(error);
    };
    const finish = async () => {
      if (settled || completed !== files.length) return;
      settled = true;
      await Promise.allSettled(workers.map(worker => worker.terminate()));
      resolve(results);
    };
    const assign = (worker) => {
      if (settled) return;
      if (next >= files.length) return;
      const index = next++;
      try {
        worker.postMessage({ index, filename: files[index], options: { cache: options.cache } });
      } catch (error) {
        void stop(error);
      }
    };
    const count = Math.min(concurrency, files.length);
    try {
      for (let index = 0; index < count; index += 1) {
        const worker = createWorker();
        workers.push(worker);
        worker.on("message", (message) => {
          if (settled) return;
          if (!message || !Number.isInteger(message.index) || message.index < 0 || message.index >= files.length || !message.analyzed || results[message.index] !== undefined) {
            void stop(new Error("AST worker returned an invalid message"));
            return;
          }
          results[message.index] = message.analyzed;
          completed += 1;
          if (next < files.length) assign(worker);
          else void finish();
        });
        worker.once("error", error => { void stop(error); });
        worker.once("exit", code => {
          if (!settled) void stop(new Error(`AST worker exited before completion: ${code}`));
        });
        assign(worker);
      }
    } catch (error) {
      void stop(error);
    }
  });
}

module.exports = { analyzeInWorkers, defaultCreateWorker, normalizeConcurrency };
