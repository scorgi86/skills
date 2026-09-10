# Shared AST cache A/B: internal shadows

Date: 2026-09-09. Request: `исследуй все о внутренних тенях`.

## Method

- Baseline: the saved `task-research` runtime immediately before moving the automatic cache above an individual inventory directory.
- Current: the integrated working tree after the change.
- Both versions use the same saved workload and current source repositories.
- Each sample creates a unique temporary parent. `inventory-a` is cold; sibling `inventory-b` may reuse only cache created inside that sample.
- Two series run one unmeasured warm-up per version followed by six measured samples. Baseline/current order alternates inside a series and the starting order reverses in series 2.
- Timings are medians in milliseconds. AST, evidence and residual time are recorded separately. The gate requires at least 25% warm AST improvement and at most 5% cold AST regression in every series.
- Semantic comparison removes timing, cache counters, presentation warnings and summaries. AST results, evidence, ownership and measured quality fields must match.

The executable harness is [internal-shadows-shared-cache-ab.harness.js](internal-shadows-shared-cache-ab.harness.js). The complete inputs, provenance, individual samples and summaries are in [internal-shadows-shared-cache-ab-20260909.json](internal-shadows-shared-cache-ab-20260909.json).

## Results

| Series | Path | Stage | Baseline AST | Current AST | Change | Baseline → current hits |
|---:|---|---:|---:|---:|---:|---:|
| 1 | cold | 1 | 5105.2 | 5075.1 | −0.6% | 0 → 0 |
| 1 | cold | 2 | 3866.4 | 3715.4 | −3.9% | 1 → 1 |
| 1 | warm sibling | 1 | 5095.1 | 522.4 | **−89.7%** | 0 → 7 |
| 1 | warm sibling | 2 | 3913.5 | 1149.9 | **−70.6%** | 1 → 12 |
| 2 | cold | 1 | 5802.7 | 5604.2 | −3.4% | 0 → 0 |
| 2 | cold | 2 | 4371.7 | 4434.7 | +1.4% | 1 → 1 |
| 2 | warm sibling | 1 | 5807.1 | 549.4 | **−90.5%** | 0 → 7 |
| 2 | warm sibling | 2 | 4316.4 | 1328.4 | **−69.2%** | 1 → 12 |

All cold regressions are below 5%; every warm improvement is above 25%. AST, evidence, ownership and quality digests match between versions in every stage, path and series. The optimization is accepted by the performance gate.

The cache hit still reads and hashes source bytes. It skips SWC parsing and extraction, while AST queries and source evidence checks execute again. The result therefore applies to repeated inventories under one parent with an unchanged repository scope; it does not claim the same gain for a first cold inventory.
