---
name: trace-ai-actions
description: Show a concise, user-visible trace of AI operations while another task or skill runs, and optionally persist sanitized events as JSONL. Use when the user asks to see actions, commands, tool calls, files accessed, progress, decisions, validation results, delegation, or an audit trail. Compose with domain skills without changing their workflow, scope, safety rules, or evidence requirements.
---

# Trace AI Actions

Add an observability protocol to the active task. Do not turn the task into a separate staged workflow.

## Defaults

- Default to `live` mode and `summary` level.
- Do not create a file unless the user requests persistence and approves its destination.
- Let the domain skill decide what work to perform. Only describe and record that work.
- Follow stricter domain, repository, safety, approval, and artifact rules when they conflict with this skill.

Supported modes:

- `live`: publish trace updates in commentary.
- `file`: append sanitized JSONL events without repeating every event in chat.
- `live+file`: do both.

Supported levels:

- `summary`: group related low-level calls into meaningful operations.
- `detailed`: record each material tool call, command, target, status, and bounded result. Still omit secrets and noisy payloads.

## Event Loop

For each material operation:

1. Emit `INTENT` before acting: purpose, scope, tool category, and expected result.
2. Emit `ACTION` when useful: tool or sanitized command, target files/scopes, limits, and whether the action writes state.
3. Emit `RESULT` after acting: success/failure, exit status, counts, elapsed time when available, truncation, and relevant artifacts.
4. Emit `DECISION` only when the result changes the route: concise evidence-based reason and next operation.

Publish a progress update at least every 60 seconds during ongoing work. Report retries, blocked scopes, approvals, validation failures, and protocol deviations explicitly.

Do not log every line read, every AST node, or full command output. Aggregate repetitive reads and searches while preserving files, ranges, counts, errors, and truncation.

## Live Format

Use compact entries:

```text
[TRACE 03] INTENT  Confirm selected AST candidates in source.
[TRACE 03] ACTION  Read 5 explicit files; no writes; max 12 matches/check.
[TRACE 03] RESULT  checks=5, matches=844, returned=60, truncated=true.
[TRACE 03] DECISION Evidence is sufficient; run stage validation next.
```

Use commentary for in-progress trace entries. In the final response, include a self-contained `Trace Summary` with operations completed, mutations, validations, failures/limitations, artifacts, and trace-log path when one exists.

## Persistent JSONL

Use `scripts/append_event.js` only after the destination is approved. Prefer one event per line with this shape:

```json
{"timestamp":"ISO-8601","sequence":1,"event":"result","operation":"AST batch","status":"ok","data":{"parsed":5,"failed":0}}
```

Write an event from scalar arguments:

```bash
node scripts/append_event.js --log <trace.jsonl> --event result --operation "AST batch" --status ok --summary "parsed=5 failed=0"
```

For structured data, place one JSON object in a temporary or approved request file rather than passing raw JSON through PowerShell:

```bash
node scripts/append_event.js --log <trace.jsonl> --event-file <event.json>
```

The logger adds timestamp and sequence, bounds large values, and redacts sensitive keys and common credential patterns. The caller must still avoid sending secrets to the logger.

## Visibility Boundary

Expose operational facts and concise, verifiable rationale:

- plans and intended operations;
- tools and sanitized commands;
- files, repositories, scopes, and write effects;
- outputs, metrics, exit codes, truncation, and errors;
- approvals, delegation tasks, validation, and next steps.

Do not expose or claim to expose:

- hidden chain-of-thought or token-by-token reasoning;
- system, developer, policy, or private platform instructions;
- credentials, authorization headers, cookies, private keys, or secret environment values;
- unbounded source, AST, logs, or tool payloads.

Replace private reasoning with a short decision record tied to observable evidence.

## Composition

When invoked with another skill:

1. Load and follow both skills.
2. Preserve the other skill's phases, gates, DoD, artifact rules, and stop conditions.
3. Add trace entries around its material operations.
4. Do not duplicate its report; add only `Trace Summary` and an optional JSONL artifact.
5. Never use tracing to broaden authorization or bypass an approval.

Example:

```text
Use $trace-ai-actions in live+file detailed mode together with
$feature-usage-inventory-ast. Save the trace to context/inventory-trace.jsonl.
```

## Final Check

- Were material reads, writes, commands, tests, and validations visible?
- Were repetitive operations aggregated without hiding failures or truncation?
- Were mutations and approvals distinguished from read-only checks?
- Were secrets and hidden reasoning excluded?
- Does the final response contain a self-contained trace summary?
