# Artifact Schemas

Use UTF-8 JSON with `schema_version: 1`. Keep artifacts compact and evidence-based.

## scope.json

```json
{
  "schema_version": 1,
  "repositories": [
    {
      "name": "repo-name",
      "path": "absolute-path",
      "branch": "feature-branch",
      "head": "commit-sha",
      "base": "origin/main",
      "base_source": "user|remote_head|unknown",
      "diff_range": "origin/main...HEAD",
      "commit_subjects": ["TASK-123: Explain the implemented change"],
      "include_worktree": false,
      "branch_files": ["src/file.js"],
      "worktree_files": [],
      "overlap_files": [],
      "status_lines": [],
      "diff_stats": {
        "branch": {"files": 1, "insertions": 10, "deletions": 2, "binary_files": 0},
        "worktree": {"files": 0, "insertions": 0, "deletions": 0, "binary_files": 0},
        "selected": {"files": 1, "insertions": 10, "deletions": 2, "binary_files": 0}
      },
      "selected_diff": {
        "sha256": "lowercase SHA-256",
        "bytes": 1024,
        "hunks": 2,
        "encoding": "utf8"
      },
      "analysis_hints": {
        "signals": {
          "algorithm_or_control_flow": true,
          "state_transition": false,
          "api_contract": false,
          "insufficient_context": false,
          "large_diff": false
        },
        "reasons": ["algorithm_or_control_flow"],
        "source_context_required": true,
        "suggested_route": "expanded"
      }
    }
  ],
  "context": {
    "task_id": "TASK-123",
    "task_context_path": "absolute path to task context file or directory",
    "artifact_directory": "absolute destination directory",
    "register_in": "absolute task context file or README path",
    "source": "user|project_instructions|existing_context"
  },
  "questions": [],
  "ready": true
}
```

`selected.diff` is a transient analysis input. Verify its SHA-256 against `selected_diff.sha256`; do not persist the patch with task artifacts.

## artifact-bundle.json

```json
{
  "schema_version": 1,
  "artifacts": [
    {"path": "scope.json", "format": "json", "content": {}},
    {"path": "facts.json", "format": "json", "content": {}},
    {"path": "author-output.json", "format": "json", "content": {}},
    {"path": "draft.md", "format": "text", "content": ["Title", "", "Ready PR description"]},
    {"path": "editorial-review.json", "format": "json", "content": {}},
    {"path": "model-usage.json", "format": "json", "content": {}}
  ]
}
```

Allowed paths are `scope.json`, `facts.json`, optional `author-output.json`, optional `outline.json`, `draft.md`, `editorial-review.json`, optional `revision.json`, and optional `model-usage.json`. The bundle is transient and is not copied by persistence.

## analysis-input.json

Transient compact evidence used by the fact validator. Evidence entries use `[operation, line, text]`; candidates use `[type, value, path, line]`.

```json
{
  "schema_version": 1,
  "preparer_version": 1,
  "source": {"repository": "repo-name", "selected_diff_sha256": "sha256"},
  "candidates": [["feature_flag", "flagName", "src/file.js", 10]],
  "files": [
    {"path": "src/file.js", "test": false, "binary": false, "generated": false,
     "evidence": [["+", 10, "Features.isEnabled(\"flagName\")"]], "omitted_lines": 0}
  ],
  "truncation": {"max_bytes": 90000, "truncated": false, "output_bytes": 1024}
}
```

`analysis-prompt.txt` assigns stable sequential IDs (`E1`, `E2`, ...) to retained evidence lines and fuses candidate type/value tags into those lines. The full candidate and evidence structures remain in `analysis-input.json` for validation. Neither file is persisted.

## facts.json

