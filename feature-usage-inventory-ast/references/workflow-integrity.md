# Workflow integrity

Canonical schema 4.0 keeps `openChecks` as a unique `string[]` of blockers for the current stage. A closed artifact cannot contain open checks or a failed persisted closure gate. Omitting the field or supplying an empty array on retry does not resolve questions from the previous partial artifact.

## Resolution receipts

Supply `checkResolutions` in a retry request. Each receipt identifies the exact question text and the `outputDigest` of its origin artifact:

```json
{
  "kind": "check-resolution",
  "check": "Verify ownership of the export path",
  "originDigest": "<64 lowercase hexadecimal characters>",
  "disposition": "checked",
  "reason": "Reviewed the ownership assignment and its consumer",
  "evidenceRefs": ["ev-owner", "ev-consumer"]
}
```

`checked` requires a nonempty reason and nonempty evidence references that resolve in the canonical evidence artifact. Candidate evidence alone does not establish a source-confirmed claim; the applicable ownership, coverage and source-anchor gates remain independently required. A limitation does not discharge a mandatory check.

Disposition `not-applicable` requires the same `kind`, `check`, `originDigest` and `reason`, plus:

```json
{
  "disposition": "not-applicable",
  "scopeDigest": "<SHA-256 of the declared repository scope>",
  "scopeJustification": "This question concerns the explicitly excluded legacy directory",
  "repository": "repository-a",
  "exclusion": "legacy/**"
}
```

`repository` must select a declared repository and `exclusion` must exactly equal an entry in its `exclusions` array. `scopeDigest` hashes the complete declared scope using canonical sorted-object-key JSON; array order is preserved. A free-form justification or invented exclusion is insufficient. The receipt explains why that declared exclusion applies to this specific question; it does not exempt unrelated gate failures.

Receipts are canonical facts with `kind: "check-resolution"`, selectable through `--fact-kind check-resolution`. Report models retain them under `provenance.checkResolutions`; canonical report wrapping also exposes them as facts. Replaying an identical receipt is idempotent. Different origins with identical question text remain independent. A question introduced again after resolution receives a new origin, so an old receipt cannot resolve it.

## Question history and lineage

`summary.checkOrigins` stores carried questions as `{ "check": "...", "originDigest": "..." }`. A newly produced question obtains its origin from that artifact's digest when consumed by a later attempt; this avoids a self-referential digest. `summary.checkHistory` is the ordered list of immutable prior partial artifacts, each `{ "artifact": "<absolute result path>", "outputDigest": "..." }`. Validation reads those files, checks their digests, stage and scope, and verifies that receipts refer to real historical questions. Outstanding questions come from the latest attempt snapshot, with their origins retained; older resolved questions are not restored by unioning historical attempts.

For stage N, `summary.lineage` contains exactly one descriptor for each stage 0 through N−1, ordered by stage. Stage 0 uses an empty array. Each descriptor has:

```json
{
  "stage": 0,
  "artifact": "<absolute path to canonical/stage-result.json>",
  "outputDigest": "<canonical artifact digest>",
  "scopeDigest": "<complete repository scope digest>"
}
```

Every referenced result must be closed, internally digest-valid and bound to the same declared repository scope. Object descriptors must supply matching `stage`, `outputDigest` and `scopeDigest`; a path string selects the current file directly. Its own lineage must match the selected earlier revisions, including paths, stages and digests. With state, the selected tip must match the active canonical artifact. Standalone execution requires an explicit complete selected chain; it proves that chain's consistency, not that no newer artifact exists elsewhere.

Checked receipts require the persisted `canonical/stage-result.json`, evidence sidecar and manifest. Direct state advancement and lineage reads validate that artifact and resolve receipt references to actual evidence rows. A receipt's own `evidenceRefs` declaration cannot substitute for stored evidence. Reissue standalone legacy JSON containing checked receipts as a complete artifact.

## Stage 7 and compatibility

Stage 7 validates the complete selected chain 0..6 before constructing its report. Missing stages, duplicate revisions, scope mismatches, changed digests, a wrong state tip or unresolved questions reject the build. It merges planning facts from that validated chain and reconciles questions against the latest snapshot. Its normalized report retains the selected lineage under `provenance.lineage`; the canonical wrapper copies it into `summary.lineage`. No partial report model is published as a replacement for a failed closure gate.

The schema version and public `stage-N/canonical` paths remain unchanged. These checks deliberately tighten acceptance: legacy closed artifacts with unresolved checks, missing complete lineage or unprovable resolution origins must be reissued or reconfirmed, along with every dependent downstream digest. Preserve the immutable originals. Do not edit old JSON or synthesize lineage to make a historical artifact appear verified.

## Partial retry and recovery

Optional `checkRequirements: [{check, type: "source-confirmation", repository, file, line?, endLine?, claimRef?}]` binds a source-confirmation blocker to its source context. It is retained in canonical summary/history and cannot be weakened on retry. A checked receipt requires current exact source-confirmed evidence matching that context; a candidate or unrelated evidence ID is insufficient. Ordinary technical checks retain their normal evidence contract. An incorrectly classified technical blocker can use `disposition: "corrected"`, with reason and `correctionRef` to an actual gap/limitation. This disposition cannot discharge a typed source-confirmation obligation.

To refine a closed stage, use the public command `node scripts/index.js stage_state revise --state original.json --stage N --output-state revised.json --reason "..."` (N=0..7). It creates a separate state retaining the exact predecessors and source revision digests, and requires reissue of N and downstream stages. Use a separate `--output-root` for reissued artifacts. Original state and artifacts stay immutable. `scripts/state/src/stage_state.js` is an internal module; public CLI entry is `scripts/index.js stage_state`.

Repeat the corrected request with the same `--state` and `--output-root`. Preflight happens before the runner: a closed stage is immutable, and a conflicting stage lock stops the request. For a partial stage the coordinator prepares and validates a unique attempt under `.attempts/stage-N/<id>/prepared`, then archives the previous partial under the same attempt's `previous` directory, publishes to `stage-N`, and advances state only for a closed result.

The small `.transactions/stage-N.json` journal binds the request digest, stage, state path and candidate digest. Publication and state advancement are separate operations, not one filesystem transaction. A failed publication restores the previous partial where possible; the retained journal allows the original request to resume prepared work. Once publication succeeded, repeat the same request to validate the published artifact and finish state advancement without rerunning research. A different request cannot replace a pending transaction.

State writes use a unique temporary file and rename; advancement of the same already-recorded artifact/digest is idempotent. Stage and state locks are exclusive. An interrupted process can leave a lock: stop and verify its owner has terminated before manually removing that specific orphan lock, then retry the original request. Locks are never deleted automatically based on age, and automatic recovery while an uncertain lock remains is not promised. Keep archived partial attempts: resolution receipts depend on their digests and paths.
