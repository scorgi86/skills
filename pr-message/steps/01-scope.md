# Step 1: Scope

## Input

User request, current repository context, and any explicitly supplied repositories, base branch, or worktree scope.

## Procedure

1. Prefer `scripts/run-pr-message.js` when repository, base, worktree inclusion, and artifact directory are known. Use `scripts/collect-git-scope.js` directly only for diagnostics or multi-repository assembly.
2. The collector includes non-ignored untracked files in `worktree_files`, selected statistics, and `selected.diff` when `--include-worktree` is active. Binary files use Git binary patches.
3. Pass `--base` when the user supplied a target. Pass `--include-worktree` or `--exclude-worktree` only when that choice is known.
4. Reuse the returned `diff_stats`, `selected_diff`, and `analysis_hints`; do not run separate diff-stat or diff commands unless the collected result is incomplete or inconsistent.
5. Prefer a user-provided base. Otherwise use the local remote default branch when unambiguous. Do not assume that a feature branch upstream is the PR target.
6. Combine repository results into one `scope.json` when the PR spans repositories.
7. Resolve the project task context from, in order: an explicit user path, project instructions, or an existing context entry matching the task ID or branch.
8. For a task context directory, use `<task-context>/pr-message/<branch-slug>` and register the link in its README when present.
9. For a task context Markdown file, use the sibling directory `<task-context-stem>.artifacts/pr-message/<branch-slug>` and register the link in that Markdown file.
10. Do not invent a context root when no project convention or matching task context exists. Ask the user for the destination.
11. Ask the user only when the base, repository set, worktree inclusion, or context destination is materially ambiguous.
12. Set `ready` to true only after blocking questions are resolved and `context.artifact_directory` is set. Include the resolved scope in the core artifact bundle written after rendering.

## Output

Produce `scope.json` and transient `selected.diff`. Do not analyze implementation behavior in this step.
