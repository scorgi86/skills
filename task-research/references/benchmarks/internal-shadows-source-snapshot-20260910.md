# Source snapshot benchmark: internal shadows evidence

The benchmark isolates source evidence collection and canonical source confirmation from the saved internal-shadows Stage 1 workload. It promotes the collected exact anchors for confirmation so both modes validate the same six physical source files.

Two warmups precede twelve alternating samples per mode. `isolated` models the previous behavior with separate collection and canonicalization stores; `shared` uses one stage-scoped `SourceSnapshotStore`. The executable harness is [source_snapshot.js](../../scripts/benchmarks/source_snapshot.js), and complete samples are in [internal-shadows-source-snapshot-20260910.json](internal-shadows-source-snapshot-20260910.json).

| Mode | Median wall, ms | Median source reads |
|---|---:|---:|
| Separate stores | 252.57 | 12 |
| Shared stage snapshot | 247.50 | 6 |

Physical source reads fell by **50%**. Median wall time improved by **2.01%**. Complete prepared-facts digests are identical in every sample. The read count and semantic equality are deterministic acceptance evidence; the small wall-time difference is diagnostic and scoped to this workload.
