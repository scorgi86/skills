# GitNexus AST Adoption Plan

Use this reference when preparing or changing `feature-usage-inventory-ast` so it becomes a graph/AST-assisted inventory mode instead of a duplicate of the classic inventory skill.

## Goal

Turn `feature-usage-inventory-ast` into a mode that starts from GitNexus graph evidence, expands through AST/call relationships, and then validates every candidate with text search and file reading.

Classic inventory remains text-first:

```text
rg content + rg filenames -> candidate files -> manual reading -> report
```

AST inventory becomes graph-assisted:

```text
GitNexus context/cypher/impact/trace -> graph candidates -> rg validation -> manual reading -> report
```

## Non-Negotiable Rules

- Do not treat an empty GitNexus `query` result as proof of absence.
- Do not treat GitNexus output as final evidence until the related file or symbol is read or otherwise verified.
- Always run content search and file-name search on real repository roots for absence claims.
- For R7, use `repo: "@r7"` for cross-repo graph lookup and real roots for `rg`.
- Mark graph-only results as candidates until confirmed.
- Record limitations: FTS/BM25 can be unavailable, large files can be skipped, dynamic dispatch may be invisible, generated/vendor files are not source-of-truth by default.

## R7 Scope

Use these GitNexus repositories:

| Scope | Use |
|---|---|
| `@r7` | Cross-repo lookup across linked R7 repositories |
| `sdkjs` | SDK/editor code |
| `web-apps` | Web application code |
| `desktop-apps` | Desktop application code; indexed with `--skip-git` |

Use these real roots for text and filename search:

```text
C:\work\R7\main\sdkjs
C:\work\R7\main\web-apps
C:\work\R7\main\desktop-apps
```

Treat `C:\work\R7\main\projects` as an aggregate workspace, not the primary GitNexus analysis root.

## Evidence Types

Use these evidence source labels in AST reports:

| Evidence | Meaning |
|---|---|
| `gitnexus-context` | Symbol callers, callees, members, process participation from `context` |
| `gitnexus-cypher` | Structural candidates found with graph queries |
| `gitnexus-impact` | Upstream/downstream blast radius from `impact` |
| `gitnexus-trace` | Path between two symbols from `trace` |
| `gitnexus-query` | Search result from `query`; candidate only when FTS is unavailable |
| `rg-content` | Text content match from real repository roots |
| `rg-filename` | File or directory name match from real repository roots |
| `manual-read` | File or symbol was opened and interpreted |

## Stage Plan

### Stage 0 - Preparation

Actions:
- Confirm that the task needs AST/GitNexus assistance rather than classic inventory only.
- Define scope: `@r7` or a specific repo.
- List seed terms, expected symbols, file-name variants, owner objects, and possible cross-repo recipients.
- Check GitNexus availability with `list_repos` or a known `context` query.

DoD:
- [ ] Scope includes exact repo names and real roots.
- [ ] Seed terms include text variants and symbol/file-name variants.
- [ ] GitNexus index availability is known.
- [ ] Known limitations are recorded before absence claims.

### Stage 1 - GitNexus Seed Expansion

Actions:
- Use `context({ repo: "@r7", name: "<symbol>" })` for known seed symbols.
- Use repo-specific `context` when the symbol is known to live in one repo.
- Use `cypher` for structural candidate discovery by symbol names, classes, methods, properties, routes, or imports.
- Use `query` only as a helper; if FTS/BM25 is unavailable, treat empty results as inconclusive.

DoD:
- [ ] Every known seed symbol has a `context` result or a documented not-found result.
- [ ] Graph candidates are tagged by repo and evidence type.
- [ ] Ambiguous symbols have chosen candidates or documented ambiguity.
- [ ] Empty `query` results are not used as absence proof.

### Stage 2 - Text Search Validation

Actions:
- Run content search over real roots for seed terms and expanded aliases.
- Run file-name/directory-name search over real roots.
- Classify matches by source/test/generated/vendor/cache/docs/linked-external zones.
- Open candidate files that can affect conclusions.

DoD:
- [ ] Content search was performed.
- [ ] File-name search was performed.
- [ ] Noise zones are separated from source evidence.
- [ ] Each relevant GitNexus candidate has file-read follow-up or is marked `не проверено`.

### Stage 3 - Ownership And Recipient Graph

Actions:
- Convert confirmed symbols/files into ownership order: first, second, third, N-th order.
- Use `context` callers/callees and `impact` upstream/downstream to expand recipients.
- Use `trace` when there is a specific hypothesis that one symbol reaches another.

DoD:
- [ ] Owner objects and recipient families are listed with repo/file evidence.
- [ ] Call graph evidence and manual evidence are distinguished.
- [ ] Unconfirmed graph edges are marked as candidates.
- [ ] Critical paths and gaps are updated from both graph and text findings.

### Stage 4 - Implementation Impact

Actions:
- For change-impact tasks, run `impact` before proposing edits.
- Use `detect_changes` only for git-backed repos such as `sdkjs` and `web-apps`.
- Avoid `detect_changes` as the main signal for `desktop-apps`, because it was indexed with `--skip-git`.

DoD:
- [ ] Impact direction is explicit: upstream, downstream, or both.
- [ ] Affected repos/processes/symbols are listed.
- [ ] High-risk or ambiguous graph results are called out.
- [ ] Diff-based evidence is only claimed where GitNexus can map a real git worktree.

### Stage 5 - Report Integration

Actions:
- Add GitNexus checks to the report evidence tables.
- Include a GitNexus Evidence Matrix when graph evidence materially affects conclusions.
- Include Graph Limitations before final absence or gap claims.

DoD:
- [ ] Report identifies `@r7` or specific repo scope.
- [ ] Evidence rows include source labels.
- [ ] Candidate vs confirmed status is visible.
- [ ] Absence claims cite both text search and expected-location checks, not GitNexus alone.

## Suggested Report Block

```markdown
## GitNexus Evidence Matrix

Что показывает: какие graph/AST проверки выполнены и как они были подтверждены.
Зачем нужна: отделить кандидаты GitNexus от подтвержденных использований.
Как читать: строки со статусом `candidate` требуют follow-up; строки `confirmed` имеют ручное подтверждение.
Как использовать: применять для ownership, recipient fanout, impact и критических путей.

| repo | tool | query/symbol | result | follow-up | status |
|---|---|---|---|---|---|
| @r7 | context | <symbol> | <found/not-found/ambiguous> | <file/manual read> | candidate/confirmed/not-found |
```

## Smoke Test Checklist

Use this checklist after changing the AST skill:

- [ ] `feature-usage-inventory-ast` has a distinct `name` and description.
- [ ] A known symbol can be resolved through `context({ repo: "@r7", name: "ASCApplicationManager" })`.
- [ ] A repo-specific `cypher` query returns structural candidates.
- [ ] A sample report can include GitNexus Evidence Matrix rows.
- [ ] Validation still passes for the skill folder.

## Implementation Order

1. Update `SKILL.md` trigger and navigation.
2. Add this reference to the resources list.
3. Add GitNexus Evidence Matrix guidance to the report template.
4. Add optional `--ast` checks to the validator after the workflow is stable.
5. Run a smoke test on one known symbol and one real inventory request.