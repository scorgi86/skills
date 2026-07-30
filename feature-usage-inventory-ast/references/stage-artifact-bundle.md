# Stage Artifact Bundle

Use this contract when an AST-backed stage persists a report and its supporting evidence. Ask the user for the output location and desired artifact set before writing anything.

## Required Files

```text
stage-2/
├── report.md
├── manifest.json
├── transition.json
├── facts.json
├── findings.jsonl
├── evidence.jsonl.gz
├── coverage.json
├── validation.json
└── evidence-view/
    ├── ownership.md
    ├── persistence.md
    └── recipients.md
```

- `report.md` is the deterministic human-readable report. It contains concrete names, the executed pipeline, limitations, DoD, transition data, and relative artifact links.
- `manifest.json` records schemas, source state, plan id, cache state, counts, sizes, and SHA-256 values.
- `transition.json` is the structured data for continuing analysis after an explicit user command.
- `facts.json` preserves the complete stage facts contract for compatibility and quality comparison.
- `findings.jsonl` stores normalized aggregates. Internal ids are allowed here but not in the report.
- `evidence.jsonl.gz` stores normalized AST/source evidence, source hashes, and provenance.
- `coverage.json` stores full counters and digests before presentation limits.
- `validation.json` stores deterministic generation gates.
- `evidence-view/*.md` provides bounded human-readable evidence projections.

## Traceability

Preserve this direction:

```text
report statement -> finding -> evidence -> source file/range/hash
```

Every confirmed finding must reference at least one evidence record. A source match or AST group alone remains a candidate and must not be promoted automatically. Store technical ids only in machine artifacts; show owners, fields, targets, relations, and source locations in Markdown.

## Freshness

Record Git HEAD when known and SHA-256 for every available source file referenced by evidence. Query tools must report whether selected evidence is current, stale, or unavailable. A stale artifact may guide navigation but cannot prove current behavior or absence.

## Persistence Versus Cache

The bundle is a result and evidence base, not a computation cache. `--no-cache` may create a new bundle but must not read a previous bundle as analysis input. Reusing a bundle for a later user task is allowed only when the task permits existing artifacts; retrieve bounded records with `query_stage_artifacts.js`.

## Generation

Use one of:

```text
node scripts/stage2_runner.js --request request.json --bundle <new-directory> --stdout summary
node scripts/stage2_bundle.js --input facts.json --output <new-directory>
```

The destination must not already exist. Build in a sibling temporary directory, validate it, and publish it atomically. On success stdout must contain only the compact manifest summary and remain below 4 KiB. Use `--debug` only when detailed facts are explicitly needed in model context.

## Report Pipeline And Links

Generate the Mermaid pipeline from actual runtime facts. Do not show a graph, cache, source confirmation, or quality gate as completed when its manifest state says otherwise. Use relative links so the bundle remains portable and archive-safe.

## Querying

Use `scripts/query_stage_artifacts.js` with owner, field, target, relation, file, status, or finding filters. Default to at most 20 findings and omit evidence unless `--include-evidence` is requested. Write larger results to a user-approved output path instead of stdout.

## Validation

Run `scripts/validate_stage_bundle.js <bundle-directory>`. Require:

- all required files;
- matching sizes and SHA-256 values;
- resolvable relative report links;
- a generated Mermaid pipeline;
- complete transition fields;
- valid finding-to-evidence references;
- evidence for every confirmed finding;
- no internal ids in the main report.

Keep the stage partial and do not publish the bundle if validation, coverage, equivalence, source hashing, or report budget checks fail.
