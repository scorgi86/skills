# Full run package

Use one prepared package when all Stage 0–7 semantic inputs are known. The fragment below shows the package shape; the abbreviated empty Stage 1–6 templates are placeholders, not a runnable research package. Fill every stage from its contract before running it:

```json
{
  "schemaVersion": "research-package/1.0.0",
  "target": "FeatureValue",
  "repositoryScope": {
    "repositories": [
      { "id": "sdk", "root": "C:/work/project", "role": "source" }
    ]
  },
  "stages": {
    "0": {
      "stage6Decision": "skip",
      "coverageProfile": {
        "kind": "full-inventory",
        "requiredCapabilities": ["definition", "ownership", "storage", "serialization", "input", "mutation", "recipients", "readback", "render-output", "lifecycle", "theme-style", "tests", "reference"],
        "requiredCollections": ["scenarios", "criticalPaths"]
      },
      "seeds": { "direct": ["FeatureValue"] }
    },
    "1": {},
    "2": {},
    "3": {},
    "4": {},
    "5": {},
    "6": {},
    "7": {}
  }
}
```

Stage templates contain semantic inputs only. Do not put `target`, `repositoryScope`, transition or lineage artifacts, expected artifacts, state paths, output paths, or `artifactBase` in them. A Stage 7 evidence selector names a completed stage; the coordinator resolves its active canonical artifact.

Select full-development when researching a change and add gaps and implementationEntryPoints to requiredCollections; link implementation-gap and test-gap rows from the existing entry points. Select bounded only for an explicitly limited request, where a smaller profile is allowed. Full scenarios use entry, steps and result as specified in report-contract.md. New Stage 0 requires kind before state/output creation; saved no-kind runs can resume and finalize unchanged.

Set `stages["0"].stage6Decision` to `run` or `skip` using the intent rule in `SKILL.md`. With `skip`, keep the Stage 6 template `{}`: the runner closes its position in the canonical lineage without reference inputs or analog findings. Stage 7 inherits a justified `reference: not-applicable` result. Existing packages without this field continue to run Stage 6 as before. The decision is saved in Stage 0 and cannot change on continuation.

## Stage 0: repository exclusions

Keep exclusions local to the repository where they apply. This fragment replaces the package's `repositoryScope`; replace the example roots with the declared search roots:

```json
{
  "repositoryScope": {
    "repositories": [
      { "id": "sdk", "root": "C:/work/project/sdk", "role": "producer", "exclusions": ["node_modules/**", "generated/**"] },
      { "id": "ui", "root": "C:/work/project/ui", "role": "consumer", "exclusions": ["node_modules/**"] }
    ]
  }
}
```

The Stage 0 template can omit `exclusions`: the runner already applies each repository's local rules. Optional `stages["0"].exclusions` may repeat only rules present in **every** repository. For this example, `["node_modules/**"]` is valid globally; `["generated/**"]` is not, because that rule is absent from `ui`. The existing Stage 0 check rejects such a conflict before scanning. See [Repository scope](repository-scope.md) for the authoritative scope and exclusion contract.

## Stage 0 → 1 automatic seed search

Set `stages["1"].searchFromStage0: true` to derive Stage 1 `ast.queries` and `evidence.checks` from the closed Stage 0 file candidates and every direct discovery seed. Keep `ast` and `evidence` out of that Stage 1 template. Without the flag, the manual Stage 1 request is unchanged.

For empty auto-bootstrap ownership, omit manual `expectedIds`, `groups`, and `coverageContract`; `ownership.autoCandidates` may be omitted or true. Optional `ownership.bootstrapSeed` selects one exact class/function declaration for ownership discovery while the full Stage 0 seed dictionary remains in AST and source searches. It must be a nonempty string present in the closed Stage 0 `summary.seeds`. When omitted, the previous selection across all Stage 0 seeds is preserved, including `seed-ambiguous` when multiple declarations match. `bootstrapSeed` is rejected outside this empty mode, and manual coverage or partially populated ownership is rejected rather than merged with generated obligations.

The selected exact declaration supplies the source-confirmed `definition` fact. When the existing Stage 1 coverage gate closes every required ownership group, Stage 1 also supplies the confirmed `ownership` fact. Do not add manual `definition` or `ownership` capabilities to this automatic mode.

