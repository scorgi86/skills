# Local SWC AST Workflow

Use this file only after candidate discovery indicates local AST is useful.

## Contract

- Run the analyzer with the Node.js available to the skill environment.
- Resolve `@swc/core` only from the skill-local `node_modules`; install reproducibly with `npm install` in the skill root when dependencies are absent.
- Use the automatic inventory artifact path unless the user supplies another destination. Direct AST cache and raw output remain opt-in; the full-flow pipeline configures its own runtime cache for Stage 1–2.
- Treat every AST result as candidate evidence with status `не проверено` until confirmed in source.
- Do not use parse failures or empty AST results as proof of absence.

Check the runtime before a new environment or after dependency changes:

```bash
node scripts/cli/src/commands/prototype_ast.js doctor
```

## Scope Gate

- Do not run AST over every declared root. Narrow candidates with graph and source search first.
- Discover candidate files with GitNexus and/or targeted source search first.
- Pass one file with `--file`, a narrow explicit directory with `--scope`, or a UTF-8 candidate list with `--files-from`.
- A scope above 200 source files is blocked unless `--allow-wide-scope` is explicit and its reason, timeout, and fallback are recorded.
- Cache is opt-in only: `--cache <directory>`.
- File-analysis concurrency is opt-in through `--concurrency <positive-integer>` or `ast.concurrency` in a batch request. The default is `1`.
- `--line-start/--line-end` bound returned evidence; a cache miss still parses the complete candidate file.

## File analysis cache

`--cache <directory>` reuses file analysis (symbols, relations and candidate evidence) and eligible batch query results, not AST trees. Without this option there is no cache IO or hashing. Each enabled analysis reads the source once, hashes its raw bytes and checks the cache before parsing. A valid hit skips SWC and extraction; a miss parses the UTF-8 text decoded from the same bytes. Source confirmation still runs. This is consistency of one read, not an atomic filesystem snapshot.

Programmatic `analyzeFiles`, `runAstBatch`, `runStage1`, `runStage2`, and `prototype_ast.execute` return promises. With concurrency `1`, analysis uses the ordinary in-process loop and creates no workers. Higher values create a bounded `worker_threads` pool for unique files only; results are restored to deterministic input order before queries run. Read and parse diagnostics remain per-file results. Worker startup, protocol, error, or premature-exit failures reject the batch after all created workers are terminated.

Identity includes the absolute file path, raw content hash, parser options and SWC version, plus private cache format and analyzer versions in `scripts/shared/ast/src/cache/identity.js`. Bump the analyzer version when symbol/relation/evidence extraction or affecting dependencies change; bump the format version when the stored contract changes. These versions are separate from the public output schema. Old keys are ignored without migration or deletion. No Git or size/mtime shortcut is used.

Entries are checked against the expected identity and nested result structure. Validation does not authenticate arbitrary semantic substitutions; all evidence remains `не проверено`. A malformed/incompatible current entry or cache read failure causes one fresh analysis with `cache: failed` and a warning, without repairing the entry in that call. Source read/parse failures instead retain their diagnostics and `cache: disabled`; they are never cached. Analyzer exceptions propagate rather than being reported as cache failures.

Successful misses publish through a unique temporary file and rename in the same directory. Write/rename failure returns the computed result with a cache warning, without repeating analysis or deleting another writer's entry. Cleanup of the call's own temporary file is best effort. There is no automatic cache cleanup.

Legacy `stats.parsed` counts successful file results, including hits; batch `parseCounts` records planned file processing, not measured SWC calls. Per-result `elapsedMs` retains the original parser duration (including on a hit); aggregate `stats.elapsedMs` measures the current analysis call. Use external measurements to compare actual run times.

For full-flow Stage 1–2, the automatic cache is stored at `<parent-of-outputRoot>/.runtime-cache/ast/<scopeDigest>`. Inventory directories under the same parent and with the same normalized repository scope therefore reuse file analysis and eligible batch queries. A different parent or scope is isolated. An explicit `request.ast.cache` remains authoritative. The shared cache still reads and hashes every candidate file before accepting a file-analysis hit; source confirmation always runs again. The runtime does not clean this disposable cache automatically.