```json
{
  "schema_version": 1,
  "title": "Short action-focused title",
  "summary": {
    "problem": "Observed problem or motivation",
    "solution": "Implemented approach",
    "outcome": "Result for users or maintainers"
  },
  "architecture": {
    "before": ["Previous ownership or execution flow"],
    "after": ["New ownership or execution flow"]
  },
  "items": [
    {
      "id": "C1",
      "kind": "change|flow|rule|contract|feature_flag|risk|test_added|test_updated|test_removed|check_run|context",
      "statement": "One supported fact",
      "toggle": {
        "key": "source-level feature key",
        "binding": "runtime/configuration constant, variable, configuration path, or deployment variable",
        "default_state": "enabled|disabled|other evidence-backed value",
        "enabled_behavior": "observable behavior when enabled",
        "disabled_behavior": "observable behavior when disabled",
        "scope": "where the toggle applies",
        "owner": "component or system that supplies the value"
      },
      "evidence": [
        {"repository": "repo-name", "path": "src/file.js", "symbol": "optionalSymbol",
         "line": 10, "quote": "Exact text from analysis-input"}
      ]
    }
  ],
  "unknowns": []
}
```

`toggle` is required only for `feature_flag` facts. Every field must be non-empty and evidence-backed. Do not use placeholders such as `unknown`, `n/a`, or the source key repeated as `binding`. If the evidence package does not establish the external binding or another required field, keep it in `unknowns` and do not finalize the description.

Use `test_added`, `test_updated`, and `test_removed` for test suites/scenarios changed in the diff. Every changed test file must be represented by at least one matching test fact. Use `check_run` only for commands or scenarios actually executed during the run or explicitly confirmed by the user. Source-derived rules and contracts require exact `line` and `quote`. Model-proposed unknowns remain analysis data and are not rendered without confirmation. `impact` is optional: deterministic Fast facts may include it, while Semantic/Deep authors omit it and put rationale in the complete draft.

## outline.json (optional)

```json
{
  "schema_version": 1,
  "route": "expanded",
  "title": "Short action-focused title",
  "sections": [
    {"name": "Кратко", "purpose": "Problem, solution, outcome", "fact_ids": [], "required": true},
    {"name": "Ключевые изменения", "purpose": "Highest-impact changes", "fact_ids": ["C1"], "required": true},
    {"name": "Как работает", "purpose": "Changed execution flow", "fact_ids": ["F1"], "required": false},
    {"name": "Что проверено", "purpose": "Executed checks and added tests", "fact_ids": ["T1"], "required": true}
  ]
}
```

Assign each fact ID to one primary section. Summary fields may support `Кратко` without fact IDs.

## author-output.json (Semantic/Deep)

```json
{
  "schema_version": 1,
  "facts": {"schema_version": 1, "title": "...", "summary": {}, "architecture": {},
    "items": [{"id": "C1", "kind": "change", "statement": "...", "evidence_ids": ["E1", "E3"]}], "unknowns": []},
  "draft": "# Complete reviewer-oriented PR description\n"
}
```

The author writes the complete draft directly from the compact evidence package and cites only supplied `evidence_ids`. Before validation or caching, the orchestrator replaces IDs with canonical repository/path/line/quote objects. Persisted `author-output.json` and `facts.json` therefore keep the expanded schema shown above under `facts.json`. Full legacy evidence objects remain accepted as input. The draft must explain the problem, trigger, before/after flow, outcomes, exceptions, risks, and verification without mechanically concatenating fact statements.

## editorial-review.json

```json
{
  "schema_version": 1,
  "iteration": 1,
  "draft_sha256": "lowercase SHA-256",
  "passed": false,
  "mode": "deterministic|reader",
  "reader_test_passed": true,
  "reader_answers": {
    "problem": {"status": "clear", "answer": "...", "draft_evidence": "exact draft fragment"},
    "trigger": {"status": "clear", "answer": "...", "draft_evidence": "exact draft fragment"},
    "execution_flow": {"status": "clear", "answer": "...", "draft_evidence": "exact draft fragment"},
    "outcomes_and_exceptions": {"status": "clear", "answer": "...", "draft_evidence": "exact draft fragment"},
    "key_rules_and_values": {"status": "clear|not_applicable", "answer": "...", "draft_evidence": "exact draft fragment or empty"},
    "verification_and_risks": {"status": "clear", "answer": "...", "draft_evidence": "exact draft fragment"}
  },
  "dimensions": {
    "semantic_precision": "pass|fail",
    "terminology_provenance": "pass|fail",
    "language_consistency": "pass|fail",
    "reader_clarity": "pass|fail",
    "relevance": "pass|fail",
    "conciseness": "pass|fail"
  },
  "issues": [
    {
      "id": "E1",
      "category": "one dimension name",
      "severity": "must_fix",
      "owner": "analyze|outline|render",
      "location": "section or text fragment",
      "problem": "why the text is defective",
      "operation": "replace|delete|merge|rewrite|shorten",
      "replacement": "ready-to-apply text or instruction",
      "fact_ids": ["C1"]
    }
  ]
}
```

