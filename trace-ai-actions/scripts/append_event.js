#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|passwd|private[_-]?key|secret|session|token|api[_-]?key)/i;
const VALUE_OPTIONS = new Set(["log", "event", "event-file", "operation", "status", "summary", "tool", "target", "next", "step", "duration-ms", "max-string"]);

function redactString(value, maxString = 1000) {
  let text = String(value);
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  text = text.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
  text = text.replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)=([^\s]+)/gi, "$1=[REDACTED]");
  text = text.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@");
  if (text.length > maxString) return `${text.slice(0, Math.max(0, maxString - 1))}…`;
  return text;
}

function sanitize(value, maxString, key = "", depth = 0) {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (depth > 8) return "[MAX_DEPTH]";
  if (typeof value === "string") return redactString(value, maxString);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, maxString, "", depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([childKey, childValue]) => [childKey, sanitize(childValue, maxString, childKey, depth + 1)]));
  }
  return value;
}

function parseArgs(argv) {
  const options = { maxString: 1000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (!VALUE_OPTIONS.has(name)) throw new Error(`Unknown option: ${arg}`);
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error(`Missing value for ${arg}`);
    const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = argv[++index];
  }
  if (!options.log) throw new Error("Provide --log <trace.jsonl>");
  if (!options.event && !options.eventFile) throw new Error("Provide --event <type> or --event-file <event.json>");
  options.maxString = Math.max(80, Number(options.maxString) || 1000);
  return options;
}

function nextSequence(logFile) {
  if (!fs.existsSync(logFile)) return 1;
  const lines = fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return 1;
  try {
    const previous = JSON.parse(lines[lines.length - 1]);
    return Number.isFinite(Number(previous.sequence)) ? Number(previous.sequence) + 1 : lines.length + 1;
  } catch {
    return lines.length + 1;
  }
}

function buildEvent(options) {
  let input = {};
  if (options.eventFile) input = JSON.parse(fs.readFileSync(path.resolve(options.eventFile), "utf8"));
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("Event file must contain one JSON object");
  const scalar = {};
  for (const key of ["event", "operation", "status", "summary", "tool", "target", "next", "step", "durationMs"]) {
    if (options[key] !== undefined) scalar[key] = options[key];
  }
  const event = { ...input, ...scalar };
  if (typeof event.event !== "string" || !event.event.trim()) throw new Error("Event object requires a non-empty string event");
  delete event.timestamp;
  delete event.sequence;
  return event;
}

function appendEvent(options) {
  const logFile = path.resolve(options.log);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const event = sanitize(buildEvent(options), options.maxString);
  const record = { ...event, timestamp: new Date().toISOString(), sequence: nextSequence(logFile) };
  fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`, "utf8");
  return { log: logFile, sequence: record.sequence, event: record.event, bytes: Buffer.byteLength(JSON.stringify(record), "utf8") };
}

function main() {
  try {
    const result = appendEvent(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { appendEvent, buildEvent, nextSequence, parseArgs, redactString, sanitize };
