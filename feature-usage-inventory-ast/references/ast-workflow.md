# Local SWC AST Workflow

Use this file only after candidate discovery indicates local AST is useful.

## Contract

- Run the analyzer with the Node.js available to the skill environment.
- Resolve `@swc/core` only from the skill-local `node_modules`; install reproducibly with `npm install` in the skill root when dependencies are absent.
- Ask the user for the format and destination before creating report, stage, cache, or raw-output artifacts. Without approval, return a compact in-thread result and omit `--cache`.
- Treat every AST result as candidate evidence with status `не проверено` until confirmed in source.
- Do not use parse failures or empty AST results as proof of absence.

Check the runtime before a new environment or after dependency changes:

```bash
node scripts/prototype_ast.js doctor
```

## Scope Gate

- Do not run AST on an entire `sdkjs`, `web-apps`, `desktop-apps`, or aggregate `projects` root.
- Discover candidate files with GitNexus and/or targeted source search first.
- Pass one file with `--file`, a narrow explicit directory with `--scope`, or a UTF-8 candidate list with `--files-from`.
- A scope above 200 source files is blocked unless `--allow-wide-scope` is explicit and its reason, timeout, and fallback are recorded.
- Cache is opt-in only: `--cache <user-approved-directory>`.
- `--line-start/--line-end` bound returned evidence, but SWC still parses the complete candidate file.

## Commands

The CLI returns JSON on stdout. Default JSON is compact; `--format pretty` is an explicit raw-output choice.

```text
index, analyze, find, symbols, fields, methods,
reads, writes, assignments, calls, callers, callees,
owners, recipients, collections, chain, summary, stats, doctor
```

Common options:

```text
--file, --scope, --files-from, --type, --owner, --field,
--terms, --kind, --symbol, --line-start, --line-end,
--max-depth, --max-paths,
--max-branches, --max-results, --min-confidence,
--cache, --format, --allow-wide-scope,
--output-mode, --max-output-bytes, --max-evidence-per-item,
--max-snippet-chars, --max-groups, --group-offset, --details-for
--group-owner, --group-field, --group-relation, --group-target
```

Output defaults:

```text
--output-mode auto
--max-output-bytes 32768
--max-evidence-per-item 3
--max-snippet-chars 160
--max-groups 100
--group-offset 0
```

`auto` preserves the normal detailed JSON when it fits the byte budget. For a broad/high-fanout result it switches only the presentation layer to semantic groups keyed by `owner + relation + field/method + target`. The internal SWC analysis and complete evidence arrays remain available during the process.

Use a two-pass retrieval model:

1. Run `auto` or `summary`; inspect `data.groups` and the `coverage` block.
2. Page groups with `--group-offset <coverage.nextGroupOffset>` when `groupsTruncated` is true.
3. Retrieve evidence only for selected groups with `--details-for <group-key> --output-mode detail`.
4. Narrow further by `--owner`, `--field`, `--kind`, `--line-start/--line-end`, or `--terms` before raising the byte budget.

Every compact response reports `totalItems`, `uniqueGroups`, `groupsReturned`, `groupsTruncated`, `nextGroupOffset`, `evidenceTotal`, `evidenceReturned`, `evidenceSuppressed`, `rawOutputBytes`, `outputBytes`, and `outputBudget`. Compact output is complete only for the declared page; it is never absence evidence by itself.

Semantic group filters are exact, case-insensitive matches by default and accept `*` wildcards. They run after the full query is analyzed, so `groupsScanned` remains the complete semantic-group count while `groupsMatched` records the selected subset.

Examples:

```bash
node scripts/prototype_ast.js fields --file <file> --owner Shape --field fill
node scripts/prototype_ast.js methods --file <file> --owner Shape
node scripts/prototype_ast.js owners --type GradFill --files-from <candidate-list>
node scripts/prototype_ast.js recipients --type GradFill --scope <narrow-directory>
node scripts/prototype_ast.js calls --symbol Shape.setFill --file <file>
node scripts/prototype_ast.js assignments --terms CGradFill --file <file> --line-start 4270 --line-end 4450
node scripts/prototype_ast.js chain --type GradFill --files-from <candidate-list> --max-depth 10 --max-paths 25 --max-branches 20
node scripts/prototype_ast.js summary --terms GradFill,Shape.fill --file <file> --max-results 50
node scripts/prototype_ast.js find --terms CSpPr,spPr,setSpPr --file <file> --output-mode summary
node scripts/prototype_ast.js find --terms CSpPr,spPr,setSpPr --file <file> --group-offset 50 --output-mode summary
node scripts/prototype_ast.js find --terms CSpPr,spPr,setSpPr --file <file> --details-for g-0123456789ab --output-mode detail
node scripts/prototype_ast.js find --terms CSpPr,spPr,setSpPr --file <file> --group-owner CChartSpace --group-field spPr --output-mode summary
```