`passed` may be true only when every dimension is `pass` and no `must_fix` issue remains. A nonstandard domain term must be traceable to source evidence, user wording, an identifier, or an explicit definition.

## model-usage.json (optional)

```json
{
  "schema_version": 1,
  "model": "provider/model",
  "cache": "miss|hit|stored_from_fast|stored_from_model|stored_from_file",
  "model_invoked": false,
  "usage": {"input_tokens": 1000, "output_tokens": 200, "total_tokens": 1200}
}
```

Fast, Semantic and Deep use separate cache identities. On a cache hit, `usage` is historical source usage and `model_invoked` is false. Current-run token consumption is zero.

## revision.json

```json
{
  "schema_version": 3,
  "decision": "pass",
  "reviewed_draft_sha256": "hash of the authored draft",
  "reader_answers": {
    "problem": {"status": "clear", "answer": "...", "draft_evidence": "exact authored-draft fragment"}
  },
  "rule_coverage": {
    "covered": [{"fact_id": "R1", "anchor": "short unique final-draft fragment"}],
    "omitted": [{"fact_id": "C2", "reason": "Concrete low-impact reason"}]
  },
  "identified_issues": [],
  "final_dimensions": {
    "semantic_precision": "pass",
    "terminology_provenance": "pass",
    "language_consistency": "pass",
    "reader_clarity": "pass",
    "relevance": "pass",
    "conciseness": "pass"
  },
  "remaining_issues": [],
  "iterations": [
    {
      "iteration": 1,
      "applied_issue_ids": [],
      "owners_rerun": [],
      "summary": "Authored draft passed reader review"
    }
  ]
}
```

For `decision: pass`, include one `reader_answers` object and omit `revised_draft`, `reader_answers_before`, and `reader_answers_after`.

For `decision: revise`, replace `reader_answers` with:

```json
{
  "revised_draft": "# Complete revised PR description\n",
  "reader_answers_before": {
    "problem": {"status": "clear|missing|ambiguous", "answer": "...", "draft_evidence": "exact authored-draft fragment"}
  },
  "reader_answers_after": {
    "problem": {"status": "clear", "answer": "...", "draft_evidence": "exact revised-draft fragment"}
  },
  "identified_issues": [{"id": "E1", "problem": "..."}]
}
```

The final reader-answer object must contain `problem`, `trigger`, `execution_flow`, `outcomes_and_exceptions`, `key_rules_and_values`, and `verification_and_risks`. Every `clear` or `ambiguous` answer cites an exact fragment from the corresponding draft; `missing` may use an empty fragment. `key_rules_and_values` may be `not_applicable` only when facts contain no rules, contracts or feature flags. `rule_coverage` must classify every `rule`, `contract`, and `feature_flag`; covered entries use a short fragment that occurs exactly once in the final draft. `draft_evidence` remains accepted for backward compatibility. Numeric/formula rules cannot be omitted. The reviewed hash must match the current authored draft. A revised draft must pass the mechanical lint and become the exact persisted draft after newline normalization.

## validation.json

```json
{
  "schema_version": 1,
  "passed": true,
  "errors": [],
  "warnings": [],
  "checks": {
    "artifacts_valid": true,
    "editorial_review_passed": true,
    "claims_supported": true,
    "facts_not_repeated": true,
    "verification_honest": true,
    "detail_budget_respected": true,
    "reader_comprehension_passed": true
  }
}
```

## manifest.json

Created during persistence:

```json
{
  "schema_version": 1,
  "persisted_at": "ISO-8601 timestamp",
  "source": {
    "repositories": [],
    "task_id": "TASK-123"
  },
  "artifacts": [
    "pr-description.md",
    "scope.json",
    "facts.json",
    "author-output.json",
    "editorial-review.json",
    "model-usage.json",
    "revision.json",
    "validation.json"
  ]
}
```
