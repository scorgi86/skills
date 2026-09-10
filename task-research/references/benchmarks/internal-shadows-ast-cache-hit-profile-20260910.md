# Warm AST cache-hit profile: internal shadows

The profile uses the saved internal-shadows Stage 1–2 workload with a warmed file-analysis cache and query-result cache. After one warmup it records ten samples for each stage. Component probes overlap and must not be summed. Raw samples and environment provenance are stored in [internal-shadows-ast-cache-hit-profile-20260910.json](internal-shadows-ast-cache-hit-profile-20260910.json); the harness is [ast_cache_hit_profile.js](../../scripts/benchmarks/ast_cache_hit_profile.js).

| Metric | Stage 1 | Stage 2 |
|---|---:|---:|
| Files / queries | 7 / 7 | 12 / 12 |
| Cached analysis result | 30.35 MiB | 30.73 MiB |
| Source read | 2.30 ms | 3.20 ms |
| Content hash and identity | 2.66 ms | 2.51 ms |
| File-cache read | 147.04 ms | 139.41 ms |
| File-cache `JSON.parse` | 252.65 ms | 236.48 ms |
| File-cache read, parse and validation | 490.37 ms | 462.33 ms |
| Post-analysis query/projection | 3.96 ms | 30.90 ms |
| Full warm batch, concurrency 1 | 451.62 ms | 461.32 ms |
| Full warm batch, concurrency 2 | 812.13 ms | 736.50 ms |

For a warm cache, concurrency `1` is **44.39% faster** on Stage 1 and **37.36% faster** on Stage 2. Two workers must each load large JSON entries and transfer roughly 30 MiB of structured analysis back to the parent. Source reading and hashing are below 6 ms per stage and are not useful optimization targets.

The next change should distinguish cold misses from warm hits: retain bounded workers for cold parsing, while avoiding workers for a cache-hit-heavy batch. Any adaptive policy needs an end-to-end semantic A/B and must preserve the explicit concurrency contract.
