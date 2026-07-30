# GitNexus Workflow

Use this file for GitNexus-assisted inventory, graph candidates, callers/callees, trace, impact, and cross-repo usage mapping.

## Order

1. Run `list_repos` or otherwise identify the exact repository names and index freshness.
2. Pick explicit repo scope. For R7, prefer `sdkjs`, `web-apps`, and `desktop-apps` over aggregate `projects`.
3. Use focused `query` for concept discovery only if full-text search is healthy.
4. Use `context` for known symbols, classes, functions, APIs, and likely owners.
5. Use `cypher` for exact structural candidates by name/path/property-like terms.
6. Use `trace` for candidate scenario paths and `impact` for blast radius when those tools are available and relevant.
7. Convert graph results into candidate files/symbols.
8. Confirm important candidates by exact source reading and/or targeted search when allowed.

## Exact-Seed Routing

- When one or more exact seed symbols are already known, do not begin with a broad text `query`.
- Run one bounded `context`, callers/callees, or trace operation per seed and extract only candidate names, files, and relationships needed by the active stage.
- Use broad `query` only to discover vocabulary that is not represented by known seed symbols.
- Record the routing choice and index health. A precise call reduces presentation noise but does not change the requirement for source confirmation.

## Limitations To Record

Record these in the stage artifact or final answer when present:

- stale index or branch mismatch;
- FTS missing/degraded warning;
- unresolved symbol;
- empty `query`;
- partial repository coverage;
- graph misses prototype-style JavaScript methods or assignment-style APIs;
- tool unavailable.

Empty GitNexus results are graph-layer negatives only. They are never checked-no-usage by themselves.

## Good GitNexus Use

- Use `context` when a seed symbol is known.
- Use `cypher` when text search is degraded but exact names, file paths, or symbol names are known.
- Use returned callers/callees as a candidate map, not final evidence.
- Use process participation to discover scenario starts, then confirm the transition in files.

## Output Control

- Prefer concise result summaries over dumping large graph payloads.
- If a result is huge, extract candidate names/files and continue with focused calls.
- Keep raw output out of chat unless it is small and directly needed as evidence.
