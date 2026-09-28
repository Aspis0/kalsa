# qdc-8elite-onecopy-cost — report

**8 Elite facts only** (QRD8750: SM8750, HTP v79 with HMX, Android 16). These numbers do not transfer
to the S23 (v73, no HMX).

- QDC session **853723** (aspis), board `sa857792`, serial `f3b4a4c5` (same serial as 853216, board name differs).
  Started 15:11:39, ended 15:47:36 EDT on 2026-09-28 (**35m57s**); the portal shows Completed.
- **Minutes**: the QRD8750 card read 678 before and **638** right after End Session, a 40 min hold at the cap.
  The previous two sessions settled from the hold down to actual use later, so this one should settle
  near 36. That still needs a later re-read.
- PREREG `e72cbcbe`, locked before the session, plus **Amendment A1** (in `PREREG.md`), written
  *during* the session after round 1 had been seen. It is disclosed, not pre-registered.
- Engine `c939a135d`, build `build-onecopy-v79b`. The shas are in `PREREG.md` and `artifacts.sha256`, and
  were verified locally and on the device (3/3). The model sha `a247afd6…` and fixture sha `bca6ac9f…` were verified on push.
- 0 crashes, 0 `NO-SUPPORT`/`dsp-error`, and thermal status 0 throughout. The skin peaked at **46.0 °C**, and the watchdog fired 4 times.

## Verdict (pre-registered rule): **UNDECIDED**, the numerics gate failed

The KLD sanity arm uses 2 chunks, `-c 512`, and a base from a CPU run on this device. That base's PPL is 32.3370, identical to the S23 base.

| run | exit | mean KLD | max KLD | same top | PPL(Q) | HTP MUL_MAT | reading `-HOST` |
|---|---|---:|---:|---:|---:|---:|---:|
| k2-flat (two-copy, flat kernel, fusion off) | 0 | **0.019320** ± 0.001549 | 0.4216 | 92.549 % | 35.162 | 1084 | 0 |
| k1-p5 (one-copy, exact S23 P5) | 0 | **0.019336** ± 0.001543 | 0.4188 | 92.549 % | 35.179 | 1080 | 1080 |

- **The gate fails on its absolute bound**: 0.019336 > 0.0035, and same-top is 92.5 % < 95 %.
- **The relative bound passes**: |k1 − k2| = 0.000016 ≤ 0.0005.
- **One-copy adds no error on v79.** The raw path equals the two-copy flat path to within 1e-5 of mean KLD, with an identical top-1 rate and the same matmul count.
- What is off is the **v79 flat HTP path itself**. It sits ~7× further from the CPU than on the S23 (0.0028 there).
- The shipping HMX path (a-hmx) had no KLD arm, so whether today's v79 HTP prefill is also at ~0.019 is **unknown**. That matters more than this spike.

By the rule, b's timing is informational. The informational numbers below leave no ambiguity, though.

## Prefill (llama-bench, `-b 2048 -ub 1024 -fa 1 -t 6`, tok/s, median of reps)

