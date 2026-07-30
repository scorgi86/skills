# Goal Execution

Use this contract when a full inventory runs under an active Codex goal. A goal is an execution driver, not an inventory mode: `strict`, `adaptive`, and `continuous` retain their existing stage semantics.

## Resolve the Goal Contract

When goal tools are available, inspect the active goal before Stage 0 and on every automatic continuation. Otherwise use the goal objective supplied in the current task context. Resolve these required values:

- target;
- repositories, branches, or worktrees;
- execution mode;
- approved artifact destination and format;
- exclusions and permissions;
- completion condition.

An explicit value in the active goal counts as the user's answer. If a required value is absent, pause and ask; never infer it. Do not create a goal unless the user explicitly requests one.

Normalize the material values with `node scripts/goal_contract.js --request <goal-contract.json>` and record its SHA-256 as `goal.objectiveDigest`. Cosmetic wording and progress commentary must not change the digest. Before every continuation, pass the current digest to `stage_state.js continue-run`. A mismatch requires user confirmation; do not silently migrate scope.

## Initialize

Initialize a goal-driven inventory with:

```text
node scripts/stage_state.js init --state <inventory-state.json> --mode <strict|adaptive|continuous> --driver goal --objective-digest <sha256>
```

Interactive inventories use `--driver interactive` and must never be migrated to goal automatically. Existing schema 1.0 and 2.0 states migrate to `interactive`.

## Automatic Continuation

At the start of each goal continuation:

```text
node scripts/stage_state.js continue-run --state <inventory-state.json> --objective-digest <sha256>
```

Then resume from `currentStage`, `canonicalArtifact`, `resume`, and `openChecks`. Do not reconstruct work from conversational memory and do not repeat a closed stage.

- `strict + goal`: execute one canonical stage per automatic continuation.
- `adaptive + goal`: execute stages according to the adaptive rules, then let the active goal start the next continuation.
- `continuous + goal`: keep executing and automatically continue until Stage 8 closes or a genuine blocker occurs.

Each stage remains an independent `assert -> execute -> persist -> validate/gate -> advance` transaction.

## Partial Checkpoint

Before ending a continuation with a partial stage, persist the complete stage-local facts and record:

```text
node scripts/stage_state.js checkpoint --state <inventory-state.json> --artifact <partial.json> --progress-digest <sha256> --next-action <exact-action> --reason <reason>
```

This does not advance the stage. Do not claim work-unit resume unless the active runner has an explicit checkpoint contract.

## Stop and Block

Record a concrete stop through:

```text
node scripts/stage_state.js stop-run --state <inventory-state.json> --reason <stable-reason> --progress-digest <sha256>
```

Complexity, expected duration, or the need for another continuation are not blockers. Permissions, missing user decisions, unavailable required inputs, failed gates without new evidence, or unsafe scope are blockers. Three consecutive goal continuations with the same stop reason and progress digest set `runStatus: blocked`.

When goal status tools are available, mark the Codex goal blocked only after the state controller reaches this threshold. Do not use blocked for ordinary partial progress.

After the user supplies new input or the external condition changes, resume a blocked inventory explicitly with `continue-run ... --acknowledge-blocker true`. Automatic goal continuations must not acknowledge their own blocker.

## Complete

Stage 8 must advance with its closed `manifest.json`; its input digest must match the trusted Stage 7 digest. Then run:

```text
node scripts/stage_state.js complete-run --state <inventory-state.json>
```

When goal status tools are available, mark the Codex goal complete only after `complete-run` succeeds. Never mark it complete at a stage boundary, because the context window is low, or because a normal answer ended.

## Reporting

For goal runs include:

```text
mode: <strict|adaptive|continuous>
driver: goal
goal status: active|blocked|complete
stages completed this continuation: <stages>
current stage: <stage>
progress digest changed: yes|no
automatic continuation: active|paused|complete
user action required: no|<exact decision>
```

Do not emit `resume command: продолжай` as the continuation mechanism for an active goal.
