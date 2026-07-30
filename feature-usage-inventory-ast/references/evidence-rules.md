# Evidence Rules

Use this file whenever GitNexus, local AST, text search, file-name search, or manual candidate filtering is involved.

## Source Strength

| Source | Allowed use | Required confirmation | Cannot prove alone |
|---|---|---|---|
| GitNexus `query` | Candidate processes, symbols, definitions | Manual read or targeted search of each candidate when allowed | Absence, full coverage, exact ownership |
| GitNexus `context` | Callers/callees/imports/properties/process participation | Manual read of relevant files and independent search when allowed | Final blast radius for prototype-style JS |
| GitNexus `cypher` | Structural candidates and graph relationships | Concrete file/symbol evidence | Semantic behavior or checked-no-usage |
| GitNexus `impact` | Risk and affected flows | Review direct results and confirm important paths in files | Low risk when graph is partial or target unresolved |
| GitNexus `trace` | Scenario path candidates | Manual confirmation of critical transitions | Complete scenario coverage |
| Local AST | Constructors, fields, prototype methods, assignments, owner/chain candidates | Manual read or targeted search of candidate files | Confirmed usage or absence |
| Manual source read | Concrete evidence | Exact file/line/symbol and role | Coverage outside the read scope |

## Promotion Rules

- A candidate becomes `подтвержденное использование` only when the file, symbol/property/method, role, and path are verified.
- Use `не проверено` for useful candidates that were not confirmed.
- Use `шум`, `generated-only`, `vendor/noise`, or `bundle-only` for excluded or non-source matches until a source-of-truth file is found.
- Use `проверено, использования нет` only when expected names, reasons, scope, and performed checks are recorded.

## Absence And Gaps

An absence claim must include:

- expected names;
- why those names were expected;
- exact scope searched;
- second/third/N-order objects or linking methods checked;
- what path remains blocked or closed by the result.

If these fields are missing, mark the point as `не проверено`, not as a gap or absence.

## Noise

Separate source evidence from noise. Do not mix vendor, cache, generated output, `node_modules`, sourcemaps, minified bundles, help/locales, or compiled bundles into source evidence unless that zone is explicitly the source of truth.

When using R7, load `search-noise-profiles.json` when file/text/GitNexus/AST/manual filtering may hit generated/vendor/help/resource noise. Use `r7_default` first and `r7_extended` only if default still returns noisy output.
