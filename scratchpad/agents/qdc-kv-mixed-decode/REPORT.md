# QDC: does a mixed KV pair (K q8_0 / V q4_0) pay a decode penalty on a Snapdragon CPU?

Date 2026-10-02. Session 861839 (account aspis), cap 40 min. All numbers from `raw/`.

## Verdict

**No. On the Snapdragon 8 Gen 3 CPU with FA on, mixed q8_0/q4_0 decodes within noise of uniform q8_0/q8_0 and f16/f16 at depth 0 and 2048. The Metal cliff (-70%) does not exist on the CPU path.**

| depth | A q8_0/q4_0 | B q8_0/q8_0 | C f16/f16 | A vs B | A vs C | >10%? |
|---|---|---|---|---|---|---|
| 0 (reps 2-3, pooled over 2 rounds) | 27.81 | 28.97 | 28.82 | -4.0% | -3.5% | no (noise) |
| 2048 (all reps, pooled over 2 rounds) | 23.15 | 22.98 | 21.29 | +0.7% | +8.7% | no |

Round by round, depth 0: A-vs-B is +1.4% in round 1 and -9.4% in round 2. The round-2 gap comes from one slow rep of A (24.5; the other 27.6), so it is noise on a board that was 8 C warmer. Depth 2048 has sd of about 0.5 tok/s per cell and A is never slower than B by more than 1.3%.

Not answered: the deep point (8192) - see "Deep pair" below.

## Device and setup

- **QRD8650 (Snapdragon 8 Gen 3, SM8650)**, Android 14+ "pineapple". The S23's 8 Gen 2 boards (QRD8550, HDK8550) were Unavailable. Not the same SoC: 1x X4 + 5x A720 + 2x A520 here, vs 1x X3 + 4 mid cores + 3x A510 on the S23 - re-measure on the S23 if the decision is close.
- Cores (midr): cpu0-1 A520 (0xd80), cpu2-6 A720 (0xd81), cpu7 X4 (0xd82). **Pinning: `taskset f0` = cpu4-7 (3x A720 + X4), `-t 4`**, identical in every cell.
- Binary: f86fcfa `llama-bench` (sha256 e388891b... verified on Mac and on the device), model sha256 a247afd6... verified on the device. `libomp.so` from `~/kalsa-qdc/cpu-tuned-kit` (NDK, same hash as the other kits).
- CPU features (`/proc/cpuinfo`): asimddp (dotprod), i8mm, bf16. The load log shows `CPU_REPACK model buffer 1511 MiB` and `repack ... q4_0_4x8`, i.e. the i8mm repack path is active. **Caveat: llama-bench does not print a `system_info` line, so I could not quote `DOTPROD = 1 | MATMUL_INT8 = 1` from the binary itself**; the evidence is the CPU flags plus the 4x8 repack (see `raw/probe_header_lines.txt`). The binary is built with `-march=armv8.2-a+dotprod+i8mm` per the brief, not re-verified here.
- Skin sensor: `thermal_zone58` = `skin-msm-therm`. Battery temperature stayed 25.0 C (stubbed on the rack, as noted before) so it is useless.
- Flags: `-p 0 -n 128 -d 0,2048 -r 3 -fa 1 -o json`. Driver: `raw/run.sh`, `raw/run2.sh`.

## Cells (tg128, tok/s, mean ± sd over 3 reps)

Skin before = `thermal_zone58` just before the cell, after the cool-down wait (cap 240 s in round 1, 120 s in round 2). Round-1 start = 28.9 C.

