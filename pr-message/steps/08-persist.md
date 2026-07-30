# Step 8: Persist

## Input

Validated artifacts with `editorial-review.passed: true` and `validation.passed: true`.

## Procedure

1. Require `scope.context.artifact_directory`. If it is missing, return to the scope step and resolve it with the user.
2. Run `scripts/finalize-run.js --run-dir <run-directory>`. It validates first and derives the destination from `scope.json`.
3. Use `--destination <artifact-directory>` only to assert an explicitly supplied destination; it still must match `scope.context.artifact_directory`.
4. Persist `pr-description.md`, `scope.json`, `facts.json`, `editorial-review.json`, optional `model-usage.json`, optional revision artifacts, `validation.json`, and generated `manifest.json`.
5. If `scope.context.register_in` points to an existing task Markdown file or README, add or update a compact `PR description` entry with relative links. Avoid duplicating an existing entry.
6. Verify every persisted file can be read and `manifest.json` lists the copied artifacts.
7. Remove `selected.diff`, `analysis-input.json`, and `analysis-prompt.txt` only after successful validation and persistence. Remove stale optional persisted artifacts when the current run does not produce them.

## Output

Return the absolute path to the persisted `pr-description.md` and mention the task context entry that links to it.
