# Incremental query-cache benchmark: internal shadows

The benchmark compares repeated Stage 1–2 execution with the query-result cache disabled and enabled. Both modes use the same enabled file-analysis cache, warmed by a seed sibling inventory. Every measured sample runs in a separate child process and unique parent directory with AST concurrency `2`.

Each of two balanced series contains one warmup and six measured samples per mode. For every sample, `pairWall = stage1Wall + stage2Wall`. The series result is the median of those paired values. Complete samples, provenance and semantic digests are stored in [internal-shadows-query-cache-20260910.json](internal-shadows-query-cache-20260910.json); the executable harness is [query_cache.js](../../scripts/benchmarks/query_cache.js).

| Series | Baseline Stage 1+2, ms | Query cache, ms | Gain | Baseline `runQuery`, ms | Calls baseline → cache |
|---:|---:|---:|---:|---:|---:|
| 1 | 3995.13 | 2979.29 | **25.43%** | 1141.67 | 19 → 0 |
| 2 | 3559.05 | 2675.16 | **24.83%** | 971.45 | 19 → 0 |

Stage 1 and Stage 2 semantic digests match in both modes and series. The implementation passes the predefined requirement of at least 5% gain in each series and is retained. The conclusion is scoped to this workload.

Peak RSS changed from 580282 to 596636 KiB in series 1 and from 596098 to 597464 KiB in series 2. The query cache added about 587040 bytes to the existing roughly 56.3 MB file-analysis cache. RSS and cache size are diagnostic measurements and were not acceptance gates.
