# Step 5: Reader Review

## Input

`reader-input.json` and `reader-contract.md`. Do not receive chat history, source files, the author's rationale, or a previous PR description.

## Procedure

1. Act as an independent reviewer who has not seen the task or repository. Do not trust the author's headings or self-assessment.
2. Bind review to the current draft SHA-256.
3. Before editing, answer from the draft alone: problem, trigger, execution flow, outcomes/exceptions, and verification/risks. Quote the exact supporting fragment for each answer.
4. Mark an answer `missing` or `ambiguous` when it depends on inference from identifiers or implementation shorthand.
5. Evaluate the complete draft on six dimensions:
   - `semantic_precision`: every statement is no stronger or less precise than its facts and evidence.
   - `terminology_provenance`: nonstandard domain labels come from source evidence, user wording, identifiers, or are explicitly defined. Reopen evidence for suspicious terms even when they already appear in `facts.json`.
   - `language_consistency`: prose uses one language except identifiers and unavoidable established terms.
   - `reader_clarity`: title and opening state a concrete problem, change, and outcome without project knowledge.
   - `relevance`: every detail helps review behavior, implementation, risk, or verification.
   - `conciseness`: facts are not repeated and the explanation is no longer than needed.
6. Record every detected defect; do not downgrade known defects.
7. If the authored draft already passes, return one answer set with `decision: pass`; do not copy the draft into the result.
8. If changes are required, revise the complete draft using only normalized claims, then answer the same six questions again with `decision: revise`.
9. Classify every `rule`, `contract`, and `feature_flag` as covered with exact final-draft evidence or omitted with reason. Never omit numeric/formula rules.
10. Set `passed: true` only when every final answer is `clear`, rule coverage is complete, all dimensions pass, and no issue remains.

## Output

Write schema-version-3 `revision.json`. Audit-only pass results contain no draft; revise results contain the complete revised draft.
