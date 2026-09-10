# Parallel AST benchmark: internal shadows

Date: 2026-09-09. Request: `исследуй все о внутренних тенях`.

## Method

Concurrency modes `1`, `2`, and `4` were compared on the same Stage 1–2 workload. Every sample ran in a separate child process with a unique cold cache. Two series used one unmeasured warm-up and six measured samples per mode. Mode order rotated within each series and reversed in the second series.

The acceptance rule selects the smallest mode that improves combined AST time by at least 15% in both series, does not regress combined Stage 1–2 wall time by more than 5%, and preserves semantic digests. Peak RSS is recorded only as diagnostic data.

The executable harness is [parallel_ast.js](../../scripts/benchmarks/parallel_ast.js). Complete samples and provenance are stored in [internal-shadows-parallel-ast-20260909.json](internal-shadows-parallel-ast-20260909.json).

## Results

| Series | Concurrency | Stage 1 AST, ms | Stage 2 AST, ms | Stage 1+2 wall, ms | AST gain vs 1 | Wall change vs 1 |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 6994.0 | 5457.7 | 12853.0 | — | — |
| 1 | 2 | 5364.6 | 4244.0 | 9961.3 | **22.8%** | **−22.5%** |
| 1 | 4 | 3052.4 | 3138.0 | 6589.7 | 50.3% | −48.7% |
| 2 | 1 | 6841.1 | 5102.3 | 12319.2 | — | — |
| 2 | 2 | 5169.4 | 4311.8 | 9843.4 | **20.6%** | **−20.1%** |
| 2 | 4 | 3110.2 | 3051.8 | 6568.0 | 48.4% | −46.7% |

Stage 1 and Stage 2 semantic digests match across all modes and samples. Concurrency `2` is the smallest mode that passes every gate and is therefore the recommendation. The default remains `1`; callers opt in with `ast.concurrency: 2` or CLI `--concurrency 2`.
