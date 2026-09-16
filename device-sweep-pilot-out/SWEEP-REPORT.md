# Fase 2b core-placement energy sweep

The stability check below is the first result to read. A block over the configured 5% throughput-spread limit is marked **UNINTERPRETABLE**; its arm rows and frontier points must not be used for a lever conclusion.

## 1. Stability check — read first

| model | comparison | position | arm | executed order | observed CPUs | per-CPU clocks (kHz) | per-rep generation t/s | spread | usable | status |
|---|---|---:|---|---|---|---|---|---:|---:|---|
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 1 | a55_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | 0-5 (in-band) | cpu0=1990765/cpu1=1990765/cpu2=1990765/cpu3=1991265/cpu4=1991265/cpu5=1991265/cpu6=760628/cpu7=761876 kHz | r1=0.8/r2=0.7/r3=0.7 | 13.6% | 3/3 | **UNINTERPRETABLE** |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 2 | a76_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | 6-7 (in-band) | cpu0=589312/cpu1=589312/cpu2=589855/cpu3=589855/cpu4=589855/cpu5=595290/cpu6=2146830/cpu7=2146830 kHz | r1=3.7/r2=3.7/r3=3.7 | 0.0% | 3/3 | **UNINTERPRETABLE** |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 3 | a76_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | 6-7 (in-band) | cpu0=595620/cpu1=594161/cpu2=594161/cpu3=594161/cpu4=588686/cpu5=590146/cpu6=2141423/cpu7=2141423 kHz | r1=3.7/r2=3.7/r3=3.7 | 0.0% | 3/3 | **UNINTERPRETABLE** |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 4 | a55_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | 0-5 (in-band) | cpu0=1990645/cpu1=1990645/cpu2=1990645/cpu3=1990645/cpu4=1990645/cpu5=1991210/cpu6=761815/cpu7=763548 kHz | r1=0.7/r2=0.7/r3=0.7 | 0.0% | 3/3 | **UNINTERPRETABLE** |

**STOP:** at least one block exceeded the 5% stability limit; its arm block and comparison frontier are uninterpretable, while unaffected comparisons remain separately marked.

## 2. Idle floor
The screen-awake idle sampler ran for 61.5 s across 60 samples: mean 0.506 W, p5 0.413 W, integrated 30.440 J.
Idle screen state: mWakefulness=Awake → mWakefulness=Dozing; battery 64%/230 deci-C → 63%/240 deci-C.

## 3. Block order and battery state

| model | comparison | position | arm | executed order | observed CPUs | start screen | end screen | start level/temp | end level/temp |
|---|---|---:|---|---|---|---|---|---|---|
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 1 | a55_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | 0-5 (in-band) | mWakefulness=Awake | mWakefulness=Dozing | 63% / 240 deci-C | 60% / 230 deci-C |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 2 | a76_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | 6-7 (in-band) | mWakefulness=Awake | mWakefulness=Dozing | 60% / 230 deci-C | 58% / 260 deci-C |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 3 | a76_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | 6-7 (in-band) | mWakefulness=Awake | mWakefulness=Dozing | 58% / 260 deci-C | 56% / 280 deci-C |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 4 | a55_t2 | a55_t2(p1) → a76_t2(p2) → a76_t2(p3) → a55_t2(p4) | 0-5 (in-band) | mWakefulness=Awake | mWakefulness=Dozing | 56% / 270 deci-C | 53% / 240 deci-C |

## 4. Per-arm, per-rep results

