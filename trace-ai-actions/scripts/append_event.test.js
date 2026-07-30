"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { appendEvent, redactString, sanitize } = require("./append_event");

test("appends ordered JSONL events", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trace-ai-actions-"));
  const log = path.join(directory, "trace.jsonl");
  appendEvent({ log, event: "intent", operation: "read", maxString: 1000 });
  appendEvent({ log, event: "result", status: "ok", maxString: 1000 });
  const events = fs.readFileSync(log, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(events.map((event) => event.event), ["intent", "result"]);
});

test("redacts sensitive keys and common credential patterns", () => {
  const output = sanitize({ token: "abc", command: "API_KEY=secret Bearer abc.def", nested: { password: "pw" } }, 1000);
  assert.equal(output.token, "[REDACTED]");
  assert.equal(output.nested.password, "[REDACTED]");
  assert.equal(output.command, "API_KEY=[REDACTED] Bearer [REDACTED]");
  assert.equal(redactString("https://user:pass@example.com", 1000), "https://[REDACTED]@example.com");
});

test("bounds strings and arrays", () => {
  const output = sanitize({ text: "x".repeat(200), items: Array.from({ length: 80 }, (_, index) => index) }, 80);
  assert.equal(output.text.length, 80);
  assert.equal(output.items.length, 50);
});

test("protects generated timestamp and sequence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trace-ai-actions-"));
  const eventFile = path.join(directory, "event.json");
  const log = path.join(directory, "trace.jsonl");
  fs.writeFileSync(eventFile, JSON.stringify({ event: "result", timestamp: "forged", sequence: 999 }));
  appendEvent({ log, eventFile, maxString: 1000 });
  const event = JSON.parse(fs.readFileSync(log, "utf8"));
  assert.notEqual(event.timestamp, "forged");
  assert.equal(event.sequence, 1);
});
