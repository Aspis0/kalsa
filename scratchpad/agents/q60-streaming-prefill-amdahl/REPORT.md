# q60 numbers

| n | rep | cache | wall_s | compute_share | io_share | read_MB | MB/s | majflt |
|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 128 | 1 | cold-designated | 15.265489 | 0.193901 | 0.806099 | 12719.149 | 833.196 | 40647 |
| 128 | 2 | warm | 14.882079 | 0.600891 | 0.399109 | 9437.143 | 634.128 | 178482 |
| 128 | 3 | warm | 14.882993 | 0.599846 | 0.400154 | 9444.962 | 634.614 | 176033 |
| 512 | 1 | cold-designated | 23.918512 | 0.412599 | 0.587401 | 14119.940 | 590.335 | 30311 |
| 512 | 2 | warm | 23.194684 | 0.764884 | 0.235116 | 8372.535 | 360.968 | 59777 |
| 512 | 3 | warm | 24.592361 | 0.788710 | 0.211290 | 9240.158 | 375.733 | 63456 |
| 2048 | 1 | cold-designated | 103.320455 | 0.693123 | 0.306877 | 41093.218 | 397.726 | 215969 |
| 2048 | 2 | warm | 116.701619 | 0.761493 | 0.238507 | 38151.791 | 326.917 | 226507 |
| 2048 | 3 | warm | 147.049400 | 0.782509 | 0.217491 | 38232.932 | 260.001 | 165723 |

pp512 warm compute_share mean = 0.776797
pp512 warm compute_share median = 0.788710
rule = GO as phase 2 of the HVX K-quant project (NPU-for-streaming ceiling >= 2x).

max_temperature_C: pp128=28.0; pp512=30.0; pp2048=36.0

## Orchestrator arbitration (post-audit, 25/08)
The frozen rule (`compute_share ≥ 0.50 → GO`) is REFUTED by REVIEW_MATH.md: it assumed
non-overlapping I/O and compute (Amdahl `1/(1−share)`), while the raw CSVs show read_bytes and
utime growing in parallel (kernel readahead overlaps I/O with compute). The honest ceiling is
`wall / max(I/O_floor, compute/k)`; on this device the pp512 warm wall (23.2 s) already equals
its own I/O floor (22.3 s at the 361–376 MB/s the access pattern delivers) → NPU headroom
1.00–1.04× (k≥8) self-consistent, ≤1.8× even at the cell's best 634 MB/s; a net LOSS at k≤4.
Additional unmodelled cost: per-expert tiling/repack into HTP buffers = a second pass over the
same 8.4 GB per prefill (8–28 s), enough on its own to erase the headroom.
**Verdict: NO-GO for NPU-for-streaming-MoE on 8 GB / UFS 2.2 class devices.** The measurement
itself is valid and reusable; the mapping in the PREREG was the error (orchestrator's).
Open door: v75 + UFS 4.0 (Xiaomi) — one measurement re-gates it: per-rep read_bytes on a model
≥ 1.2× usable RAM (≈0 → RAM-resident, not streaming; ≈ model size → streaming persists, re-derive
with the floor at UFS 4.0 bandwidth) + a readable /proc/pressure/io; plus, for any design,
repack MB/s ≥ stream MB/s as a hard prerequisite.
