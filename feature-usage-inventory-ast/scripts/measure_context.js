#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_BYTES_PER_TOKEN = 4;

function byteLength(value, spacing = 0) {
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  return Buffer.byteLength(JSON.stringify(value, null, spacing), "utf8");
}

function estimateTokens(bytes, bytesPerToken = DEFAULT_BYTES_PER_TOKEN) {
  const ratio = Number(bytesPerToken);
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("bytesPerToken must be a positive number");
  return Math.ceil(Math.max(0, Number(bytes) || 0) / ratio);
}

function measureValue(value, options = {}) {
  const bytes = byteLength(value, options.spacing || 0);
  return {
    bytes,
    estimatedTokens: estimateTokens(bytes, options.bytesPerToken),
    bytesPerToken: Number(options.bytesPerToken) || DEFAULT_BYTES_PER_TOKEN,
  };
}

function measureInput(input, options = {}) {
  if (!input || typeof input !== "object") throw new Error("Each input must be an object");
  let bytes;
  let source;
  if (input.file) {
    bytes = fs.readFileSync(path.resolve(input.file)).length;
    source = "file";
  } else if (Object.prototype.hasOwnProperty.call(input, "bytes")) {
    bytes = Math.max(0, Number(input.bytes) || 0);
    source = "declared-bytes";
  } else if (Object.prototype.hasOwnProperty.call(input, "value")) {
    bytes = byteLength(input.value, input.spacing || 0);
    source = "value";
  } else {
    throw new Error(`Input ${input.id || "<unnamed>"} requires file, bytes, or value`);
  }
  return {
    id: input.id || "input",
    category: input.category || "other",
    source,
    modelVisible: input.modelVisible !== false,
    bytes,
    estimatedTokens: estimateTokens(bytes, options.bytesPerToken),
  };
}

function measureContext(request) {
  if (!request || !Array.isArray(request.inputs)) throw new Error("Measurement request requires inputs array");
  const bytesPerToken = Number(request.bytesPerToken) || DEFAULT_BYTES_PER_TOKEN;
  const inputs = request.inputs.map((input) => measureInput(input, { bytesPerToken }));
  const totals = inputs.reduce((result, input) => {
    result.rawBytes += input.bytes;
    result.rawEstimatedTokens += input.estimatedTokens;
    if (input.modelVisible) {
      result.modelVisibleBytes += input.bytes;
      result.modelVisibleEstimatedTokens += input.estimatedTokens;
    }
    return result;
  }, { rawBytes: 0, rawEstimatedTokens: 0, modelVisibleBytes: 0, modelVisibleEstimatedTokens: 0 });
  return { schemaVersion: "1.0.0", bytesPerToken, inputs, totals };
}

function applySafeBudget(output, requestedBytes, defaultBytes, minimumBytes = 4096) {
  const budgetRequested = Math.max(minimumBytes, Number(requestedBytes) || defaultBytes);
  output.output = {
    bytes: 0,
    budget: budgetRequested,
    bounded: true,
    budgetRequested,
    budgetRequired: 0,
    budgetApplied: budgetRequested,
    autoRaised: false,
    policy: "preserve-required-evidence",
  };
  let previous = -1;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const required = byteLength(output);
    output.output.bytes = required;
    output.output.budgetRequired = required;
    output.output.budgetApplied = Math.max(budgetRequested, required);
    output.output.budget = output.output.budgetApplied;
    output.output.autoRaised = required > budgetRequested;
    output.output.bounded = required <= output.output.budgetApplied;
    const measured = byteLength(output);
    if (measured === previous && measured === output.output.bytes) break;
    previous = measured;
    output.output.bytes = measured;
    output.output.budgetRequired = measured;
  }
  const finalBytes = byteLength(output);
  output.output.bytes = finalBytes;
  output.output.budgetRequired = finalBytes;
  output.output.budgetApplied = Math.max(budgetRequested, finalBytes);
  output.output.budget = output.output.budgetApplied;
  output.output.autoRaised = finalBytes > budgetRequested;
  output.output.bounded = finalBytes <= output.output.budgetApplied;
  return output.output;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!['--request', '--output', '--pretty'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if (arg === '--pretty') options.pretty = true;
    else {
      if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++index];
    }
  }
  if (!options.request) throw new Error("Provide --request <json-file>");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const request = JSON.parse(fs.readFileSync(path.resolve(options.request), "utf8"));
    const result = measureContext(request);
    const text = `${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`;
    if (options.output) fs.writeFileSync(path.resolve(options.output), text);
    process.stdout.write(text);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { DEFAULT_BYTES_PER_TOKEN, applySafeBudget, byteLength, estimateTokens, measureContext, measureValue, parseArgs };