## Optimized Stage 2

For a full-inventory stage 2, read `stage-2-contract.md` first and treat it as the active stage contract. Do not load the general staged/report references unless a validation failure or transition ambiguity requires them.

For dictionary expansion, create a JSON request file and run:

```bash
node scripts/stage2_runner.js --request <stage2-request.json> --output <facts.json> --stdout summary
```

The request contains `stage: 2`, `transitionArtifact`, `ast.queries`, and `evidence.checks`. Each AST query declares `command`, `file` or `files`, normal query `options`, optional semantic `groupFilters`, and whether selected `details` are required. The runner:

1. extracts only the required transition fields from the previous artifact;
2. parses every unique candidate file once for the whole batch;
3. runs `symbols`, `methods`, and `find` over the shared analysis;
4. scans all semantic groups and returns only requested group families;
5. performs bounded source checks over explicit files/scopes;
6. performs budget preflight and emits a facts-first JSON artifact without suppressing requested details; when necessary, it raises the applied presentation budget without reparsing.

Use `node scripts/ast_batch.js --request <ast-request.json>` when only shared AST execution is needed. Use `node scripts/source_evidence.js --request <evidence-request.json>` for standalone source confirmation. Pass JSON through files on Windows; do not embed raw JSON in PowerShell arguments.

Quality gates for stage 2:

- every entry in `ast.stats.parseCounts` equals `1`;
- every query reports `groupsScanned`, `groupsMatched`, and evidence/detail suppression counters;
- selected groups with required evidence have `detailsRequested == detailsReturned`, `detailsSuppressed == 0`, and `detailEvidenceSuppressed == 0`;
- source checks report total, returned, and truncated counts;
- empty checks stay `candidate-empty` until a separate absence protocol is completed;
- the facts artifact reports requested, required, and applied output budgets; the applied budget may be raised to preserve required evidence.

Use `node scripts/measure_context.js --request <measurement-request.json>` to measure raw and model-visible byte/token estimates without logging contents. Use `node scripts/render_stage2_report.js --input <facts.json> --output <report.md> --stdout summary` to render the existing facts deterministically without returning the full report through stdout. Ask before writing either output to a persistent artifact. Summary stdout is valid only when the full artifact is retained at the approved output path.

Use raw `analyze` only for a bounded single file:

```bash
node scripts/prototype_ast.js analyze --file <file>
```

`analyze` retains compatibility arrays for `constructors`, `fields`, `prototypeMethods`, `variables`, `aliases`, `instanceAssignments`, `setterAssignments`, `arrayOwnership`, `indexedAssignments`, `owners`, and `chains`, while also returning versioned `symbols` and `relations`.

For R7 legacy names, owner/type queries treat a leading constructor `C` as a normalized alias (`GradFill` can match `CGradFill`). Such rows contain `matchMode: "legacy-c-prefix"`; they are not exact-name evidence. `calls`, `callers`, and `callees` include both normal calls and `construct` relations.

## Output And Failures

Every response contains:

```text
schemaVersion, command, parser, status, data,
stats, warnings, errors
```

Responses that contain query items also include a top-level `coverage` block. When adaptive compaction is used, `data.groups` contains the current semantic-group page and `recommendedQueries` contains bounded follow-up command templates.

Exit codes:

- `0`: successful execution, including honest `not-found`;
- `1`: one or more parse/analysis failures; successful files remain in the candidate set;
- `2`: invalid arguments, unknown command, unsupported format, or blocked scope.

SWC byte spans are mapped to UTF-8 line/column coordinates by a per-file line index. Evidence contains a bounded snippet, extractor, confidence, and `не проверено` status.

## Inventory Stage Mapping

- Stage 1: `fields`, `owners`, `collections` for ownership and persistence candidates.
- Stage 2: `symbols`, `methods`, `find` for dictionary and alias expansion.
- Stage 4: `recipients` and `collections` for fanout candidates.
- Stage 5: `calls`, `callers`, `callees`, and bounded `chain` for critical-path candidates.
- Stage 7: `summary` plus exact source reads for candidate/evidence separation.

Record parser/schema version, candidate files, exact command, parsed/skipped/failed counts, returned/truncated counts, limitations, and pending source confirmations in the stage transition artifact.
