# Warm AST batch routing: internal shadows

The benchmark compares baseline commit `e761e44` with batch-level cache routing. A fully populated file-analysis cache uses the sequential path; cold and mixed batches keep the existing bounded worker pool. The full Stage 1 and Stage 2 runners are measured in isolated child processes.

Each series uses one warmup and six alternating A/B samples per scenario. The second series reverses the starting runtime. Cache seeding is outside the measured runner interval. Raw samples, stage-level wall/AST/evidence/residual metrics, counts, provenance, semantic digests and quality digests are stored in [internal-shadows-parallel-ast-routing-20260910.json](internal-shadows-parallel-ast-routing-20260910.json).

| Series | Warm AST | Gain | Mixed AST | Change | Cold AST | Change | Current cold c2 vs c1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3037.14 → 2399.85 ms | +20.98% | 5315.80 → 5351.58 ms | −0.67% | 8137.87 → 8004.96 ms | +1.63% | +20.07% |
| 2 | 2883.36 → 2077.08 ms | +27.96% | 5587.13 → 5194.98 ms | +7.02% | 7797.19 → 7748.38 ms | +0.63% | +24.08% |

All semantic and quality comparisons passed. File, query, source-check and cache hit/miss patterns matched between A and B. The result supports this routing policy for the measured internal-shadows workload; it does not establish the same gain for other repository scopes or cache distributions.
