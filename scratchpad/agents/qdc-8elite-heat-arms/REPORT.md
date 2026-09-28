# qdc-8elite-heat-arms — report

**8 Elite facts only** (QRD8750: SM8750, Adreno 830, HTP v79, Android 16).
They do not transfer to the S23 (Adreno 740 / v73).

- QDC session **852687** (aspis.launcher, board `sa856756`, serial `9aed338b`).
- Started 22:22:08, ended 22:44:20 EDT on 2026-09-27; the portal shows Completed.
- **Billing, corrected 2026-09-28.** Right after End Session the card showed 741 → 671, which looked like 70 billed (the full cap).
  The next morning it read **718**, so the final charge was **23 min**, about the real duration.
  671 was a provisional hold at the cap. The "70 billed" in the first version of this report was wrong.
- Engine f25f0c1c5 kit plus `libggml-htp-v79.so`, as in `PREREG.md` (lab 38575acc).
- Prompt: 962 tokens on the device (`prompt_n=962`). Model sha `a247afd6…`, verified
  on push.
- **No energy data.** The rack reports AC powered, level 100, with stubbed battery
  readings, so skin area is the only heat proxy.

## Result: 15/15 arms OK, 0 VOID, 0 watchdog kills

Median of the reps. Skin area is ∫(skin − skin_start) over [prefill start →
run end + 60 s] for the P arms, and over [run start → end + 60 s] for the D arms.
The individual reps are in brackets.

| arm | n | duration s | skin start °C | skin Δ °C | peak skin °C | **skin area °C·s** | CPU/GPU zone peak °C | NSP peak °C | prefill ms | prefill tok/s | tg tok/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| P-CPU (`-dev none`, t5) | 3 | 5.0 | 32.1 | 1.2 | 33.3 | **52.3** (48/52/67) | 104.6 | 51.3 | 4861 | 197.9 | — |
| P-GPU (Adreno 830) | 3 | 4.6 | 32.7 | 1.2 | 33.8 | **45.5** (43/45/59) | 93.8 | 50.5 | 3317 | 290.0 | — |
| P-NPU (HTP0 v79) | 3 | 1.6 | 33.1 | 0.6 | 33.7 | **21.2** (21/21/23) | 99.6 | 66.4 | 919 | 1046.4 | — |
| D-t6 tg256 | 2 | 7.0 | 34.9 | 1.5 | 36.5 | **66.7** (61/72) | 105.2 | 58.6 | — | — | 38.6 |
| D-t4 tg256 | 2 | 8.0 | 35.4 | 1.5 | 36.9 | **64.5** (63/66) | 105.0 | 58.6 | — | — | 37.0 |
| D-t2 tg256 | 2 | 8.5 | 35.7 | 1.2 | 36.9 | **48.8** (43/54) | 104.8 | 56.3 | — | — | 33.9 |

Per-arm rows: `raw/results.tsv`. Raw logs, samples and markers: `raw/device-out/`.

Proof of backend, checked on every arm:

| arm | proof |
|---|---|
| CPU | model buffers `CPU,CPU_REPACK` only |
| GPU | `ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM` plus an `OpenCL model buffer`. `--list-devices`: `GPUOpenCL: QUALCOMM Adreno(TM) 830` |
| NPU | 484 `HTP0 execute-op MUL_MAT` lines in each verbose proof, a `libggml-htp-v79` reference, and an `HTP0 model buffer` |

## Verdict (pre-registered rules)

1. **The coolest prefill backend per prompt is the NPU, and the margin is material.**
   - NPU skin area is 21.2 °C·s, against 45.5 for the GPU (−53 %, −24 °C·s) and 52.3 for the CPU (−59 %, −31 °C·s).
   - The reps do not overlap: the worst NPU rep (23.5) is below the best GPU rep (42.8).
   - NPU was lowest in every one of the 3 CPU/GPU/NPU triples.
   - It wins by finishing fast: prefill takes 0.92 s against 3.3 s (GPU) and 4.9 s (CPU), and the skin rise is half.
2. **GPU vs CPU cannot be separated at n=3** (reps overlap: 43/45/59 against 48/52/67). The GPU is 13 % lower at the median and 1.5× faster.
3. **Fewer decode threads: t2 meets the "material" rule, t4 does not.**
   - t2 is 27 % below t6 (48.8 against 66.7), and the reps do not overlap (54 < 61).
   - t2 costs 12 % of decode speed (33.9 against 38.6 tok/s).
   - Per token that is 0.19 against 0.26 °C·s/token.
   - t4 is only 3 % below t6.
   - Weak evidence: n=2, the signal is small (Δ 1.1–1.6 °C), and the t2 arms started hotter (see caveats).

## Caveats (read before using the numbers)

- **The cooldown gate never bound.** The board was always ≤ 36.0 °C when an arm
  began: 14 of 15 arms waited 0–1 s, and the last two waited 30 s and 60 s. The skin
  start therefore drifted upward over the session, from 29.7 to 35.9 °C. The fixed
  order puts NPU last in every triple and the D arms after all the P arms, so later arms started warmer.
  - Areas are measured relative to each arm's own start, so this is a baseline shift, not contamination by a still-rising curve.
  - The NPU ranking holds even against the earlier, cooler CPU and GPU arms.
- These are short, single-prompt arms: the skin rise is ≤ 1.6 °C, and the 60 s tail
  dominates the area. They rank the backends per prompt. They do not reproduce the
  S23's SEVERE regime, which came from minutes of app load.
- The CPU zones peak at about 105 °C in every arm that runs CPU work, NPU arms
  included (99.6). The NPU graph still runs host ops, and the 1 s sampler can catch
  one hot core.
- Deviation from the PREREG, disclosed. `analyze.py` also uses the cooldown's final
  HAL skin read (the `C` marker) as a skin sample. Without it, arm 1 had no sample at
  or before `t0`: the sampler started in the same second.
