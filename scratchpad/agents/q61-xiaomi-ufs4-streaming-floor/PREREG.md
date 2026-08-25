# q61 — Xiaomi (v75, UFS 4.0, 12 GB) streaming-MoE prefill floor: the settling measurement (PREREG)

**Status: LOCKED at commit time; RUNS ONLY when the owner frees the Xiaomi.** This is HVX
prerequisite (1): q60 (Jelly/UFS 2.2) and q60b (S23/UFS 3.1) showed streaming prefill is flash +
page-fault bound (NPU headroom ≈ 1.0×); the q60b audit extrapolates pp512 ≈ 2.5–3× (1.6–4.1×) on
UFS 4.0 IF the NPU removes all user compute. This cell replaces the extrapolation with a measurement.

## Model / device
Xiaomi houji (Hexagon v75, Adreno 750, 12 GB RAM, UFS 4.0). A MoE gguf ALREADY on device that is
larger than MemAvailable at run time (streaming regime by definition) — candidates on device:
Marco-B′ Q8_0-trunk KEXP 6.5 GB may FIT on 12 GB (then it is NOT streaming: record and pick a
bigger one, e.g. the Marco Q4_K_M 10.5 GB if present, or note that no streaming-regime MoE is on
device and STOP — pushes only with owner OK and ≥ 2× free space). CPU-only (`-ngl 0`), mmap,
no repack extras, pinned llama-bench with sha recorded. NOT an NPU cell.

## Measurement (thermal guard WARN 40 / KILL 43, cool-start ≤ 32 °C, battery ≥ 45 %, unplugged declared)
- Cold protocol as q60b: sha256sum the model, then ≥ 10 min idle without touching the file;
  rep 1 = cold, reps 2–3 = warm; each rep a SEPARATE launch.
- Sizes: `-p 512` × 3 launches and `-p 2048` × 1 launch (plus `-p 128` × 1 if battery allows).
  `-n 0 -r 1 --no-warmup -t 8 -o jsonl`.
- On-device 1-s sampler per launch: utime, stime, majflt, read_bytes, /proc/pressure/io;
  ALSO record llama-bench's own load time and eval wall separately (stderr timestamps) so the
  per-launch prefetch pass and the timed eval pass are split (q60b audit finding C1).
- Sampler-window-vs-wall check per launch (q60b found an untimed extra eval pass at pp2048).

## Frozen derivations (characterization; the kernel decision is the owner's)
Per launch: eval wall; user share = utime/(8×wall); stime share; read_MB split prefetch vs eval;
eval-pass MB/s; majflt; re-read multiplier = eval read_MB / model_MB.
Headroom tables, both conventions: (a) self-consistent (each launch's own eval-pass rate),
(b) cell-best rate; k ∈ {2, 4, 8}; and the user-compute-only model (stime stays on CPU).
Wording for pp512 warm (frozen, self-consistent convention): flash-bound if I/O floor ≥ 0.8 ×
wall; compute-bound if ≤ 0.5 × wall; mixed otherwise.

## What settles HVX prerequisite (1)
- If the self-consistent user-compute-only headroom at pp512 ≥ 2.0× → streaming-NPU on v75 has a
  real ceiling; the HVX project's phase 2 (streaming ring) is worth designing.
- If ≤ 1.3× → streaming stays CPU on every generation we own; HVX (if ever) is resident-only.
- In between → owner decision with the tables.

## Outputs
`RUN_LOG.md`, `manifest.json`, `raw/`, `REPORT.md` (numbers only + both headroom tables + the
disclaimer/legend from q60b).