| model | block | position | arm | mask | observed CPUs | per-CPU clocks (kHz) | threads | rep | gen t/s | decode_s | coverage | J/decode-tok | J_load_idle | J_prefill | J_decode | warnings | screen start→end | battery start→end | block status |
|---|---|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 1 | a55_t2 | 3f | 0-5 (in-band) | cpu0=1990765/cpu1=1990765/cpu2=1990765/cpu3=1991265/cpu4=1991265/cpu5=1991265/cpu6=760628/cpu7=761876 kHz | 2 | 1 | 0.8 | 323.061 | 99.5% | 0.747 | 131.275 | 52.336 | 191.121 | sampler cadence max 4.500 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 63%/240 → 60%/230 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 1 | a55_t2 | 3f | 0-5 (in-band) | cpu0=1990765/cpu1=1990765/cpu2=1990765/cpu3=1991265/cpu4=1991265/cpu5=1991265/cpu6=760628/cpu7=761876 kHz | 2 | 2 | 0.7 | 350.259 | 99.5% | 0.318 | 145.145 | 13.267 | 81.319 | sampler cadence max 4.500 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 63%/240 → 60%/230 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 1 | a55_t2 | 3f | 0-5 (in-band) | cpu0=1990765/cpu1=1990765/cpu2=1990765/cpu3=1991265/cpu4=1991265/cpu5=1991265/cpu6=760628/cpu7=761876 kHz | 2 | 3 | 0.7 | 353.742 | 98.8% | 0.280 | 140.470 | 10.213 | 71.703 | sampler cadence max 4.500 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 63%/240 → 60%/230 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 2 | a76_t2 | c0 | 6-7 (in-band) | cpu0=589312/cpu1=589312/cpu2=589855/cpu3=589855/cpu4=589855/cpu5=595290/cpu6=2146830/cpu7=2146830 kHz | 2 | 1 | 3.7 | 69.775 | 97.3% | 0.616 | 25.541 | 10.859 | 157.677 | sampler cadence max 3.490 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 60%/230 → 58%/260 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 2 | a76_t2 | c0 | 6-7 (in-band) | cpu0=589312/cpu1=589312/cpu2=589855/cpu3=589855/cpu4=589855/cpu5=595290/cpu6=2146830/cpu7=2146830 kHz | 2 | 2 | 3.7 | 68.871 | 96.5% | 0.625 | 11.553 | 11.253 | 160.013 | sampler cadence max 3.490 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 60%/230 → 58%/260 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 2 | a76_t2 | c0 | 6-7 (in-band) | cpu0=589312/cpu1=589312/cpu2=589855/cpu3=589855/cpu4=589855/cpu5=595290/cpu6=2146830/cpu7=2146830 kHz | 2 | 3 | 3.7 | 69.640 | 98.5% | 0.631 | 9.430 | 15.317 | 161.499 | sampler cadence max 3.490 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 60%/230 → 58%/260 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 3 | a76_t2 | c0 | 6-7 (in-band) | cpu0=595620/cpu1=594161/cpu2=594161/cpu3=594161/cpu4=588686/cpu5=590146/cpu6=2141423/cpu7=2141423 kHz | 2 | 1 | 3.7 | 69.076 | 99.0% | 0.657 | 24.349 | 7.548 | 168.120 | sampler cadence max 3.350 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 58%/260 → 56%/280 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 3 | a76_t2 | c0 | 6-7 (in-band) | cpu0=595620/cpu1=594161/cpu2=594161/cpu3=594161/cpu4=588686/cpu5=590146/cpu6=2141423/cpu7=2141423 kHz | 2 | 2 | 3.7 | 69.226 | 96.9% | 0.632 | 18.651 | 14.132 | 161.870 | sampler cadence max 3.350 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 58%/260 → 56%/280 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 3 | a76_t2 | c0 | 6-7 (in-band) | cpu0=595620/cpu1=594161/cpu2=594161/cpu3=594161/cpu4=588686/cpu5=590146/cpu6=2141423/cpu7=2141423 kHz | 2 | 3 | 3.7 | 68.810 | 99.0% | 0.624 | 23.632 | 12.875 | 159.860 | sampler cadence max 3.350 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 58%/260 → 56%/280 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 4 | a55_t2 | 3f | 0-5 (in-band) | cpu0=1990645/cpu1=1990645/cpu2=1990645/cpu3=1990645/cpu4=1990645/cpu5=1991210/cpu6=761815/cpu7=763548 kHz | 2 | 1 | 0.7 | 353.000 | 99.4% | 0.345 | 156.314 | 16.613 | 88.253 | sampler cadence max 4.100 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 56%/270 → 53%/240 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 4 | a55_t2 | 3f | 0-5 (in-band) | cpu0=1990645/cpu1=1990645/cpu2=1990645/cpu3=1990645/cpu4=1990645/cpu5=1991210/cpu6=761815/cpu7=763548 kHz | 2 | 2 | 0.7 | 353.608 | 99.9% | 0.284 | 152.732 | 8.756 | 72.644 | sampler cadence max 4.100 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 56%/270 → 53%/240 | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | 4 | a55_t2 | 3f | 0-5 (in-band) | cpu0=1990645/cpu1=1990645/cpu2=1990645/cpu3=1990645/cpu4=1990645/cpu5=1991210/cpu6=761815/cpu7=763548 kHz | 2 | 3 | 0.7 | 352.446 | 99.1% | 0.333 | 130.569 | 11.571 | 85.210 | sampler cadence max 4.100 s exceeds 2 s (edge uncertainty up to one interval) | mWakefulness=Awake→mWakefulness=Dozing | 56%/270 → 53%/240 | UNINTERPRETABLE |

