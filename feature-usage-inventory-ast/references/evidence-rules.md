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
- Every source-confirmed evidence row names one repository from the declared scope and a file inside that repository root. Runtime recomputes SHA-256 over the complete current file; supplied, partial, or stale hashes never promote a candidate.
- Confirmed usages, confirmed capabilities, and confirmed implementation entry points may reference only source-confirmed evidence.
- Use `не проверено` for useful candidates that were not confirmed.
- Use `шум`, `generated-only`, `vendor/noise`, or `bundle-only` for excluded or non-source matches until a source-of-truth file is found.
- Use `проверено, использования нет` only when expected names, reasons, scope, and performed checks are recorded.

## Absence And Gaps

An absence claim must include:

- expected names;
- why those names were expected;
- exact declared repository and scope searched;
- performed checks, second/third/N-order objects, and linking methods checked (record `N/A` explicitly when one category does not apply);
- a complete, untruncated result;
- what path remains blocked or closed by the result.

Its evidence references must point only to absence evidence with the same repository and search scope.

If these fields are missing, mark the point as `не проверено`, not as a gap or absence.

## Noise

Separate source evidence from noise. Do not mix vendor, cache, generated output, `node_modules`, sourcemaps, minified bundles, help/locales, or compiled bundles into source evidence unless that zone is explicitly the source of truth.

Apply only noise exclusions declared in repository scope or the current request. Record every applied exclusion in the canonical result; do not infer excluded directories from familiar names.
