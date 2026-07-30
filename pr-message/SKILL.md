---
name: pr-message
description: "Generate and persist a reviewer-oriented pull request description from Git changes through one of three explicitly selected routes: fast, semantic, or deep."
---

# PR Message Router

Generate a ready-to-paste PR description from Git changes. Keep this file as the router; load step instructions only when executing that step.

For a human-oriented explanation of the pipeline, artifacts, review cycle, and persistence model, read `references/readme.md` only when the user asks how the skill works.

## Artifacts

Create a temporary run directory and pass these artifacts between steps:

- `scope.json`: repositories, base/head, selected diff, and unresolved scope questions.
- `facts.json`: normalized change facts with source evidence.
- `author-output.json`: semantic/deep author result containing `facts` and a complete reviewer-oriented draft.
- `draft.md`: final PR description.
- `editorial-review.json`: deterministic Fast review or reader-comprehension result bound to the final draft hash.
- `revision.json`: independent reader audit; it contains no draft when the author passes and a complete revised draft only when changes are required.
- `model-usage.json`: optional provider usage from the model call that produced the facts.
- `validation.json`: final structural and editorial validation result.
- `manifest.json`: persisted artifact inventory and source scope.

Transient files, never persisted:

- `selected.diff`: the exact selected branch/worktree patch produced by the Git collector.
- `analysis-input.json`: structured evidence used to validate model facts.
- `analysis-prompt.txt`: compact provider-neutral model input, used by semantic/deep mode.
- `reader-input.json`: authored draft, compact `id/kind/claim` catalog, and mechanical result for the independent reader pass.
- `artifact-bundle.json`: a batch used to materialize stage artifacts with one writer invocation.

Read `references/artifact-schemas.md` before creating artifacts. Do not copy full diffs or source files into artifacts.

## Route

1. Before collecting Git scope, ask which mode to use. If the same request already explicitly selects a mode, treat the question as answered.
   - `Fast`: no model tokens; produces a quick evidence-based technical draft.
   - `Semantic` (recommended for meaningful review text): one current-Codex analysis over a compact package; target 8-12K tokens; no external provider.
   - `Deep`: one external DeepSeek/Polza.ai analysis; slower and requires explicit authorization to transmit the selected package.
2. Do not choose a mode silently. Pass the answer as `--mode fast|semantic|deep`.
3. Resolve repository, base, worktree inclusion, run directory, and task artifact directory. Ask only about blocking ambiguity.
4. Prefer `scripts/run-pr-message.js` as the single entry point.
5. On `cache=hit`, return the persisted description without rebuilding facts.
6. In semantic mode, on `analysis_required`, read only `analysis-prompt.txt`, create schema-valid `author-output.json`, and resume with `--mode semantic --author-output <author-output.json>`. Each fact cites only supplied `evidence_ids`; the orchestrator expands them before validation. The output also contains a complete PR draft written as one explanation. Do not reopen the repository unless the package reports a genuine blocking omission. The semantic evidence package is limited to 35 KB.
7. If fast mode returns `deep_recommended`, keep the fast result and explain why semantic or deep analysis may help. Do not change modes automatically.
8. Use `--mode deep --allow-external` only after explicit authorization to send the selected change package to Polza.ai. The adapter makes one structured-output author request without tools or repository access.
9. `--provider polza-deepseek` remains a backward-compatible alias for deep mode.
10. In semantic/deep mode, on `reader_review_required`, act as a new reviewer who has not seen the task. Read only `reader-input.json` and `references/reader-contract.md`.
11. Answer all six reader questions from the authored draft before editing. Mark missing or inference-dependent answers as `missing` or `ambiguous`; use `not_applicable` for key rules only when facts contain no rules, contracts or feature flags. Then revise the complete draft.
12. Audit every `rule`, `contract`, and `feature_flag` fact: record a short unique `anchor` from the final draft or an omission reason. Numeric/formula rules cannot be omitted.
    For every detected feature flag or toggle, require a structured `toggle` contract and an explicit final-draft description of the source key, its runtime/configuration binding (constant, variable, configuration path, or deployment variable), default state, enabled and disabled behavior, scope, and configuration owner. Never infer the binding from the source key. If evidence does not establish it, keep the run incomplete and report a blocking unknown; `feature_flag` facts cannot be omitted.
13. Produce schema-version-3 `revision.json`. Use `decision: pass` with one reader-answer set and no draft when no changes are needed. Use `decision: revise` with pre/post answers, identified issues, and a complete revised draft only when changes are required.
14. Resume with `--reader-review <revision.json>`. `scripts/apply-editorial-revision.js` rejects stale revisions, incomplete rule coverage, unsupported reader evidence, any unclear post-revision answer, unresolved issues, missing sections, excessive rationale, repeated bullets, or a failed quality dimension.
15. Let `scripts/finalize-run.js` validate and persist. Transient diff, analysis, and reader input files are removed only after successful completion unless `--keep-transient` is set.
16. Register the persisted description in the task context when a context file or README exists, then return its absolute path and current-run model usage.

## Discipline

- Use fast for a technical draft, semantic for the normal reviewer-oriented description, and deep only when external analysis was explicitly selected.
- Use model reasoning only for problem, intent, before/after architecture, behavior, rationale, risks, and genuine unknowns.
- Do not send `selected.diff` to the model when `analysis-prompt.txt` exists.
- Do not start a second autonomous coding agent for fact extraction. Use one structured model call or the current model over the prepared package.
- Cache a Semantic/Deep author result immediately after evidence and structural validation, before reader review. Keep it across reader retries; persist the final description only after every reader and final validation passes. All three modes use different cache identities.
- Accept an evidence line correction only when the exact quote occurs once in the same changed file. Never repair absent or ambiguous evidence.
- Render Fast Markdown deterministically. Fast facts may carry `impact`; Semantic/Deep facts omit it because rationale belongs in the complete authored draft.
- Require a complete test-change inventory in the final draft, grouped as added, updated, and removed suites/scenarios. Reconcile it with every changed test file in the selected diff. Keep this inventory separate from checks actually executed or confirmed by the user; never turn changed test code into a `check_run` claim.
- Treat every issue that would be reported to the user as `must_fix`; do not return a known-defective draft.
- Do not finalize a description that names only the code-level feature key. A feature/toggle description is complete only when its external configuration binding and operational behavior are evidence-backed.
- Semantic/deep reader review is required even when deterministic lint passes; the lint is a guard, not a comprehension test.
- A reader answer is clear only when it explains the behavior in ordinary language and cites an exact fragment from the reviewed draft. Identifiers and implementation shorthand alone are not an answer.
- Keep section ownership distinct: architecture describes the end-to-end flow; changes list concrete contracts/components; rationale groups causes; mechanics explain algorithms, conditions and exceptions.
- Require editorial review to match the SHA-256 of the current draft. Any revision invalidates the previous review.
- Do not run structural validation while editorial review is known to fail, except when testing the skill itself.
- Run project tests only when requested, required by project instructions, or needed to verify a claim. Otherwise report them as not run instead of adding latency merely to populate the verification section.
- Ask only when missing information materially changes scope or meaning. State non-blocking unknowns instead of pausing.
- Resolve the task-context destination during scope. Ask the user when project instructions and existing context do not identify a safe destination.
- Do not finish with artifacts only in a temporary directory.
- Report cached historical usage separately from tokens consumed by the current run.
- Never print, log, persist, or place `POLZA_AI_API_KEY` in a command argument.
