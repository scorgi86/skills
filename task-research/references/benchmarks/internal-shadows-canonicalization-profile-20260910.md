# Canonicalization profile: internal shadows

The profile prepares fixed AST and source-evidence inputs from the saved internal-shadows workload, performs one warmup, then measures 15 samples per stage. Component timings overlap and must not be summed. Full samples and provenance are stored in [internal-shadows-canonicalization-profile-20260910.json](internal-shadows-canonicalization-profile-20260910.json); the harness is [canonicalization_profile.js](../../scripts/benchmarks/canonicalization_profile.js).

| Stage | Candidates | Evidence | Adapters, ms | Canonicalize, ms | Remap, ms | Full `prepareFacts`, ms | Serialize, ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 80 | 79 | 0.14 | 8.16 | 1.55 | 11.28 | 1.81 |
| 2 | 249 | 249 | 0.26 | 18.51 | 4.68 | 24.78 | 4.63 |

Semantic digests are stable across all samples. `prepareFacts` is too small relative to the roughly 2.8–3.0 second warm Stage 1+2 path to justify a dedicated optimization now.
