# Pre-registration — Kernel ship A/B, Mellum2 on S23

Registered: 2026-08-14, BEFORE any run of this experiment. Owner criterion:
"ship a kernel that improves the models we ship in a general, significant
way — I want that p-value at the end."

## Hypothesis

The certified Kalsa config for Mellum2-12B-A2.5B on S23-class devices
(dispatcher output: `-t 2 --n-expert-used 6 --drop-cold-experts 1.0`)
improves decode speed significantly over the upstream default config
(model-default routing k=8, no drop, default threads), at equal quality
(quality already gated separately: PPL k6d1.0 dMacro +0.0378 <= +0.04,
worst-lang fr +0.0877 <= +0.10, GATE_PASS 2026-08-14).

## Design

- Device: Galaxy S23 (`u0_a344@192.168.1.152:8022`), UNPLUGGED, battery
  floor 45%, thermal abort 43 C, screen state logged every run.
- Model: `~/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` (sha must match
  campaign F1 Q4 pin). Campaign binary pin: verify sha before/after, never
  overwrite.
- Arms, identical base flags (campaign cell: `--moe-stream --cache-mb 2000
  --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096
  --temp 0 --chatml --no-think`, `-n 200`, fact prompt):
  - **A (stock)**: `--n-expert-used 8` EXPLICIT (model-default routing),
    no drop flag, `-t 4`.
    *AMENDMENT 2026-08-14 19:0x, before any analyzed data:* the original
    text said "model-default n_expert_used (8)" with the flag ABSENT.
    Measured: flag-absent degenerates compute ~60-90x (21.3 s/token vs
    the historical k8 baseline 2.90 tok/s on the same binary, F1d
    MELLUM2_Q4_k8 cmdline which carries `--n-expert-used 8` explicitly;
    streaming/cache telemetry normal, so this is an engine flag-default
    pathology, filed as an engine bug note). Arm A is therefore run with
    the explicit flag, matching the historical baseline cells. The
    partial first session (warmup + pair 1 + p02_B) is discarded as
    misconfigured; the experiment restarts from scratch.
  - **B (certified)**: `-t 2 --n-expert-used 6 --drop-cold-experts 1.0`.
- Sequence: warm-up run (excluded, declared), then **12 ABBA pairs**
  interleaved as `AB BA AB BA ...` (24 measured runs). No cold resets
  between measured runs (hot regime = product regime; load/TTFT measured
  on the warm-up and on each arm's first measured run).
- Continuation: if battery floor stops the sequence, the remainder runs on
  the next battery cycle, same protocol, appended pairs only (no partial
  pairs enter analysis).

*AMENDMENT 2 (2026-08-14 23:2x, before any analyzed data of the final
session):* the first two sessions were invalidated by device RAM state,
not by config: ~1.5 GB of anon pages (incl. dense weights) compressed in
zram made arm A's compute degenerate 60-100x (21.3 s/token; B's small IO
footprint was unaffected — itself a product-relevant robustness finding,
banked separately). Protocol addition: the experiment runs on a
freshly-rebooted device; SwapFree and MemAvailable are recorded at
session start (post-reboot validation run: arm A 0.213 s/token, compute
0.084 — 100x recovery, root cause confirmed). Swap drift DURING the
session is part of measured reality and is handled by the ABBA pairing;
it is reported, not excluded.

## Primary metrics (declared now)

1. Decode wall s/token (harness-parsed `decode X s/token`), per run.
2. Sustained late-rep: median decode s/token of the last 4 pairs.
3. J/token: 1 Hz battery sampler (voltage_uV x current_uA integrated over
   the decode window) / tokens generated. Approximation declared: whole-
   device power, same screen state both arms.
4. Max battery temperature per run.
5. TTFT proxy: prefill+first-token time on each arm's first measured run.

## Analysis (declared now)

- Pairing: within each ABBA pair, the A and B runs adjacent in time.
- Test: Wilcoxon signed-rank on paired per-pair medians of metric 1;
  two-sided, alpha 0.05. Effect size: Hodges-Lehmann shift + % change.
- Metrics 2-5 reported with the same pairing; confirmatory claim is on
  metric 1, the rest are supporting.
- N>=10 completed pairs required for the confirmatory claim; fewer =
  report as incomplete, continue next cycle.
- Exclusions (declared): runs with thermal wait triggered mid-run, plugged
  state != UNPLUGGED, or harness error; excluded runs void the whole pair
  and the pair is re-run appended at the end.

## What this is NOT

- Not a test of `--kf-prefetch` (separate prototype, separate A/B on
  Jelly, factor isolated on purpose).
- Not a quality re-test (PPL gate already passed and is referenced).
