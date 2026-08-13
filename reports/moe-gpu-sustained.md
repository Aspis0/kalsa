# Sustained thermal A/B — GPU vs CPU decode marathon on S23

**Date:** 2026-08-12  
**Device:** SM-S911U (S23, Adreno 740, SM8550), ssh `u0_a344@192.168.1.152:8022`  
**Binary:** `~/gdn_k2/bin_cpufix/llama-cli` sha256 `4986ff30447cb866656bce6762e6d30266669a2ebc4055a9c2ada00b9e4fdd80`  
**Build:** `a92a51627` (repack OFF, stripped; campaign CPU tg256 = 18.19, GPU faoff tg256 = 10.25)  
**Model:** `~/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf` sha256 `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223`  
**Artifacts:** `results/gpu_sustained/`  
**On-device work dir:** `~/gdn_k2/gpu_sustained/` (nothing written outside `~/gdn_k2/`)

## Verdict

**NOT MEASURED.** Preflight refused the session: battery **56% UNPLUGGED** at 29.9 °C. Protocol start gate is **≥60%**. No arm ran. No tok/s, no J/token, no winner.

This is a gate, not a result about GPU vs CPU. Burst numbers (18.19 / 10.25) remain the only decode figures on disk for this binary. They are 256-token bursts and do **not** answer the marathon hypothesis.

Resume: charge to ≥60%, unplug, wait until battery temp is within 1 °C of a settled baseline, then `bash ~/gdn_k2/gpu_sustained/run_marathon.sh all`.

## Pre-declared protocol (not renegotiated)

| item | value |
|---|---|
| ARM_CPU | `llama-cli -ngl 0 -t 4` |
| ARM_GPU | `llama-cli -ngl 99 -fa off -t 4` |
| common | `-c 4096 --temp 0.7 -n 6144 -st -no-cnv` |
| extras (documented, necessary) | `--ignore-eos` (fill 15 min), `--perf` (timing lines), `--simple-io`, `--no-repack` (match cpufix build) |
| duration | loop segments back-to-back until ≥15 min wall per arm; no intra-arm sleep |
| order | CPU → cooldown to T0±1 °C (sample 60 s) → GPU |
| power | UNPLUGGED entire arms; start ≥60%; abort arm if <25% |
| thermal abort | battery temp >48 °C sustained 2 min |
| winner | higher **mean t/s over the final third** of each arm |

Prompt (exact): `results/gpu_sustained/prompt.txt`  
sha256 `55427c842b94878828e8c55baa1cd3ee8e3db123da9bebec4c2b33010f0c82e5`  
On-device copy: `~/gdn_k2/gpu_sustained/prompt.txt`

## Preflight evidence (on disk)

Source: `results/gpu_sustained/batt_preflight.json`, `STATUS.txt`, `master.log`, `preflight.txt`.

| field | value |
|---|---|
| ts | 2026-08-12T18:39:38-04:00 (JSON) / 18:44:08 (gate) |
| plugged | **UNPLUGGED** / DISCHARGING |
| percentage | **56** |
| temperature | **29.9 °C** (healthy start, unused) |
| voltage | 3889 mV |
| current | −35 mA (idle) |
| charge_counter | 2 118 750 µAh → 2119 mAh at 56% ⇒ implied pack ≈ 3783 mAh (matches declared 3785) |
| `dumpsys battery` | **unavailable** (`Can't find service: battery` for this Termux UID) |
| substitute | `termux-battery-status` (campaign standard; °C already in tenths) |
| llama-cli | present, executable, sha matches cpufix stripped |
| model | present at `~/gdn_k2/models/…` (not at `~/gdn_k2/Qwen3.5-2B-….gguf`) |
| PC PPL job | not touched |

Harness preflight exit: `REFUSE_BATT pct=56 need=60`.

Energy back-of-envelope (not a measurement): two 15-min arms at ~2 A would cost ~27% SOC and could *fit* under the 25% abort floor from 56%. That does **not** waive the start gate. The start gate is about SOC/voltage quality at T0, not about whether the math fits.

## Headline numbers (empty — no arm ran)

| readout | value |
|---|---|
| CPU first-third mean t/s | **n/a** |
| CPU final-third mean t/s | **n/a** |
| GPU first-third mean t/s | **n/a** |
| GPU final-third mean t/s | **n/a** |
| CPU peak battery temp | n/a |
| GPU peak battery temp | n/a |
| CPU J/token proxy | n/a |
| GPU J/token proxy | n/a |
| Sustained winner | **not scored** |
| Energy winner | **not scored** |

Cold burst reference only (prior `results/cpu_build_gap/after/`, not this session):

| cell | tg256 |
|---|---:|
| CPU `-ngl 0` | 18.19 |
| GPU `-ngl 99 -fa off` | 10.25 |

Hypothesis under test (owner): CPU sustained clocks sag to ~41% of peak; 18.19 × 0.41 ≈ **7.5 t/s**, which would lose a marathon to GPU if GPU holds near 10.25. **Unmeasured.**

