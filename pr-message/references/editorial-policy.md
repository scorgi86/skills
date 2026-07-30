# Editorial Policy

Review a PR description as an independent reader who has not seen the task or repository. Use only the draft, normalized facts, and their provenance. Do not trust the author's structure or self-assessment.

## Reader test

Before editing, answer these questions from the draft alone and quote the exact fragment that supports each answer:

1. What problem existed before the change?
2. Under what condition does the new behavior run?
3. What is the end-to-end execution flow before and after the change?
4. What outcomes, choices and important exceptions exist?
5. What key decision rules, API/configuration values and ownership boundaries must the reviewer verify? Use `not_applicable` only when normalized facts contain no rules, contracts or feature flags.
6. What was verified and what remains a review or test risk?

Then audit every normalized `rule`, `contract`, and `feature_flag` fact. Classify it as covered with a short fragment that occurs exactly once in the final draft, stored as `anchor`, or omitted with a concrete reason. Numeric/formula rules, thresholds, and decision expressions cannot be omitted.

Mark an answer `missing` or `ambiguous` when a new reviewer would have to infer it from identifiers or phrases such as "orchestration", "flags are passed", "finalization is protected", or equivalent implementation shorthand. Rewrite the draft until every post-revision answer is `clear` and cites an exact fragment from the revised draft.

## Quality checks

1. Context states the problem and outcome instead of repeating the title or listing files.
2. Before and after describe the same execution flow at comparable abstraction levels.
3. Rationale contains three to five grouped causes, not one bullet per implementation fact.
4. Source identifiers use code formatting; ordinary prose uses the description language consistently.
5. Events, callbacks, feature flags, configuration, and other contracts stay separated by owner and scenario.
6. Algorithms explain inputs, decision rule, important values, and exceptions without dumping raw source lines.
7. Configuration claims distinguish source-level override parameters from externally managed runtime configuration and do not invent a host owner.
8. Each fact has one primary section; repeated details are merged or removed.
9. Added tests are distinct from checks actually executed.

## Revision rules

- Preserve every supported behavior and exact identifier needed by a reviewer.
- Do not introduce a claim absent from `facts.json`.
- Prefer grouping and rewriting over deletion when a detail affects behavior or compatibility.
- Keep the required headings: Context, Architecture with Before/After, Changes, Rationale, How it works, Verification.
- When the authored draft already passes, return `decision: pass`, one reader-answer set, rule coverage, and no draft copy.
- When changes are required, return `decision: revise`, a complete revised Markdown draft, pre/post reader answers, and a structured record of applied issues.