For the legacy prepared route, set `ownership.autoCandidates: true` and provide an order-0 seed group whose `object` names the target type, nonempty `expectedIds`, and an `owner-branches` category with `requiredBeforeClose: true` and `status: "open"`. An exact `field-write` or `collection-*` occurrence with `ownerConfidence: "exact"`, a current full source proof, and a file physically inside its declared repository is confirmed automatically; if every generated group is confirmed and no path is unresolved, Stage 1 changes that category to `applicable` with all generated IDs and the current `reviewDigest`. Otherwise the run remains partial and records generated group IDs, an ownership graph, unresolved paths, and `ownerDiscovery.reviewDigest`; retry manually with `owner-branches.status: "applicable"`, all generated IDs in `groupIds`, and that digest in `reviewDigest`. Changed Stage 0 output, selected source, or graph invalidates the digest. Unknown, dynamic, cyclic, truncated, unanchored, external, or AST-only paths remain unresolved and prevent closure. This option does not prove global completeness; Stage 2 onward is unchanged.

The automatic route requires `scanSeeds: true` and a nonempty successful candidate scan in every repository. It passes only `.js`, `.jsx`, `.ts`, and `.tsx` files to Stage 1 AST and source checks; other candidates remain in Stage 0 canonical facts but are not searched at Stage 1. It rejects incomplete/empty scans, out-of-scope files, more than 200 selected JS/TS files per repository, no JS/TS candidates across the scope, and direct seeds containing commas (AST `find` treats commas as separators). Skipped non-JS/TS candidates are not proof of no usage. Stage 1 reads the active closed canonical artifact, not raw output or Markdown. A selected file may change between stages: Stage 1 analyzes its current contents, while an unreadable or missing file keeps the automatic run partial.

## Stage 6: feature reference

Use this template as `stages["6"]` when `stage6Decision` is `run` and the target is compared with a reference entity rather than a Git diff. Replace the entity names, source path, and declared surface classification with the research inputs:

```json
{
  "mode": "feature-reference",
  "featureReference": {
    "target": "FeatureValue",
    "referenceEntity": "ReferenceValue",
    "capabilities": [
      { "id": "definition", "status": "unchecked", "evidenceRefs": [] }
    ]
  },
  "sourceSurfaces": [
    { "path": "src/model.js", "layer": "model", "role": "definition" }
  ]
}
```

`featureReference` requires `target`, `referenceEntity`, and a nonempty `capabilities` array. Each declared source surface requires `path`, `layer`, and `role`. The nested `featureReference.target` is required even though the coordinator supplies the top-level request `target`; do not add a top-level `target` or `transitionArtifact` to this stage template. A capabilities list in Stage 7 does not replace `featureReference.capabilities` in Stage 6.

## Stage 7: automatic canonical handoff

Set `stages["7"].buildFromStage6` to `true` to resolve every evidence reference used by inherited capability and planning facts across the validated Stage 0–6 lineage. Automatic handoff conflicts with manual evidence selectors, evidence indexes, capabilities, and planning collections. It transfers canonical facts and exact evidence only; the existing Stage 7 report validation remains responsible for coverage requirements and does not infer missing capabilities or collections.

This is a structurally valid starting template, not a completed investigation. `unchecked` and empty evidence refs make no source-confirmed claim. Fill the actual capabilities and confirm them with evidence as research proceeds; the single row above does not satisfy the full-inventory obligations declared in Stage 0. Follow [Report contract](report-contract.md) for final coverage. The existing runner checks the feature-reference inputs when Stage 6 executes; package loading does not check this missing-capabilities case in advance.

Run:

```text
node scripts/index.js full_run --package research-package.json --state inventory-state.json --output-root artifacts
```

## Automatic Stage 2 ownership frontier

After automatic Stage 1, Stage 2 can derive its search without an AI-prepared request:

```json
{
  "searchFromStage1": true,
  "ownershipGraphMaxOrder": 10
}
```

This mode reads the active closed Stage 1 canonical ownership nodes and confirmed edges, reconstructs the graph with the declared maximum order, resolves each frontier repository from source anchors, and reuses the bounded JS/TS candidate files and exact term dictionary from the active Stage 0 lineage. Its single AST plan contains both owner queries and exact identifier/property/string occurrence queries. Boundary occurrence scanning still runs after the ownership frontier is exhausted. A boundary candidate is created only when the same case-sensitive whole AST term has a current source anchor in a declared producer and consumer repository. After boundary discovery and the existing Stage 2 gate both close, those source-confirmed pairs become deterministic confirmed dictionary rows. Partial, stale, or AST-only observations do not. Manual `ast`, `evidence`, `dictionary`, and `ownershipGraph*` fields cannot be mixed with this mode.

