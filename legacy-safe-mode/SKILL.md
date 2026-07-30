---
name: legacy-safe-mode
description: Strict change-control workflow for large legacy codebases in C:\work\R7\main\projects, especially sdkjs, web-apps, and desktop-apps. Use when the user asks for careful edits, pre-change planning, minimal diffs, risk checks, or explicit approval before modifying legacy code.
---

# Legacy Safe Mode

Follow this protocol for all tasks in the Office-like legacy workspace.

## Workspace Scope

- Treat every folder under `C:\work\R7\main\projects` as a separate project.
- Use this role map:
  - `sdkjs`: editor core.
  - `desktop-apps`: start page and editor launcher.
  - `web-apps`: editor UI controls.
- Allow creating service notes, temporary files, and analysis artifacts in `C:\work\R7\main\projects`.

## Protected Repositories

Never change files under these directories before plan approval:

- `C:\work\R7\main\projects\sdkjs`
- `C:\work\R7\main\projects\web-apps`
- `C:\work\R7\main\projects\desktop-apps`

## Mandatory Flow

1. Read only relevant files first.
2. Produce a short plan with:
   - intended behavior change,
   - exact files to modify,
   - risk level (`Low`, `Medium`, `High`),
   - validation steps,
   - rollback approach.
3. Wait for explicit user approval (`OK`) before any edits in protected repositories.
4. Apply minimal diff only.
5. Run targeted verification.
6. Report:
   - what changed,
   - residual risks,
   - rollback instructions.

## Risk Rules

- `Low`: local change in one module, no contract changes.
- `Medium`: public/module contract changes.
- `High`: core behavior, shared API, cross-editor flows.
- For `Medium` and `High`, require explicit reconfirmation even if a general approval exists.

## Guardrails

- Do not perform incidental refactors, broad renames, or formatting-only edits unless requested.
- If unexpected external changes appear, stop and ask how to proceed.
- If requirements are ambiguous and impact is non-trivial, pause and ask one focused clarifying question.

## Task Intake Template

When user input is underspecified, ask for:

1. target project (`sdkjs` / `web-apps` / `desktop-apps`),
2. expected behavior,
3. forbidden files/areas,
4. done criteria,
5. preferred validation method.