Eligible batch query results are stored below `<cache>/query-results`. Their identity contains the query-cache version, command, functional query options and the ordered identities of every scoped file analysis. Adding, removing, renaming or changing a file therefore invalidates dependent results, including `not-found`; unrelated queries remain reusable. The cache stores the complete item collection before grouping, detail selection and output budgeting, so those projections still run for every request. `maxResults` retains its existing batch behavior and does not split the cache key. `stats`, `chain`, unknown commands, parse failures and analyses without a content identity are never cached. Cache diagnostics remain internal and do not change serialized AST or canonical facts. Malformed or inaccessible entries fail open to a normal query execution.

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
--cache, --concurrency, --format, --allow-wide-scope,
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
node scripts/cli/src/commands/prototype_ast.js fields --file <file> --owner FeatureContainer --field value
node scripts/cli/src/commands/prototype_ast.js methods --file <file> --owner FeatureContainer
node scripts/cli/src/commands/prototype_ast.js owners --type FeatureValue --files-from <candidate-list>
node scripts/cli/src/commands/prototype_ast.js recipients --type FeatureValue --scope <narrow-directory>
node scripts/cli/src/commands/prototype_ast.js calls --symbol FeatureContainer.setValue --file <file>
node scripts/cli/src/commands/prototype_ast.js assignments --terms FeatureValue --file <file> --line-start 20 --line-end 80
node scripts/cli/src/commands/prototype_ast.js chain --type FeatureValue --files-from <candidate-list> --max-depth 10 --max-paths 25 --max-branches 20
node scripts/cli/src/commands/prototype_ast.js summary --terms FeatureValue,Container.value --file <file> --max-results 50
node scripts/cli/src/commands/prototype_ast.js find --terms FeatureState,value,setValue --file <file> --output-mode summary
node scripts/cli/src/commands/prototype_ast.js find --terms FeatureState,value,setValue --file <file> --group-offset 50 --output-mode summary
node scripts/cli/src/commands/prototype_ast.js find --terms FeatureState,value,setValue --file <file> --details-for g-0123456789ab --output-mode detail
node scripts/cli/src/commands/prototype_ast.js find --terms FeatureState,value,setValue --file <file> --group-owner FeatureContainer --group-field value --output-mode summary
```

## Optimized Stage 2

For a full-inventory stage 2, read `stage-2-contract.md` first and treat it as the active stage contract. Do not load the general staged/report references unless a validation failure or transition ambiguity requires them.

For dictionary expansion, create a JSON request file and run:

```bash
node scripts/cli/src/commands/stage_pipeline.js --request <stage2-request.json> --state <inventory-state.json> --output-root <inventory-artifact-directory>
```

The request contains `stage: 2`, `transitionArtifact`, `ast.queries`, and `evidence.checks`. Each AST query declares `command`, `file` or `files`, normal query `options`, optional semantic `groupFilters`, and whether selected `details` are required. The runner:

1. extracts only the required transition fields from the previous artifact;
2. parses every unique candidate file once for the whole batch;
3. runs `symbols`, `methods`, and `find` over the shared analysis;
4. scans all semantic groups and returns only requested group families;
5. performs bounded source checks over explicit files/scopes;
6. performs budget preflight and emits a facts-first JSON artifact without suppressing requested details; when necessary, it raises the applied presentation budget without reparsing.

Use `node scripts/cli/src/commands/ast_batch.js --request <ast-request.json>` when only shared AST execution is needed. Use `node scripts/cli/src/commands/source_evidence.js --request <evidence-request.json>` for standalone source confirmation. Pass JSON through files on Windows; do not embed raw JSON in PowerShell arguments.

Quality gates for stage 2:

- every entry in `ast.stats.parseCounts` equals `1`;
- every query reports `groupsScanned`, `groupsMatched`, and evidence/detail suppression counters;
- selected groups with required evidence have `detailsRequested == detailsReturned`, `detailsSuppressed == 0`, and `detailEvidenceSuppressed == 0`;
- source checks report total, returned, and truncated counts;
- empty checks stay `candidate-empty` until a separate absence protocol is completed;
- the facts artifact reports requested, required, and applied output budgets; the applied budget may be raised to preserve required evidence.

Use `node scripts/cli/src/commands/measure_context.js --request <measurement-request.json>` to measure raw and model-visible byte/token estimates without logging contents. Use deterministic renderers only after canonical persistence; summary stdout is valid only when the complete canonical artifact is retained at the automatic or explicitly supplied output path.

Use raw `analyze` only for a bounded single file:

```bash
node scripts/cli/src/commands/prototype_ast.js analyze --file <file>
```

`analyze` retains compatibility arrays for `constructors`, `fields`, `prototypeMethods`, `variables`, `aliases`, `instanceAssignments`, `setterAssignments`, `arrayOwnership`, `indexedAssignments`, `owners`, and `chains`, while also returning versioned `symbols` and `relations`.

Apply symbol aliases only when they are declared in repository scope. Alias matches are not exact-name evidence. `calls`, `callers`, and `callees` include both normal calls and `construct` relations.

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
