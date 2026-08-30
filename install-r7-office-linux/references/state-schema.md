# State contract

## Run directories

Use a user-owned directory for inspection and a root-owned directory for mutations. Set mode `0700`. Reject symlinked state directories and symlinked output files.

Each stage writes one atomic JSON result and stores raw command output under `logs/`.

## Common result

```json
{
  "schema_version": 1,
  "run_id": "run-20260730-a82f",
  "stage": "inspect-package",
  "status": "success",
  "warnings": [],
  "required_approvals": [],
  "next_actions": ["install"],
  "logs": {
    "stderr": "logs/inspect-package.stderr"
  }
}
```

Allowed status values:

- `success`
- `approval-required`
- `unsupported`
- `prerequisite-failed`
- `backend-failed`
- `verification-failed`
- `trust-failed`
- `state-invalid`

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | Success |
| 10 | Approval required |
| 20 | Unsupported environment or format |
| 30 | Prerequisite failed |
| 40 | Backend failure |
| 50 | Verification failure |
| 60 | Package trust failure |
| 70 | Invalid state or lock |

## Approval binding

Record exact approved actions with the inspected `run_id` and package SHA-256. Mutating scripts receive those values as explicit arguments and must reject missing actions or hash mismatches. Do not support a wildcard approval.

## JSON constraints

JSON output contains normalized scalar values and small arrays only. Store multiline or arbitrary tool output as separate files and reference the relative log path. Write to a temporary file in the same directory, validate the write, then rename atomically.
