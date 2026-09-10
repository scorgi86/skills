# Warm Stage 1–2 residual profile: internal shadows

This run extends the isolated query-cache A/B harness with AST, source-evidence and residual intervals. Two balanced series use one warmup and four measured child-process samples per mode. The table shows the current query-cache mode; raw baseline/current samples and provenance are stored in [internal-shadows-residual-profile-20260910.json](internal-shadows-residual-profile-20260910.json).

| Series | Stage 1+2, ms | Stage 1 AST | Stage 1 evidence | Stage 1 residual | Stage 2 AST | Stage 2 evidence | Stage 2 residual |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2841.37 | 1271.04 | 111.80 | 52.04 | 1166.18 | 77.74 | 68.96 |
| 2 | 3001.43 | 1445.80 | 138.83 | 70.06 | 1185.10 | 81.61 | 81.13 |

All 19 supported queries are cache hits and `runQuery` time is zero. AST execution still occupies about 2.44–2.63 seconds across the two stages and is the dominant remaining cost. Evidence is roughly 0.19–0.22 seconds; residual work is roughly 0.12–0.15 seconds. Query-cache semantic digests match baseline in both series.

The next performance investigation should split warm AST time into source read/hash, file-cache entry read/JSON parse and analysis assembly. Canonicalization is not the next bottleneck.
