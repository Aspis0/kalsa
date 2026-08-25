# q60b — S23 (UFS 3.1) streaming-MoE prefill floor: does compute or flash dominate? (PREREG)

**Status: LOCKED at commit time.** Owner 25/08 "si accoda" — runs on the S23 AFTER q58 completes.
Replicates q60's measurement on the intermediate flash generation, with the CORRECTED decision
mapping from q60's math audit (the Amdahl `1/(1−share)` rule is refuted and NOT used here).

## Model / device
S23 (v73, MemTotal 7074 MiB), a MoE gguf ALREADY on device larger than MemAvailable at run time —
expected: Marco-B′ Q8_0-trunk KEXP `bd63fc0f…` (6.5 GB). No pushes (/data ~93 %). CPU-only
(`-ngl 0`), mmap, no repack extras (`-nr 1`), kalsahtp llama-bench or the #18/#23 pinned binary —
record sha. NOT an NPU cell (v73 cannot run MoE graphs anyway); this is the CPU streaming regime.

## Measurement (thermal guard WARN 40 / KILL 43, cool-start ≤ 32 °C, battery ≥ 45 %, unplugged declared)
Same as q60: `-p 128 | 512 | 2048`, `-n 0 -r 3 --no-warmup -t 8 -o jsonl`; on-device 1-s sampler
of utime+stime, majflt, read_bytes, plus `/proc/pressure/io` (record whether readable on this
device). Cold rep: first rep after a ≥ 10-min idle with the file not touched (hashing must be
done BEFORE the idle, and recorded) — q60's "cold" was contaminated; do better here.

## Frozen derivations (characterization; the decision is the owner's)
Per rep: wall, CPU busy fraction (utime+stime)/(8×wall) — reported as-is AND with the kernel
(stime) part shown separately; read MB, MB/s, majflt.
I/O floor = read_bytes / best sustained MB/s observed in the cell (and, separately, at the
S23 io_gate sequential figure from `results/io_gate/s23_ufs31/` if comparable).
**Headroom table** = wall / max(I/O floor, compute_time / k) for k ∈ {2, 4, 8}, where
compute_time = utime+stime (upper bound of accelerable work; the stime share is the caveat).
Verdict wording (frozen): "flash-bound" if I/O floor ≥ 0.8 × wall; "compute-bound" if I/O floor
≤ 0.5 × wall; "mixed" in between. No GO/NO-GO for any kernel from this cell alone.

## Outputs
`RUN_LOG.md`, `manifest.json`, `raw/`, `REPORT.md` (numbers only + the headroom table).
