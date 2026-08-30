# Reader Contract

Review as a new reviewer using only `reader-input.json`. Do not infer from task history or source files.

Answer all six questions from the draft and cite an exact draft fragment in `draft_evidence`: problem before the change; trigger condition; before/after execution flow; outcomes, choices and exceptions; key rules, API/configuration values and ownership boundaries; verification and remaining risks. Use `clear`, `missing`, or `ambiguous`. Use `not_applicable` only for key rules when the claim catalog contains no `rule`, `contract`, or `feature_flag`. Every final answer must be `clear`, except that valid `not_applicable` case.

Audit every `rule`, `contract`, and `feature_flag`. Put each in `rule_coverage.covered` with a short `anchor` occurring exactly once in the final draft, or in `omitted` with a concrete reason. Never omit numeric rules, formulas, thresholds, decision expressions, or `feature_flag` facts.

For every `feature_flag` claim, verify that the draft explicitly names the source-level key and its runtime/configuration binding (constant, variable, configuration path, or deployment variable), then explains the default state, enabled behavior, disabled behavior, scope, and configuration owner. These values must come from the claim catalog; do not infer a binding from a similarly named identifier. A missing or unknown binding is a `must_fix` issue and the reader decision cannot be `pass`.

The final draft must contain: `Контекст задачи`; `Архитектура решения` with `Как было` and `Как стало`; `Что изменено`; `Почему изменено`; `Как работает`; `Что проверено`. Require semantic precision, terminology provenance, one language, reader clarity, relevance, and conciseness. Keep before/after at comparable abstraction; use 1-5 grouped rationale bullets; separate events, callbacks, flags, configuration and owners; explain algorithm inputs, rules, values and exceptions; distinguish source overrides from runtime configuration; avoid repeated facts; never claim added tests were executed.

Verify that `Что проверено` separates the test-change inventory from executed checks. The inventory must classify every changed test suite or scenario as added, updated, or removed; empty categories may be stated as none. A changed test file missing from the inventory is a `must_fix` issue.

Return `revision.json` schema version 3, the exact `reviewed_draft_sha256`, all six answers, complete rule coverage, all six `final_dimensions` set to `pass`, empty `remaining_issues`, and `iterations`.

- If no edit is needed: `decision: pass`, empty `identified_issues`, one `reader_answers`, no `revised_draft` and no before/after answer copies.
- If editing is needed: `decision: revise`, non-empty `identified_issues`, complete `revised_draft`, `reader_answers_before`, and clear `reader_answers_after`.

Do not add claims absent from the draft and claim catalog. Preserve supported behavior and reviewer-relevant identifiers.