| arm | 512 | 2048 | start skin | status |
|---|---:|---:|---:|---|
| a-hmx: two-copy, HMX (today's v79 HTP path) | **1781.7** (1772.9–1785.5) | **1686.5** (1667.7–1715.0) | 36.4 | valid, P1 |
| a-flat: two-copy, flat kernel (same kernel as one-copy) | **57.8** (57.6–57.9) | **58.8** | 36.8 | valid, P1 |
| b: one-copy P5 | **37.3** (37.27–37.29) | — | 38.3 | valid, A1-b512 |
| b (watchdog-cut row) | 37.3 (37.25–37.28) | — | 40.8 | VOID `watchdog`, informational |
| c: CPU | 216.3 (212.5–220.7) | — | 42.3 | VOID `watchdog`, informational only |

- 2048 for b and c: not measured. P1 was killed by the watchdog, and the A1 re-runs hit the deadline.
- b reproduces across two processes and two start skins (37.26 at 40.8 °C, 37.28 at 38.3 °C), so heat does not move it.

Ratios at 512:

| ratio | value | PREREG band |
|---|---:|---|
| **r_flat** = b / a-flat | **0.645** | MARGINAL (0.50–0.80) |
| **r_cpu** = b / c | **0.17** | NO-GO (< 1.5). Informational: c is a void row |
| **r_hmx** = b / a-hmx | **0.021** | V2 fails: one-copy forfeits **98 %** of today's v79 HTP prefill |

## Decode (A1, tg128, 2 reps, CPU-side)

| arm | tok/s | start skin |
|---|---:|---:|
| d-cpu (CPU repack buffer) | **38.3** (37.7 / 38.9) | 40.1 |
| d-cpu-nr (normal buffer, generic Q4_0 kernel) | **34.6** (33.8 / 35.4) | 39.2 |
| d-host (raw `-HOST` weights, HTP session present) | **22.6** (22.0 / 23.1) | 38.5 |

- **dec = 22.6 / 38.3 = 0.59**: that is NO-GO (< 0.75). Against the no-repack buffer it is 0.65.
- Where d-host ran comes from the source, not from a log. A weight in a host buffer runs on the CPU unless `offload_op` accepts it (`ggml-backend.cpp:969-981`), and that needs batch ≥ 32 (`ggml-hexagon.cpp:6898`).
- **Not measured**: why d-host is 35 % slower than d-cpu-nr, when both use the generic kernel on raw Q4_0 blocks. One candidate is the rpcmem host buffer's CPU read path.

## Memory (model buffer MiB from the load log)

| arm | buffers | total | peak RSS (VmHWM) |
|---|---|---:|---:|
| a-hmx | HTP0 1525.9 + CPU 205.1 | 1730.9 | 315 MiB |
| a-flat | HTP0 1171.5 + CPU_REPACK 354.4 + CPU 205.1 | 1731.0 | 730 MiB |
| **b (one-copy)** | HTP0-HOST 1524.9 + HTP0 1.0 | **1525.9** | 110 MiB |
| d-cpu (= c's config) | CPU_REPACK 1511.2 + CPU 206.1 | 1717.3 | 1825 MiB |
| d-cpu-nr | CPU 1512.2 | 1512.2 | 1621 MiB |
| d-host | HTP0-HOST 1525.9 | 1525.9 | 108 MiB |

- **Saved, derived from separate processes**: the two-copy governor is the HTP model (1731) plus the CPU decode model (1717), 3448 MiB. One-copy is **1526 MiB**, so it saves **~1922 MiB (56 %)**.
- Even in a single HTP process, one-copy is 205 MiB smaller, because the CPU-side `token_embd` duplicate goes away.
- VmHWM does not count the rpcmem/HTP buffers (b shows 110 MiB for a 1.5 GiB model), so RSS is no memory metric for HTP arms. That was expected in the PREREG.

## What it means for the governor

- On the 8 Elite (HMX), one-copy is **not usable as it stands**. The raw path is flat-only, because the DSP refuses raw weights on HMX (`htp/matmul-ops.c:3690`).
- The flat HVX Q4_0 kernel on v79 runs at 58 tok/s even on repacked weights, against 1782 for HMX, and one-copy then loses another 35 % to it.
- One-copy prefill (37 tok/s) is ~6× **slower than the CPU**, and CPU decode over raw blocks loses ~41 %.
- The ~1.9 GiB saving is real, but buying it costs the entire NPU prefill advantage.
- A raw-weight **HMX** path is what one-copy needs to be worth anything on HMX SoCs. Vectorising the flat converter cannot close a 48× gap.

## Unproven / caveats

- The numerics gate failed, so the verdict is UNDECIDED per the rule. The ratios are informational.
- a-hmx KLD was not measured.
- Where the 35 % r_flat loss comes from is not split. Candidates are the converter, and `ffn_down` running the generic CPU kernel on raw blocks (b) vs `CPU_REPACK` (a-flat).
- The d-host decode placement is taken from the source; no dispatch log for d-host was captured.
- The PREREG's round 2 was not run, so every arm is n = 1 process. The 2048 sizes for b and c are missing, and so is valid c prefill.
- A1 decode is tg128 × 2, not tg256 × 3. The A1 arms started warm (38.3–40.1 °C; the 240 s cooldown never reached 38.0 °C).
- **Harness lessons:**
  - On v79 the flat arm alone ran 176 s and pushed the skin from 36.8 to 43.9 °C; b then crossed 45.
  - A soft 60 s gate cannot protect a campaign on this rack, where cooling is ≈ 0.5 °C/min above 38 °C.
  - A `pkill -f 'sh sess.sh'` inside `adb shell` also kills that adb shell, so match the PID instead.

## Files

- `PREREG.md` (with A1), `run.sh`, `sess.sh`, `smp.sh`, `a1.sh`, `analyze.py`, `artifacts.sha256`.
- `raw/out.tgz` (sha `b158f383…`) holds all on-device output: markers, 1 s samples, per-unit `.out`/`.err`/`.rss`, and the verbose KLD and proof logs.
  Reproduce with `mkdir d && tar xzf raw/out.tgz -C d && python3 analyze.py d`.
- `raw/host-steps.tgz` holds the preflight/push/launch/pull logs and `analyze.out`.
- `raw/*.log.gz` hold the configure, build and dependency/`hexagon-nm` checks (the v79 skel lists 2 `raw_q4_0` jobs).