| cell | ctk/ctv | fa | depth | tok/s mean ± sd | reps | skin before (C) | cool wait (s) |
|---|---|---|---|---|---|---|---|
| r1 A | q8_0/q4_0 | 1 | 0 | 29.80 ± 0.46 | 30.32 29.65 29.42 | 28.9 | 0 |
| r1 A | q8_0/q4_0 | 1 | 2048 | 24.03 ± 0.23 | 24.26 24.03 23.80 | 28.9 | 0 |
| r1 B | q8_0/q8_0 | 1 | 0 | 22.58 ± 11.35 | **9.47** 29.36 28.90 | 33.5 | 75 |
| r1 B | q8_0/q8_0 | 1 | 2048 | 23.39 ± 0.50 | 23.92 23.32 22.92 | 33.5 | 75 |
| r1 C | f16/f16 | 1 | 0 | 27.46 ± 3.24 | **23.72** 29.51 29.13 | 33.7 | 225 |
| r1 C | f16/f16 | 1 | 2048 | 21.77 ± 0.36 | 22.15 21.73 21.43 | 33.7 | 225 |
| r1 D | q4_0/q4_0 | 1 | 0 | 19.54 ± 10.38 | **8.23** 21.74 28.64 | 34.4 | 240 |
| r1 D | q4_0/q4_0 | 1 | 2048 | 22.86 ± 0.49 | 23.39 22.75 22.43 | 34.4 | 240 |
| r2 A | q8_0/q4_0 | 1 | 0 | 20.34 ± 10.08 | **8.84** 24.53 27.64 | 36.7 | 120 |
| r2 A | q8_0/q4_0 | 1 | 2048 | 22.28 ± 0.52 | 22.86 22.11 21.85 | 36.7 | 120 |
| r2 B | q8_0/q8_0 | 1 | 0 | 28.35 ± 0.86 | 27.43 29.15 28.48 | 38.5 | 120 |
| r2 B | q8_0/q8_0 | 1 | 2048 | 22.58 ± 0.54 | 23.18 22.44 22.12 | 38.5 | 120 |
| r2 C | f16/f16 | 1 | 0 | 26.19 ± 3.69 | **21.96** 28.66 27.96 | 39.5 | 120 |
| r2 C | f16/f16 | 1 | 2048 | 20.80 ± 0.51 | 21.36 20.67 20.38 | 39.5 | 120 |
| r2 D | q4_0/q4_0 | 1 | 0 | 23.85 ± 7.80 | **14.86** 28.73 27.97 | 40.2 | 120 |
| r2 D | q4_0/q4_0 | 1 | 2048 | 22.05 ± 0.51 | 22.61 21.93 21.61 | 40.2 | 120 |
| ctl C | f16/f16 | **0** | 2048 | 22.31 ± 0.41 | 22.74 22.27 21.93 | 41.2 | 0 |
| ctl A | q8_0/q4_0 | 0 | 2048 | **fails** | - | 40.9 | 120 |
| ctl B | q8_0/q8_0 | 0 | 2048 | **fails** | - | 38.7 | 120 |
| deep A | q8_0/q4_0 | 1 | 8192 | 14.04 (n=1) | 14.04 | 42.2 | 0 |
| deep B | q8_0/q8_0 | 1 | 8192 | **lost** | - | 48.1 | 0 |

## Things that are not what they look like

1. **Depth-0 means are polluted by a cold first rep.** In 6 of 8 depth-0 rows the first rep is 8-24 tok/s and the other two are 22-30 (exceptions: r1 A, which ran right after the warm-up probe, and r2 B). The depth-0 rows run first in each cell, right after a model load plus a cool-down pause (the model is mmap'd and repacked, so the first rep pays page-in). I compare depth 0 on reps 2-3 only and show the raw reps above. Depth 2048 runs after depth 0 in the same process and is clean (sd about 0.5).
2. **The thermal gate did not hold.** Round 2 started from skin 36.7 C and rose to 40.2 C; the +5 C gate (> 33.9 C) hit its 120 s cap every time because the board does not cool in that time. Round 2 is about 5% slower than round 1 across the board (e.g. depth 2048: A 24.0 -> 22.3, B 23.4 -> 22.6), which fits throttling. The interleaving A B C D is what protects the comparison; the cross-round numbers are not comparable.
3. **FA off cannot be measured for A or B**: with `-fa 0` llama.cpp refuses to create a context with a quantized V cache (`llama_bench: error: failed to create context with model`, rc=1, in `raw/ctl_*_fa0_fa0.err`). So **a quantized V cache requires FA on this engine**; the FA-off control is moot for the mixed pair. The only FA-off number is f16/f16 at depth 2048: 22.31 vs 21.77 / 20.80 with FA on (+2.5% / +7%), i.e. FA on CPU is about neutral, so FA itself is not an issue.
4. **Quantized V is not slower; if anything it is the cheapest at depth.** Pooled depth 2048: A 23.15, B 22.98, D 22.45, C (f16) 21.29. f16/f16 is the slowest at depth 2048, by about 8% vs A, presumably more KV bytes per token.

## Deep pair (depth 8192, `-n 64 -r 1`): NOT answered

Run after the main cells with the session nearly out of time (about 6 min left, not extended as instructed). deep A gave **14.04 tok/s** at depth 8192 (took 208 s; skin 42 -> 48 C, so thermally contaminated). deep B was still running when the 40-minute cap expired and is lost, so there is **no A-vs-B comparison at depth**. The only usable statement is that A falls from 23 (depth 2048) to 14 (depth 8192) on a hot board; without B we cannot say how much of that is mixed-type vs plain KV growth. Note the Metal cliff the brief cites is at depth 15744; the CPU is not tested there. Worth one re-run on a cold board with A B interleaved at 8192 (and ideally 16k) if the 2048 result is not enough to decide.

## Anything odd

- First `pkill -f` to stop the round-1 driver killed my own adb shell (the pattern is in its command line); round 1 was complete (A-D), round 2 was re-launched with `raw/run2.sh` using the round-1 start skin (28852 m C) as reference and a 120 s cool-down cap.
- r1_D.json was briefly seen truncated (pulled during write); the final pull is complete.
- The portal page stopped repainting near the end, so End Session could not be confirmed; the session expired on its own at its 40-minute cap (device dropped at 19:10:34 EDT, started 18:30:34). deep B was killed by that expiry.
