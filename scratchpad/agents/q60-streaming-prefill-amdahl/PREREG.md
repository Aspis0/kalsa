# q60 — Streaming-MoE prefill: compute vs I/O share (Amdahl gate for "NPU for streaming MoE") (PREREG)

**Status: LOCKED at commit time.** Owner 25/08: "scriviamo un kernel che utilizzi NPU anche per
MoE streaming". Before any kernel work, this cell measures the ceiling: in the streaming regime
(experts NOT resident, mmap file-backed, model > RAM), what fraction of PREFILL wall time is
compute (accelerable) vs I/O / page-fault stall (not accelerable by any NPU)?

## Model / device
A streaming-regime MoE ALREADY ON A DEVICE (no pushes: S23 /data 93 %): Mellum2 Q4_K_M
(S23, used for the #23 baseline `results/mellum2_cpu_baseline_s23/`) or the Jelly's resident
big MoE (`kalsa26`) — executor records which, with sha. CPU-only (`-ngl 0`), mmap, no repack
extras (`-nr` variant as in #23: the no-extra-bufts build rule on 8 GB devices).

## Measurement (under the thermal guard, WARN 40 / KILL 43, cool-start ≤ 32 °C, unplugged declared)
- Workload: llama-bench `-p 512 -n 0 -r 3 --no-warmup -t 8 -o jsonl`, cold page cache before
  rep 1 (`echo 3 > /proc/sys/vm/drop_caches` is root-only → instead evict by reading a large
  unrelated file ≥ MemTotal, or by re-launch after a cooldown; record which), then warm reps.
- Per rep, sample every 1 s from `/proc/<pid>/stat` (utime+stime), `/proc/<pid>/io`
  (read_bytes), `/proc/<pid>/status` (majflt via /proc/<pid>/stat field 12), and
  `/proc/pressure/io` if readable. Wall from jsonl.
- Derived per rep: compute_share = (utime+stime)/(n_threads × wall) clipped to [0,1]
  (CPU busy fraction across the 8 threads); io_share = 1 − compute_share; bytes read; majflt;
  effective flash MB/s = read_bytes / wall.
- Also the same for `-p 128` and `-p 2048` (3 reps each) to see how the share moves with batch.

## Frozen decision rule (characterization for the owner)
- compute_share(pp512, warm) ≥ 0.50 → "NPU-for-streaming has a ceiling ≥ 2×: GO as phase 2 of
  the HVX K-quant project".
- < 0.30 → "I/O-bound: NPU cannot help streaming prefill; drop".
- 0.30–0.50 → owner decision with the numbers (ceiling 1.4–2×).
Cold-cache reps reported separately (the product's first-prompt case).

## Outputs
`RUN_LOG.md`, `manifest.json`, `raw/` (samples CSV per rep), `REPORT.md` (numbers only: table
n × rep × {wall, compute_share, read MB, MB/s, majflt}, the rule outcome).