Stage 2 closes as `exhausted` when the declared maximum is already reached or a complete search finds no next owner. Source-confirmed owners are merged as a graph delta. Truncated, dynamic, unanchored, stale, unreadable, or otherwise unconfirmed branches remain partial with exact reasons. An invalid or ambiguous canonical graph is rejected rather than guessed.

Stage 3 can consume the canonical boundary obligations without an AI-prepared request:

```json
{
  "searchFromStage2": true,
  "consumerSearchProfiles": [
    { "id": "web-apps", "extensions": [".js", ".jsx", ".ts", ".tsx"], "maxFiles": 25000 }
  ]
}
```

Consumer roots come from repositories whose declared role is `consumer`. Profiles may only override the static search fields `languages`, `extensions`, `maxFiles`, `maxMatches`, `followSymlinks`, `excludeDirs`, and `excludeFilePatterns`. Every boundary-consumer pair must have exactly one complete, non-truncated check. An empty Stage 3 closes only when Stage 2 canonically recorded `boundaryDiscovery.status: "exhausted"`.

Stage 4 can reuse the closed Stage 3 evidence without another repository search:

```json
{
  "searchFromStage3": true
}
```

This mode groups current Stage 3 consumer observations by repository-relative source file. It emits candidate recipient families whose receiver is that file and whose relation is the neutral `contains exact boundary usage`; it does not infer a class, component, method, or business relation. Incomplete, truncated, stale, ambiguous, or out-of-scope Stage 3 evidence keeps Stage 4 partial. Manual `recipientFamilies` cannot be mixed with this mode.

Stage 5 can derive exact recipient checks from the closed Stage 4 result:

```json
{
  "searchFromStage4": true
}
```

This mode checks every canonical boundary term literally and case-sensitively in the Stage 4 recipient files, then repeats exact name coverage with the Stage 3 consumer search profiles. For full profiles, a recipient path is confirmed only when every boundary has one exact, non-dynamic structural AST participant in the current source snapshot and every referenced obligation is open with all ancestry edges present and source-confirmed. Internal terminal paths pass the same ancestry gate. Each confirmed path produces exactly one confirmed usage. Other positive matches remain candidate fragments; missing, ambiguous, stale, incomplete, truncated, unmapped, unresolved, or out-of-scope results keep Stage 5 partial. This confirms only the represented structural path and does not infer its business purpose or an unrepresented source-to-output chain. Manual `checks`, `nameCoverage`, `nameCoverages`, `structuralChecks`, and `criticalPaths` cannot be mixed with this mode. Canonical Stage 4 exhaustion closes Stage 5 without running a search.

For `full-inventory` and `full-development`, the automatic route also carries a source-confirmed value-flow graph. Stage 2 creates path obligations from structural AST relations rather than project-specific method names. A confirmed downstream fork creates child obligations, and Stage 5 keeps a separate terminal path for every leaf. Stage 7 closes only when every leaf has exactly one confirmed, checked-no-usage, or justified not-applicable outcome. Only positive confirmed leaves become `confirmedUsages`; absence and N/A remain separate results. Dynamic, stale, cyclic, truncated, or otherwise unresolved leaves keep the full run partial. Bounded packages retain the existing candidate-path behavior.

The command creates state when absent, executes only the active stage, stops on a partial result, and resumes that stage on the next call. It derives every transition from active state. After Stage 7 it runs the existing digest-bound Stage 8 renderer, validates and advances the manifest, then marks the run complete. A completed run is a no-op.

Exit code `0` means complete, `3` means partial, and `2` means error. Timing attempts are stored in `<output-root>/full-run-metrics.json`; they are operational metrics and are not canonical research facts. Changing the target, repository scope, or Stage 0 coverage profile requires a new state and output root.


## ownership.ownerDiscovery: "skip"

Bootstrap-only режим Stage 1: бустстрап-декларация подтверждается, discovery владельцев не запускается, owner-branches закрывается как not-applicable, граф владения не строится. Требует ручных Stage 2–5 и проверяется preflight-валидатором пакета. Применяйте для целей с широким fan-in, где AST не может подтвердить все ветки владельцев.
