# Step 6: Revise

## Input

Authored `draft.md`, normalized facts, and pre-revision reader answers.

## Procedure

1. Apply every identified reader or quality issue; do not select only convenient issues.
2. Preserve supported behavior and exact identifiers, but replace implementation shorthand with observable conditions, actions, and results.
3. Keep architecture as one end-to-end flow; keep concrete contracts/components in changes; keep algorithms, conditions and exceptions in mechanics.
4. Record the authored draft hash, reader answers before/after, identified issues, applied issue IDs, and concise change summary in `revision.json`.
5. Require every post-revision answer to be `clear` and cite an exact revised-draft fragment.
6. Run `scripts/apply-editorial-revision.js`; do not bypass a failed reader answer or mechanical lint.
7. Ask the user only when the remaining defect depends on a genuine product or scope decision.

## Output

Produce `revision.json`; the orchestrator materializes final `draft.md` and `editorial-review.json`.
