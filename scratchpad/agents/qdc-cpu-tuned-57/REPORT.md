# REPORT — Cell #57: honest CPU lane on the three new tiers (tuned build)

Date: 2026-09-03, owner-approved follow-up. Three sequential QDC sessions,
each portal-verified Completed, single gated arm each, all exit=0, zero gate
retries. PREREG.md in this folder; raw in raw/.

Sessions: S1 = job 797989 (`sa802058`, QRD7675, Running 08:23:45→ended
~08:31, arm done 08:29:55) · S2 = job 797998 (`sa802067`, QRD8635, arm done
08:35:57) · S3 = job 798002 (`sa802071`, QRD8650, arm done 08:42:19).
~6-8 min billed each, ~20 min total.

## Build under test

`cpu-tuned-kit-57.tgz` sha `573f1440229f4751`: llama-bench `e818d3fe…`
from kalsa/governor-v0.2 @ 1a33da0f6, `GGML_NATIVE=OFF`,
`GGML_CPU_ARM_ARCH=armv8.7-a+dotprod+i8mm+fp16`, **GGML_OPENCL=OFF** — no
GPU backend in the binary, the CPU lane is pure by construction (the bench
table shows `backend CPU`, no OpenCL banner). Model: ship LFM2.5-2.6B
QAD-Q4_0 `a247afd6…`, sha-verified on each device. -t 4, taskset top-4
(mask f0 on all three), -r 3.

## Results (raw/bench_cpu_tuned_sa8020{58,67,71}.out)

| tier | tuned pp512 | tuned tg128 | untuned pp512 (old) | untuned tg128 (old) |
|---|---|---|---|---|
| 7+ Gen 3 (7675) | **95.21 ± 1.17** | **20.02 ± 0.12** | 13.77 (#52) | 10.27 (#52) |
| 8s Gen 3 (8635) | **97.14 ± 0.99** | **20.49 ± 0.12** | 14.91 (#56) | 11.34 (#56) |
| 8 Gen 3 (8650) | **98.97 ± 12.78** | **28.58 ± 0.32** | 16.26 (#55) | 11.56 (#55) |

Tuning effect: pp512 ×6.09–6.91 (7675 6.91, 8635 6.51, 8650 6.09), tg128 ×1.81–2.47. **G3 refuted everywhere**
(tuned ≫ 1.15× untuned): the "build-suspect" caveat of #52/#55/#56 was
correct and is now settled — the old CPU numbers are retired for router use.

## Grid verdicts (G1 prefill / G2 decode, per PREREG thresholds 2× / 1.25×)

| tier | GPU pp512 (comparator) | GPU/CPU pp | G1 prefill | GPU tg128 | GPU/CPU tg | G2 decode |
|---|---|---|---|---|---|---|
| 7+ Gen 3 | 151.8 (#52) | **1.59×** | CONTESTED — per-device probe decides | 17.3 | 0.86× | **CPU wins** |
| 8s Gen 3 | 154.8 (#56) | **1.59×** | CONTESTED | 16.5 | 0.80× | **CPU wins** |
| 8 Gen 3 | 284.2 (#55, ⚠️ Amendment) | **2.87×** | GPU lane confirmed (provisional per Amendment) | 23.4 | 0.82× | **CPU wins** |

**Headline (scoped to these three single-session points): the S23 decode
pattern repeats.** With an honest CPU build, decode was CPU-territory on all
three tiers measured today (GPU at 0.80-0.86× CPU), and the GPU prefill edge
is far smaller than the crippled build suggested: 1.6× on the two mid-tiers
(inside the band where a per-device probe must decide), 2.9× on the 750.
The shape matches the S23/740 verdict (CPU decode, GPU prefill only where it
clearly pays); whether it holds under repetition, other thread counts and
thermal load is untested here.

### Caveats

1. S3 pp512 ±12.78 (13% CV) — the 8650 CPU prefill mean is noisy (single
   session, possible DVFS interaction); the G1 verdict (2.87×) survives even
   at mean+2σ (124.5 → 2.28×), so it stands, but the point estimate is soft.
   ALSO unexplained: S3 tg128 = 28.58, ~40 % above S1/S2 (~20) — plausibly
   the 8 Gen 3's five 2.96 GHz cores + higher memory bandwidth, but with one
   session per tier this is an observation, not an explanation; a repeat
   cell would be needed before citing the 28.6 as a tier constant.
2. Cross-build comparison (tuned CPU binary vs gov-kit GPU binary) shares
   ggml lineage but not the exact commit (governor-v0.2 tip vs governor-v0
   5c3979438); the CPU-side ops are unchanged between them (no CPU-path
   commits in the delta — the v0.2 delta is governor/policy code).
3. Thermal states differ across the compared cells (different sessions);
   the ABBA discipline of #53 was not applied cross-cell. Treat ratios as
   first-order, not calibration constants.
4. -t 4 on the top-4 cores; other thread counts unexplored (the app may
   choose differently).

## Router consequence

The per-device capability+performance probe (already mandated by the FA-732
and f16/bf16-750 findings) must ALSO measure the CPU/GPU prefill crossover
at first launch: on mid-tier Adrenos the 1.6× margin is too thin to hard-code.
Decode-on-CPU is the working default consistent with every measurement to
date (the S23/740 campaign plus today's three single-session points — with
today's points still unreplicated), with the GPU decode lane reserved for
thermal relief, per the owner's original tri-engine thesis.