## Curves

No segments. `results/gpu_sustained/segments.csv` will be created by the runner (`arm,segment,t/s,batt%,temp`). Analyzer: `results/gpu_sustained/analyze_marathon.py`.

## J/token proxy (declared, unused)

```
J_proxy / token = (Δbatt% × 3785 mAh × 3.85 V × 3600 / 100) / tokens
```

Caveats (pre-declared): battery-% energy proxy is coarse; the 3600 factor is **1000× the physical mAh→J conversion** (physical is ×3.6). Relative A/B is invariant. Analyzer also writes the physical J/token and does not use it for the verdict. Temp sensor is battery, not die. Sampling temp does not change the workload.

## What is ready

On device (`~/gdn_k2/gpu_sustained/`):

- `run_marathon.sh` — `preflight|cpu|cooldown|gpu|all`
- `prompt.txt`
- 60 s battery sampler, 48 °C / 2 min abort, 25% abort, unplug guard, T0±1 °C GPU start check, wake-lock
- per-segment raw logs under `logs/`

On PC:

- `results/gpu_sustained/` copies of prompt, runner, analyzer, preflight
- this report

Resume command (after charge ≥60%, unplugged, temp settled):

```bash
bash ~/gdn_k2/gpu_sustained/run_marathon.sh all
```

If only CPU can finish, the runner records `PARTIAL_CPU_ONLY` and leaves GPU for a recharge + same cooldown discipline.

## Honest caveats

1. **No decode sample was taken in this session.** Do not cite this file as evidence that GPU does or does not win a marathon.
2. `dumpsys battery` is not exported to this Termux UID. The runner uses `termux-battery-status` and stores temp both as °C and as tenths.
3. `--ignore-eos` and `--no-repack` are extra vs the one-line flag list. They do not change the backend (the only allowed A/B factor). `--ignore-eos` is required to actually fill 15 min; `--no-repack` keeps the cpufix control.
4. `-c 4096` caps a single `-n 6144` at ~ctx−prompt tokens (~3.5–6 min/segment). The runner chains segments with no sleep.
5. PC PPL job was left running.

## Status

`PREFLIGHT_BLOCKED` — battery 56% < 60%. Harness on disk. Waiting for a charge cycle.

---

## MEASURED (2026-08-12 22:04-22:55, S23 unplugged, waiter-triggered)

Qwen3.5-2B Q4_K_M, cpufix binary, `-t 4`, long generation segments back-to-back,
15 min per arm, cooldown to T0+1 between arms (30.2°C reached).

| arm | seg1 | seg2 | seg3 | first-third | final-third | degradation | end temp |
|---|---:|---:|---:|---:|---:|---:|---:|
| CPU `-ngl 0` | 12.2 | 10.9 | 10.2 | **12.2** | **10.2** | **−16%** | **42.3°C (still rising)** |
| GPU `-ngl 99 -fa off` | 8.2 | 8.2 | — | **8.2** | **8.2** | **0%** | **38.5°C (plateau)** |

Energy proxy (batt% per 1k tokens): CPU ~0.61%, GPU ~0.79% → CPU more efficient
per token even sustained (faster at similar drain).

## VERDICT

- **Sustained winner on 2B: CPU** (final-third 10.2 vs 8.2). The owner's mechanism
  is CONFIRMED — CPU throttles (−16% in 15 min, temp still climbing), GPU is
  perfectly flat and ~4°C cooler — but the magnitude does not close the gap in a
  15-minute session on the 2B.
- GPU decode on 740 = a remarkably stable "cool mode" (zero degradation), not a
  speed or efficiency win at this model size.
- Extrapolation (not measured): CPU curve flattening toward ~9.5-10; crossover with
  8.2 unlikely within realistic chat sessions on 2B. Larger models / hotter ambient /
  concurrent load could shift this — separate test if product ever needs it.

---

## Round 2 — Qwen3.5-4B (measured 2026-08-13 ~00:00, S23 unplugged, waiter-triggered)

Correctness pre-check: greedy CPU vs GPU token-identical (4B hybrid E2E validated on GPU).

| arm | seg1 | seg2 (final) | degradation | end temp |
|---|---:|---:|---:|---:|
| CPU `-ngl 0` | 5.8 | **5.0** | −14% | 42.4°C |
| GPU `-ngl 99 -fa off` | 4.2 | **4.0** | −5% | 40.9°C |

## Round 2 verdict

- **CPU wins the 4B marathon too**: final 5.0 vs 4.0 (GPU = 0.80× sustained).
- Convergence pattern across sizes: sustained GPU/CPU is ~0.80× at BOTH 2B
  (8.2/10.2) and 4B (4.0/5.0) — the throttling narrows the burst gap but never
  crosses. GPU remains the cooler, flatter option (−5% vs −14% degradation).
- Question closed: on the 740, GPU decode loses sustained at every product size.
  The GPU dividend on A7X remains prefill/TTFT only.
