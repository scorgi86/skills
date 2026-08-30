# Optional Step: Custom Outline

## Input

Validated `facts.json` when the user explicitly requests a nonstandard section layout. The default route skips this step and uses deterministic rendering.

## Procedure

1. Do not create `outline.json` for the standard PR template.
2. Select the smallest custom section set that explains the PR.
3. Always include context, architecture, changes, rationale, and verification in the requested layout.
4. Add no more than two detail sections by default:
   - `Как работает` for execution flow or state changes.
   - `Правила работы` for algorithms, thresholds, flags, contracts, or error handling.
   - `Архитектура` for changed ownership or component boundaries.
   - `Риски и совместимость` for migrations, public compatibility, rollout, or operational risk.
   - `Детали реализации` only when implementation mechanics are essential and do not fit another section.
5. Rank three to seven highest-impact changes for the opening list.
6. Assign each fact ID to one primary section. Do not assign the same ID twice.
7. Merge context and rationale instead of creating repetitive sections.

## Output

Prepare `outline.json` for the core artifact bundle using `references/artifact-schemas.md`.
