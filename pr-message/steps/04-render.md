# Step 4: Render

## Input

Validated `facts.json` and optional `author-output.json`.

## Procedure

1. In Fast, run `scripts/render-pr-description.js` through the orchestrator.
2. In Semantic/Deep, use the complete authored draft from `author-output.json`; do not reconstruct it from `statement` and `impact`.
3. Keep test coverage separate from executed checks. Never publish model-proposed unknowns without human or source confirmation.
4. Reject duplicate facts, vague phrases, empty required summary fields, and drafts over the editorial budget.
5. Write core artifacts once through `scripts/write-artifact-bundle.js`.

## Output

Materialize the authored `draft.md` and a hash-bound mechanical review.
