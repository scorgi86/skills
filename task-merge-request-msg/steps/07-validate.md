# Step 7: Validate

## Input

`scope.json`, `facts.json`, optional `author-output.json`, final `draft.md`, `editorial-review.json`, and optional `revision.json`.

## Procedure

1. Do not validate while `editorial-review.json` is known to fail. Return to revision first.
2. Require the editorial review to pass all six dimensions, contain no `must_fix`, and match the SHA-256 of the current `draft.md`.
3. For Semantic/Deep, require all six reader answers to be clear, non-empty, and supported by exact fragments from the final draft. `key_rules_and_values` may be `not_applicable` only when facts contain no rules, contracts or feature flags.
4. Require every `rule`, `contract`, and `feature_flag` fact to be covered or explicitly omitted; reject omission of numeric/formula rules.
5. Confirm tests found in the diff are not described as executed unless a `check_run` fact supports that statement.
6. Confirm every source-derived fact references a changed path. Validate symbol candidates and exact line quotes against transient `analysis-input.json`.
7. Confirm model usage is current-run usage or is explicitly marked as cached historical usage.
8. Continue directly to step 8 and let `scripts/finalize-run.js` write `validation.json` and persist the run in one operation.
9. Use `scripts/validate-artifacts.js` separately only for diagnostics or skill tests. Never replace failed or unknown flags manually.

## Output

The finalizer writes `validation.json`. Persistence proceeds only when `passed` is true.
