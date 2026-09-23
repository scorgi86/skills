# Stage 1 Contract: Ownership and Lower Layers

Use this contract only for full-inventory stage 1. Execute no later stage.

## Input

- Read only the structured transition from a closed stage-0 artifact.
- Require target, scope, stage, status, confirmed evidence, candidate evidence, dictionary/graph/path state, skipped/forbidden, open checks, and next stage.
- Accept GitNexus only as candidate navigation. A missing index, unresolved seed, or empty graph result remains a limitation.

## Facts-first run

1. Build one request JSON before parsing files.
2. Use one canonical GitNexus `context` seed by default. Add a fallback seed only when the canonical lookup is unresolved and record why.
3. Parse each candidate source file once with `stage1_runner.js` AST batch.
4. Confirm source candidates with explicit `source_evidence.js` checks.
5. Keep complete canonical facts and evidence in the stage artifact. Consume only the bounded runner summary in model context.
6. An ownership group may become `confirmed` automatically only for an exact `field-write` or `collection-*` occurrence whose AST owner has explicit `ownerConfidence: "exact"`, and whose current full source fragment, inclusive bounds, file SHA-256, anchor, and confirmation record are persisted from a file physically inside its declared repository. A `call-result-to-field` is equivalent only when one uniquely resolved factory has a source-confirmed possible-return branch for the target type; preserve both the assignment and factory-branch evidence. This confirms static possible storage, not the runtime branch. Dynamic, computed, unresolved, stale, external, or AST-only candidates remain candidates.
7. When a producer-consumer boundary is relevant, declare it in generic `boundaries` request data. Each candidate requires producer repo, kind, symbol, relation, evidence refs, concrete producer anchor, search terms, and consumer repos. Keep it `candidate`; it is input for Stage 2/3, not proof of a user scenario.
8. Collect copy, merge, clear and protocol operations while discovering each container. Record their distinct source-backed results, including unsupported branches; a shared method name does not establish an operation's behavior.
9. Resolve each confirmation to an unambiguous repository/file and exact inclusive source bounds before closure. Reuse confirmed fragments rather than repeating broad searches to recover the same proof.

## Required groups

With `searchFromStage0: true`, Stage 0 seeds are the discovery dictionary used by all derived AST and source searches. When ownership input is empty and `ownership.autoCandidates !== false`, Stage 1 may generate the order-0 group from an exact class/function declaration. Optional `ownership.bootstrapSeed` must be one nonempty member of the Stage 0 dictionary and limits only that declaration selection and subsequent owner discovery; omitting it preserves selection across every discovery seed. Do not combine `bootstrapSeed` with manual groups, expected ids, or coverage. The prepared legacy route below remains unchanged.

Record each applicable group with id, order, role, object, relation, evidence references, anchor, and status:

- direct model/type;
- immediate container/property;
- owner/container branches;
- binary or native serialization/readback;
- format/API serializer/readback when present;
- explicitly recorded graph/index limitations.

## Ownership Graph Mode

When recursive ownership coverage is needed, declare `ownershipGraph` in the request. It contains order-0 `nodes`, owner-to-child `edges`, and `maxOrder`. Only `stores`, `owns`, `contains`, and `wraps` advance the order: if `A contains B`, then `order(A) = order(B) + 1`. Every node above order 0 must have an anchored ownership edge to a child at the preceding order. Keep serializer, history, copy, API, and render relations as auxiliary edges.

Declare every applicable branch in non-empty `ownership.expectedIds`; when validating against an earlier Stage 1 report, include every branch from that report. The gate must fail if one is absent. For a `confirmed` group, take the rendered ownership anchor from `confirmation.file` and `confirmation.line`; never substitute the first broad-search match. Set `sourceRoot` when confirmation paths are relative so the runner can save a SHA-256 hash of the three-line confirmed source fragment.

`expectedIds` and `coverageContract` check declared stage obligations, not global semantic exhaustiveness. Expand concrete owners, inherited families and operation facts as source discovery proceeds through Stages 1–5. Do not impose a final receiver quota at Stage 1 or treat its closed gate as proof that later owner discovery is unnecessary; retain each stage's existing closure requirements.

Declare a generic `coverageContract` in every request:

- `categories`: use stable category ids (for example direct model, immediate container, owner branches, serialization, history/copy, index limitations); each category is `applicable`, `not-applicable`, or `open`. Set `requiredBeforeClose: true` when that category must not remain `open` for a closed Stage 1.
- An `applicable` category names its `groupIds`; `not-applicable` and `open` require a reason.
- `baseline.ownershipIds` carries groups preserved from a prior comparable run. A missing baseline group requires a `baseline.exemptions` entry with `status: not-applicable` and a reason.
- For a formal comparison, set `claimLedger.required: true`. Every claim maps to one or more `groupIds` and/or named `observationIds`. An observation records `id`, `status`, `scope`, and result text; use it for bounded cross-repo or candidate-negative observations without converting them into absence claims.
- Do not encode project paths, repository names, or API naming conventions in the skill. Put consumer scope and any project-specific search hints only in the inventory request.

## Budgets and gates

- Default summary budget: 8 KiB.
- Default facts budget: 64 KiB.
- Default source-evidence budget: 32 KiB.
- Default report budget: 48 KiB.
- The stage is partial when the stage-1 coverage gate fails, a required group lacks an anchor, AST parsing fails, facts overflow, or the summary exceeds its budget.
- Do not meet a budget by dropping required groups, group digests, or first anchors.

## Output

- Persist through `stage_pipeline.js` to the automatic artifact directory or an explicit user override.
- Emit runner stdout in `summary` mode only.
- Render Markdown deterministically from facts; do not draft a full report in model context.
- The transition must carry all closed evidence, candidates, limitations, and `next stage: 2 — Расширение словаря`.
- A generated `boundaries.json` is the machine-readable handoff for Stage 2; pass it as `boundaryArtifact` rather than reconstructing candidates from report prose.
