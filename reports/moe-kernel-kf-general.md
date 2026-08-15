# K-F GENERAL probe — does the win transfer to fast-flash silicon? — 2026-08-14

Xiaomi (flagship-class, fast UFS), Marco-Mini KEXP, campaign lineup cell
flags (t4, k6, d0.65, cache 2000, overlap, io4), screen ON (mWakefulness
Awake per doctrine), UNPLUGGED, batt 54→51 (3 points, ~15 min window
offered by owner). kf binary = lead-time build (md5 efec8753, branch @
`cad9428`), pushed to `/data/local/tmp/kf_general/`; campaign binaries
untouched. 4 x 200-token runs: OFF(cold-ish) → ON w6 → ON w4 → OFF(hot).

## Verdict: **KF_GENERAL = NOT UNIVERSAL — stall-share-gated (dispatcher lever, not default)**

| run | arm | wall s/tok | compute | stall | stall% | read MiB/tok | precision | note |
|---|---|---|---|---|---|---|---|---|
| 1 | OFF cold | 0.446 | 0.351 | 0.084 | 18.8 | 52.4 | — | warms cache |
| 2 | ON w6 | 0.404 | 0.350 | 0.042 | 10.4 | 72.8 | 68.6% | late 9% (gap 8/14ms), io-svc 5ms, inflight ≤6 |
| 3 | ON w4 | 0.406 | 0.344 | 0.051 | 12.6 | 58.4 | 76.7% | late 6%, inflight ≤4 |
| 4 | **OFF hot** | **0.398** | **0.303** | 0.084 | 21.1 | 52.4 | — | hottest run, still fastest |

Hot comparison: OFF 0.398 vs ON 0.404-0.406 → **ON is 1.5-2% SLOWER**.
The prefetch halves the stall (−0.04 s/tok) but compute rises by the
same amount (+0.045): on a fast-flash SoC the worker GEMV + extra IO
concurrency steal DRAM bandwidth from the FFN compute, and there is not
enough stall to pay for it. The ON runs even had thermal advantage
(earlier in the sequence) and still lost — the conclusion is robust in
sign, though N=1 per arm (screening cell, declared).

## The scaling law taking shape

| device | stall share OFF | K-F effect (hot) |
|---|---|---|
| Jelly (slow flash) | 27-30% | **−34% wall** (sweep: −16% at W4 sustained) |
| Xiaomi (fast flash) | 19-21% | **~0 to +2% wall (null/negative)** |

The win scales with the stall share and dies somewhere around stall
≲ 20%. This is exactly a DISPATCHER decision: `--kf-prefetch` ON only
where the first-launch probe measures stall% above threshold (~22-25%),
OFF elsewhere. K-F is a mid/low-silicon lever — which is the tier that
needs it most — not a universal default.

## Lead-time telemetry, first field data (bonus)

- Xiaomi w6: lead p10/p50/p90 = 2/7/15 ms, late 9% (gap p50/p90 8/14 ms),
  io-svc 5 ms, **max-inflight never exceeds width** → no over-issuing
  (cause C excluded here); the few lates are near-misses (cause B
  flavor: issued ~8-14 ms too late).
- w4 improves late to 6% and precision to 76.7% at equal speed — W4
  knee confirmed on a second device.
- Worker cost now visible (F1 review fix): 5.9 ms/token GEMV + 0.7
  issuing — small vs the 45 ms compute rise, so the compute penalty is
  mostly IO/bandwidth interference, not the predictor itself.

## Caveats

- N=1 per arm, 200 tokens: screening, not a registered cell.
- This kf build is ~4-5x slower in absolute than the campaign Xiaomi
  binary (build-flag gap, known F1d-style issue — REPACK/native flags);
  the OFF-vs-ON comparison is internal to one binary and unaffected in
  sign, but absolute numbers must not be compared to lineup cells.
- Battery/thermal within floors at all times; campaign binaries and
  models untouched.

## Scoreboard effect

KF_GENERAL: ⏸ hold → **MEASURED: stall-gated** (green as a dispatcher
lever for high-stall tiers; not green as a universal default). Artifacts:
`results/kf_general_xiaomi/out/` (4 stdouts).
