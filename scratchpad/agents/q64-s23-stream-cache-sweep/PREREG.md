# q64 — Streaming-regime cache sweep on the S23 with the PRODUCT binary (PREREG)

**Status: LOCKED at commit time (orchestrator, 2026-08-26 night; owner GO "tutto").** Closes the
old queue item #5b ("celle cache S23, sweep 1500/2000/4000, sessione unplugged dedicata") and
the row-6 remainder ("card Marco1c sul modello i1-Q4_K_M"). No number of this cell existed at
lock.

## Question
On an 8 GB device in the streaming regime (model > RAM), what is the decode/prefill cost curve
of the product streamer's expert cache size, with the SHIPPED binary? Output: the cache-size
constant for the app's 8 GB class (today chosen by hand) and the first "streaming on UFS 3.1
with the real streamer" datum (q60b measured mmap page-fault streaming, not the product path).

## Device / model / binary (frozen)
- Galaxy S23 (SM8450, 8 GB, UFS 3.1), **unplugged declared** (the queue asked for it; the
  device is unplugged now), wireless adb `R3CW406P8CV` (serial exactly as `adb devices -l`
  lists it), benches from `adb shell` (cpuset 0-7, recorded from `/proc/<pid>/cpuset`).
- Model: `/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf` (10,505,424,704 B, already on
  device — the only model > RAM on the S23; sha256 computed ON DEVICE once at start and
  recorded; no PC copy exists, so the device hash is the provenance).
- Binary: the shipped runtime `models_staging/ship_runtime_s23_0ac612de/` (bmoe-cli sha
  `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c` + 6 .so), pushed to
  `/data/local/tmp/q64_rt/`, sha on device == PC for all 7 files. NO source changes; run only.
  Known from q62: this binary has NO `-r`, NO `--no-warmup`, `-p` is prompt TEXT, `-n 0` is
  rejected; per-token telemetry via `--progress`/`--csv` (io_ms, compute_ms, mgmt_ms, read_mb,
  cache_hit_pct, majflt, cpu_ms per decode token), prefill only as `prefill: N tokens, X s`.

## Arms (frozen)
Base command (device shell):
`bmoe-cli -m <i1> --moe-stream --cache-mb <C> --dense-weights anon --io-threads 4 -t 4
-p "$(cat /data/local/tmp/q64_out/q64_p128.txt)" -n 128 -c 512 --ubatch 512 --no-think
--progress --csv <out>.csv` with the prompt file calibrated to **128 ± 8 engine-counted
tokens** (calibration loads ≤ 2, discarded). Greedy sampling (binary default; deterministic).
- C ∈ **{0, 1500, 2000, 4000, auto}** MiB (auto = the engine's own sizing, recorded from its
  log). Order per block: ABBA-style Latin square over the 5 arms, **N = 3 blocks** (15
  invocations). Each invocation = fresh process (cold expert cache by construction: cache
  lives in the process; page cache not droppable — no root — recorded).
- Per invocation: prefill wall (engine line) and tok/s (128/prefill_s); decode tok/s from the
  per-token CSV rows excluding the first 8 tokens (warm-up of the cache) and reporting both
  "tokens 9–128" mean and full-128 mean; cache_hit_pct at token 128; read_mb total;
  io_ms/compute_ms/mgmt_ms sums; majflt; MemAvailable pre/post; battery/temp pre/post.
- Gates per invocation: battery ≥ 40 % (STOP the cell below 35 %), cool start ≤ 32 °C
  (wait, poll 30 s), q56 guard (poll 10 s, WARN 40, KILL 43), cap 12 min wall, ≥ 60 s between
  invocations. Stop rule (exact substrings only): `CDSP0 CRASHED`, `dspqueue_read failed`,
  `dspqueue_write failed`, `INTERNAL-ERROR`, `ggml_abort`, `GGML_ASSERT`, `Aborted`,
  `Segmentation`, or rc ≥ 128 not from the guard. rc=1 load failure → diagnose, one retry.
  LMK kill at a cache size → record, no retry at that size (that IS the datum: it does not fit).
- Memory guard: MemAvailable at start recorded; with 10.5 GB model and 8 GB RAM, arms 4000 and
  auto may not fit — a kill is a result, not an error.

## Frozen derivations
Per arm: median over blocks of decode tok/s (9–128), prefill tok/s, cache_hit_pct, read_mb,
io share = Σio_ms/Σwall_ms over decode tokens. Curve: decode tok/s vs C. **App constant** =
the smallest C whose median decode tok/s is within 5 % of the best arm that did not get killed;
if the best is `auto`, report auto's resolved size. Comparison to q60b (mmap page-fault
streaming, same device class): reported as a ratio, no causal claim.

## Hygiene / outputs
RUN_LOG.md, manifest.json (sha, commands verbatim, gates, cpuset, guard max temp per
invocation), raw/ (csv + stdout/stderr + battery + sampler on the binary pid — q62 lesson:
follow `binary_pid`, not the wrapper), REPORT.md numbers only + `finalize_q64.py`
deterministic. No pushes except the runtime; no deletions. Harness: reuse
`scratchpad/agents/q62-product-streamer-prefill/{launch_q62.py,run_q62.py,q62_sampler.sh}`
(adapted: S23 serial, cache arms, sampler pid fix) and the q56 guard.
