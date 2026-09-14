"use strict";
// Reusable diagnostics for an already authored package; never authors research facts.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { appendEvent } = require("../../../trace-ai-actions/scripts/append_event.js");

function parseArgs(argv) {
  const value = { prepareOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--prepare-only") { value.prepareOnly = true; continue; }
    const key = { "--package": "packageFile", "--output-root": "outputRoot" }[argv[i]];
    if (!key) throw Error(`Unknown option: ${argv[i]}`);
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw Error(`Missing value: ${argv[i]}`);
    if (value[key]) throw Error(`Duplicate option: ${argv[i]}`);
    value[key] = argv[++i];
  }
  if (!value.packageFile || !value.outputRoot) throw Error("Requires --package and --output-root");
  return value;
}
function execute(exe, args, cwd) {
  const result = cp.spawnSync(exe, args, { cwd, encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error || ![0, 1].includes(result.status)) throw Error(result.error?.message || result.stderr || `Exit ${result.status}`);
  return result;
}
function repositoryState(scope) {
  return scope.repositories.map(row => {
    const head = execute("git", ["rev-parse", "HEAD"], row.root), status = execute("git", ["status", "--porcelain"], row.root);
    if (head.status !== 0 || status.status !== 0) throw Error(`Cannot read repository state: ${row.id}`);
    return { id: row.id, head: head.stdout.trim(), status: status.stdout };
  });
}
function diagnose() {
  const root = path.resolve(__dirname, "..");
  return JSON.parse(execute(process.execPath, [path.join(root, "index.js"), "diagnose"], path.dirname(root)).stdout);
}
function checkAnchors(value, scope, counts) {
  if (!value || typeof value !== "object") return;
  if (value.sourceHash && typeof value.file === "string") {
    const file = path.resolve(value.file), physical = fs.realpathSync(file);
    const containing = scope.repositories.filter(repo => {
      const relative = path.relative(fs.realpathSync(repo.root), physical);
      return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if (containing.length !== 1 || value.repository && value.repository !== containing[0].id) throw Error(`Out-of-scope source anchor: ${file}`);
    const bytes = fs.readFileSync(file), lines = bytes.toString("utf8").split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    if (!Number.isInteger(value.line) || !Number.isInteger(value.endLine) || value.line < 1 || value.endLine < value.line || value.endLine > lines.length
      || crypto.createHash("sha256").update(bytes).digest("hex") !== value.sourceHash
      || lines.slice(value.line - 1, value.endLine).join("\n") !== value.sourceFragment) throw Error(`Stale or invalid source anchor: ${file}:${value.line}`);
    counts.reads++; counts.bytes += bytes.length;
    counts.ranges.add(`${physical}:${value.line}:${value.endLine}`);
  }
  for (const child of Object.values(value)) checkAnchors(child, scope, counts);
}
async function runRepeat(options, dependencies = {}) {
  const startedAt = new Date().toISOString(), started = performance.now(), output = path.resolve(options.outputRoot);
  if (fs.existsSync(output)) throw Error(`Output already exists: ${output}`);
  fs.mkdirSync(output, { recursive: true });
  const save = (file, value) => fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2));
  const operations = [], stages = [];
  const event = (type, operation, status, data) => appendEvent({ log: path.join(output, "operations.jsonl"), event: type, operation, status, data });
  function record(operation, start, status, data = {}) {
    const row = { operation, startMs: start - started, endMs: performance.now() - started, status, ...data };
    row.durationMs = row.endMs - row.startMs; operations.push(row); event("result", operation, status, row); return row;
  }
  function measured(operation, callback) {
    event("intent", operation, "started", {}); const start = performance.now();
    try { const result = callback(); record(operation, start, "ok"); return result; }
    catch (error) { record(operation, start, "error", { message: error.message }); throw error; }
  }
  function finish(status, extra = {}) {
    const metricsFile = path.join(output, "artifacts/full-run-metrics.json");
    const stage8Ms = fs.existsSync(metricsFile) ? JSON.parse(fs.readFileSync(metricsFile)).stages.find(row => row.stage === 8 && row.status === "closed")?.wallMs : undefined;
    const summary = { startedAt, completedAt: new Date().toISOString(), wallMs: performance.now() - started, status, operations, stages,
      stage8Ms, successfulStagesAndRenderingMs: stages.filter(row => row.status === "closed").reduce((sum, row) => sum + row.durationMs, 0) + (stage8Ms || 0),
      usage: { status: "unavailable" }, boundaries: "Wrapper invocation only; not user receipt/delivered response. Nested operations are not additive; coordinator includes IO/gates/locks.", ...extra };
    save("summary.json", summary);
    fs.writeFileSync(path.join(output, "measurements.md"), `# Повторный диагностический запуск\n\nСтатус: ${status}. Wall: ${summary.wallMs.toFixed(3)} мс. Подготовка: ${summary.preparationMs?.toFixed(3) || "не завершена"} мс. Stage 8: ${stage8Ms?.toFixed(3) || "не выполнялся"} мс.\n\n${operations.map(row => `- ${row.operation}: ${row.durationMs.toFixed(3)} мс, ${row.status}`).join("\n")}\n\n${summary.boundaries}\n\nПодробности: summary.json, operations.jsonl, artifacts/full-run-metrics.json (при полном прогоне). Input package не изменялся; обвязка не авторит claims.\n`);
    return summary;
  }
  let preparationMs;
  try {
    const input = measured("read input package", () => fs.readFileSync(path.resolve(options.packageFile)));
    const runtime = measured("load existing runtime", () => require("../flows/full-flow/src/full_run.js"));
    const pkg = measured("validate existing package", () => runtime.loadResearchPackage(JSON.parse(input)));
    const before = measured("repository HEAD/status before", () => (dependencies.repositoryState || repositoryState)(pkg.repositoryScope)); save("repositories-before.json", before);
    const readiness = measured("dependency readiness", () => (dependencies.diagnose || diagnose)()); save("diagnose.json", readiness);
    if (readiness.summary?.requiredFailed?.length) throw Error(`Required dependencies unavailable: ${readiness.summary.requiredFailed.join(", ")}`);
    const counts = { reads: 0, bytes: 0, ranges: new Set() };
    measured("source anchor freshness", () => checkAnchors(JSON.parse(input), pkg.repositoryScope, counts));
    save("anchor-counts.json", { reads: counts.reads, bytes: counts.bytes, uniqueRanges: counts.ranges.size });
    const packageFile = path.join(output, "research-package.json"); measured("persist unchanged package", () => fs.writeFileSync(packageFile, input));
    preparationMs = performance.now() - started;
    if (options.prepareOnly) return finish("prepared", { preparationMs });
    const pipeline = require("../flows/full-flow/src/stage_pipeline.js"), start = performance.now();
    let result;
    try {
      result = await (dependencies.runFullResearch || runtime.runFullResearch)({ packageFile, stateFile: path.join(output, "inventory-state.json"), outputRoot: path.join(output, "artifacts"),
        runStagePipeline: async options => {
          event("intent", `stage-${options.request.stage}`, "started", {});
          save(`stage-${options.request.stage}-request.json`, options.request);
          const before = fs.readFileSync(options.stateFile), start = performance.now(); let runnerMs = 0;
          try {
            const value = await pipeline.runStagePipeline({ ...options, runner: async (...args) => {
              const start = performance.now(); try { return await pipeline.runnerFor(options.request.stage)(...args); } finally { runnerMs = performance.now() - start; }
            } });
            const row = record(`stage-${options.request.stage}`, start, value.status, { runnerMs, coordinatorAndIOms: performance.now() - start - runnerMs }); stages.push(row); return value;
          } catch (error) { const row = record(`stage-${options.request.stage}`, start, "error", { runnerMs, message: error.message, stack: error.stack, stateUnchanged: fs.readFileSync(options.stateFile).equals(before) }); stages.push(row); throw error; }
        } });
      record("full run enclosing", start, result.status);
    } catch (error) { const stateFile = path.join(output, "inventory-state.json"); record("full run enclosing", start, "error", { message: error.message, stack: error.stack, stage: fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)).currentStage : 0 }); throw error; }
    const after = measured("repository HEAD/status after", () => (dependencies.repositoryState || repositoryState)(pkg.repositoryScope)); save("repositories-after.json", after);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("Source repository state changed during run");
    return finish(result.status, { preparationMs, result });
  } catch (error) { finish("error", { preparationMs, message: error.message }); throw error; }
}
if (require.main === module) (async () => { const value = await runRepeat(parseArgs(process.argv.slice(2))); console.log(JSON.stringify({ status: value.status, wallMs: value.wallMs, preparationMs: value.preparationMs })); process.exitCode = value.status === "partial" ? 3 : 0; })().catch(error => { console.error(error.message); process.exitCode = 2; });
module.exports = { parseArgs, runRepeat };
