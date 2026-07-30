# Execution Levels

## Mode and Continuation Selection

Before starting a new full inventory, ask one combined question that requires both an execution mode and a continuation method:

```text
Как выполнять исследование и продолжать работу между ходами?

Режим:
- strict — один канонический этап за ход;
- adaptive — несколько последовательных этапов;
- continuous — максимально непрерывное выполнение.

Продолжение:
- interactive — после остановки ждать команды `продолжай`;
- goal — автоматически продолжать через активную цель Codex.
```

The user must choose one mode:

- `strict` — execute exactly one canonical stage per answer.
- `adaptive` — execute consecutive canonical stages while each stage can be closed safely and sufficient context reserve remains.
- `continuous` — continue for as many consecutive stages as safely possible; stop only at a gate, a required user decision, an unsafe context boundary, or completion.

The user must also choose one continuation method:

- `interactive` — wait for the user after a stop;
- `goal` — resume automatically across turns under an explicitly active Codex goal.

Do not choose defaults for either value. Do not run Stage 0, create `inventory-state.json`, or persist inventory artifacts until the user answers both parts. Diagnostics that do not persist task results may run only after mode and continuation are selected. A targeted Graph/AST question requires neither selection.

Record the selected mode in `inventory-state.json`. Record `driver: interactive|goal` separately. On interactive or goal continuation, reuse both values without asking again. Ask again only for a new inventory or when the user requests a change.

## Invariants

- A mode controls how many stages may run in one answer; it never changes stage goals, evidence rules, gates, or canonical order.
- A driver controls who initiates the next turn. `interactive` waits for the user; `goal` continues automatically. It never changes mode semantics.
- Treat every canonical stage as a separate transaction: `assert`, execute, persist, validate/gate, then `advance`.
- Never start the next stage before the previous stage advances successfully.
- Never advance a partial or blocked stage.
- Never discard facts, evidence, coverage counters, or open checks to fit the context window.
- Preserve Stage 7 trusted-digest and Stage 8 read-only guarantees.

## Continue Decision

After each successful `advance`:

1. In `strict`, stop.
2. In `adaptive`, immediately start the next canonical stage after every successful advance. Do not stop merely because the next stage is complex, expensive, or may not fit completely. Stop only when the next stage requires a user decision or new authority, a validator/gate failed, a required dependency or source is unavailable, proceeding would violate safety or scope, the current stage is partial and cannot be advanced, or remaining context is insufficient even to persist a valid partial-stage artifact with exact open checks. If the next stage may not fit completely, start it, persist complete stage-local facts, mark it partial, and return an exact continuation contract. A subjective `safe context reserve` is not a stop reason.
3. In `continuous`, continue while a safe stage boundary remains available and no stop condition applies.
4. When the environment does not expose reliable remaining-context information, use conservative estimates from model-visible artifacts and `scripts/measure_context.js`; never claim an exact remaining-token count.
5. Uncertainty about workload, complexity, or context size does not permit stopping at a closed boundary in `adaptive` mode. A stop must name a concrete condition from item 2 and record it in the execution status.

## Safe Stop and Resume

The first implementation supports safe stops at canonical stage boundaries. If context becomes unsafe during a stage, keep the stage `partial`, persist the complete stage-local facts and exact open checks, do not call `advance`, and stop. Do not claim resumable work-unit checkpoints unless the active runner has an explicit checkpoint contract.

The execution report for a stopped run must include:

- selected mode;
- stages completed in this run;
- canonical state transitions;
- current artifact;
- stop boundary and reason;
- open checks;
- exact next stage or partial-stage continuation;
- `resume command: продолжай` for `interactive`, or `automatic continuation: active goal` for `goal`.

If the agent starts changing the skill's behavior before the execution-level contract is agreed and implementation is explicitly approved, or goes beyond the agreed behavior, stop immediately. Do not continue edits; report the deviation and show the current changed-file set or diff.