## 5. Order confound and self-consistency

The ABBA order-confound estimate compares the same arm in its early and late positions. A step over the configured stability limit makes the model UNINTERPRETABLE for the placement headline; missing or warning-bearing buckets are also shown rather than treated as stable.

| model | comparison | arm | early position J/token | late position J/token | late-vs-early step | n early/late | status |
|---|---|---|---:|---:|---:|---:|---|
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a55_t2 | 0.448 | 0.321 | -28.5% | 3/3 | **UNINTERPRETABLE** |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a76_t2 | 0.624 | 0.638 | 2.2% | 3/3 | **UNINTERPRETABLE** |

Self-consistency checks:
- LFM2.5-2.6B-Q4_K_M: unset control versus a76_t2 J/token difference = n/a% (n=0/6); this is a diagnostic, not a substitute for placement proof.
- LFM2.5-2.6B-Q4_K_M/primary_t2: a55_t2 versus a76_t2 generation ratio = 0.19x (n=6/6); a76_t2 p2→p3 J/token step = 2.2%.
- LFM2.5-2.6B-Q4_K_M/a55_t6: a55_t6 versus a76_t2 generation ratio = n/ax (n=0/0); a76_t2 p2→p3 J/token step = n/a%.

## 6. Frontier: J/token versus relative slowdown

Relative slowdown is mean stamped decode duration against the `a76_t2` no-change control in the same comparison. The owner reading rule is a possible win only when slowdown ≤25% and J/token falls by ≥15%; unstable blocks, low-resolution/cadence warnings, missing reps, and an excessive same-arm order step remain uninterpretable.

| model | comparison | arm | mean decode_s | mean J/decode-tok | slowdown vs a76_t2 | J/token change | owner rule |
|---|---|---|---:|---:|---:|---:|---|
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a55_t2 | 347.686 | 0.385 | 402.2% | -39.0% | UNINTERPRETABLE |
| LFM2.5-2.6B-Q4_K_M | primary_t2 | a76_t2 | 69.233 | 0.631 | 0.0% | 0.0% | UNINTERPRETABLE |

## 7. Provenance and reading rules

- Raw sampler CSVs, `.marks`, `.stamps`, and CLI output are under `phase-data/`; `idle-floor.csv` is the 60-second screen-awake floor.
- Sweep stems are not entries in the committed counts manifest; prompt_n and predicted_n come from the phase stamps. The manifest is passed for compatibility but is not consulted for these stem names; see `split.stdout` and `split.stderr` for the exact rerun output.
- Absolute J/token is session-relative. Compare the frontier only after the stability check and the session idle floor are recorded.
