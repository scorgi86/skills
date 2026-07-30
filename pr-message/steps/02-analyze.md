# Step 2: Analyze

## Input

Validated `scope.json` with `ready: true`.

## Procedure

1. Run `scripts/prepare-analysis-input.js` through the orchestrator. It verifies the selected diff hash and creates transient `analysis-input.json` and `analysis-prompt.txt`.
2. Check the analysis cache before invoking a model. A hit must bypass analysis entirely.
3. On a miss, give the model only `analysis-prompt.txt`. Do not pass the repository, chat history, previous PR description, or full selected diff.
4. In Semantic/Deep, produce `author-output.json` schema version 1 containing facts with only supplied `evidence_ids` and a complete reviewer-oriented `draft`. The orchestrator expands IDs before validation and persistence. In Fast, produce local `facts.json` only.
5. Every source-derived fact must cite repository, changed path, exact line, and quote. Add a symbol only when the package contains that symbol candidate.
6. Record exact formulas, thresholds, flags, callback values, state transitions, compatibility behavior, and failure branches.
7. Keep `test_added` separate from `check_run`. The model must never create `check_run` from source evidence alone.
8. Validate evidence before caching. A unique exact quote in the same file may correct an adjacent line number; absent or ambiguous evidence must fail.
9. Reopen source only when the package is truncated or a blocking semantic ambiguity remains.
10. Write Semantic/Deep prose as one explanation. It must state the problem, trigger, end-to-end before/after flow, outcomes, exceptions, risks, and verification without requiring the reader to decode implementation shorthand.

## Output

Prepare validated `facts.json`; for Semantic/Deep also prepare `author-output.json`. Do not copy the full diff into persisted artifacts.
