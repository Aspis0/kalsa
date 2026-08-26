# q62 — Prefill under the PRODUCT streamer (BigMoeOnEdge `bmoe-cli --moe-stream`) on the Xiaomi (PREREG)

**Status: LOCKED at commit time. EXECUTION REQUIRES AN EXPLICIT OWNER GO** (new binary on the
device; the engine is the WIP product streamer — run, never modified). This is HVX prerequisite (1)
measured the right way: q60/q60b/q61 measured mmap page-fault streaming (pattern-bound, 0.2–0.4
GB/s); the product streamer reads expert slices with `pread` O_DIRECT (2–6 MiB) and reports its own
`io_ms` / `compute_ms` / `read_mb` (SCOUT.md).

## Device / model / binary
Xiaomi houji (v75, 11.4 GB RAM, UFS 4.0). Model ALREADY on device:
`/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf` (CalaQwen KEXP, 13,416,430,592 B, sha
`ac44e20c…` — full sha recorded in manifest, device sha256sum == PC hashlib). Model > MemTotal ⇒
true streaming regime. Binary: `bmoe-cli` CPU-only arm64 build from the pinned BigMoeOnEdge
revision (record commit + build flags + sha PC/device); prefer an existing built binary (e.g. the
Jelly's `bmoe/` deployment) if its ISA flags run on the Xiaomi; otherwise build on the PC at LOW
priority -j4. NO source modification. NO NPU, NO GPU.

## Command (from SCOUT.md; frozen)
`bmoe-cli -m <KEXP> --moe-stream --cache-mb 0 --dense-weights anon --io-threads 4 -t 4 -p 512
-n 0 -r 3 --no-warmup -c 512 --ubatch 512 --no-think --progress --csv <out>` (+ `--io-trace` for
per-read latency). Secondary arm (if battery allows): identical with `--cache-mb 2000` (expected
no effect on prefill: pp512 touches ~all experts). Optional: `-p 2048` × 1.
Thread split: `-t 4` compute + `--io-threads 4` = 8 threads; record the engine's own thread model.
Memory guard: if MemAvailable at start < (dense anon + KV + 1 GB) the run may be LMK-killed —
record MemAvailable pre/post, use `--cache-ceil-mb 2000` only if the engine needs it; an LMK kill
is recorded, not retried more than once.

## Instrumentation
Primary: the engine's `--progress`/`--csv` counters per rep: `io_ms`, `compute_ms`, `mgmt_ms`,
`read_mb`, `majflt`, `cpu_ms`, wall. Cross-check: the q61 1-s sampler (utime, stime, majflt,
read_bytes). Note: if the engine overlaps I/O and compute on separate threads, `compute_ms` is a
residual — record `--compute-trace-layers` if cheap.

## Frozen derivations (characterization; the kernel decision is the owner's)
compute_share = compute_ms / wall; io_share = io_ms / wall (overlap ⇒ they may sum > 1: report
both and the overlap fraction). I/O floor = read_mb / measured eval MB/s (engine counters).
Headroom (wall-seconds throughout) = wall / max(I/O floor, compute_wall / k), k ∈ {2, 4, 8}, with
compute_wall = compute_ms (already wall time of the compute phases). Wording for pp512 (rep 2–3):
flash-bound if I/O floor ≥ 0.8 × wall; compute-bound if ≤ 0.5 × wall; mixed otherwise.
Settling for HVX prerequisite (1): headroom(k=4) ≥ 2.0 → streaming-NPU has a real ceiling under
the product streamer; ≤ 1.3 → streaming stays CPU; between → owner decision.

## Hygiene
Thermal guard (WARN 40 / KILL 43), cool-start ≤ 32 °C, battery ≥ 45 %, unplugged declared, exact
stop rule (CDSP0 CRASHED / dspqueue_* failed / INTERNAL-ERROR / ggml_abort / GGML_ASSERT /
Aborted / Segmentation / rc ≥ 128 not from the guard), no deletions, no pushes except the binary
(and only if free space allows), sha on device. Outputs: RUN_LOG.md, manifest.json, raw/
(engine csv + traces + sampler), REPORT.md (numbers only + both shares + headroom table).
