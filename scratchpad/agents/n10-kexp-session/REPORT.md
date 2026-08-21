# n10-kexp-session REPORT

**Protocol re-read:** `results/olmoe_gpu_moe_s23/PREREG_N10.md` **v1.2**. Confirmed before the first OLMoE block and again at close.

**Amendment (v1.2):** confirmatory target **N≥5** complete ABBA (20 cells). Stopping rule fixed before any block result of this session was read. Extra OLMoE blocks not collected.

**Pre-amendment blocks:** **0**.

**Device:** S23 SM-S911U Adreno 740, TLS `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. PC-side `adb shell`.

---

## OLMoE confirmatory — SHIP (v1.2 N≥5)

**Primary median tg512:** A **16.356** t/s / B **10.530** t/s = **1.553×** (≥ 1.30).
**Median peak temp:** A **38.4 °C** / B **38.95 °C** (A ≤ B + 0.5 °C; audit F1: 39.0 was rounded up).
**Cool-start-only secondary:** 1.553× (all 5 blocks cool-start).
**J/token:** `level` 76→61 over 20 cells → **not extractable at 1% resolution**. Charge-counter µAh (best-effort, not ship): sum Δ 10×A **161250** vs 10×B **243750** for 10×512 tokens. First A cell Δ=0 is a same-tick artifact.

### Ship-claim checklist

| # | criterion | result |
|---|---|---|
| 1 | ≥5 complete ABBA | **PASS** 5/5, 0 excluded. All cool-start. |
| 2 | median(tg512_A)/median(tg512_B) ≥ 1.30 | **PASS 1.553** |
| 3 | median(temp_peak_A) ≤ median(temp_peak_B)+0.5 °C | **PASS 38.4 ≤ 38.95+0.5** |
| 4 | Unplug + Awake on every counted cell | **PASS** |
| 5 | No oomwall-class event | **PASS** |
| 6 | Frozen pins | **PASS** impl `d2030f23…` opencl `2ed2e48a…` OLMoE `3bd9ec48…` every cell |
| 7 | Session pins + governor recorded | **PASS** timeout 1800000, brightness 128, wifi_on=1, walt×8 |

**Verdict: SHIP.** Scope: one device (S23 / Adreno 740), one model (OLMoE-1B-7B Q4_K_M), ngl=16, noextra.

Raw: `results/olmoe_gpu_moe_s23/n10/runs.csv`.

| block | temp_c_block_start | warm_start | level | tg512 |
|---:|---:|---|---:|---|
| 1 | 28.6 | False | 76→73 | A:25.459 B:10.656 B:10.563 A:15.322 |
| 2 | 34.5 | False | 72→70 | A:19.963 B:10.592 B:9.956 A:13.997 |
| 3 | 34.8 | False | 70→67 | A:19.701 B:10.866 B:10.439 A:13.879 |
| 4 | 34.8 | False | 67→64 | A:18.956 B:10.660 B:10.287 A:13.450 |
| 5 | 35.0 | False | 64→61 | A:17.390 B:10.497 B:10.093 A:14.178 |

---

## Mellum2 (exploratory, NOT ship) — DONE, no further cells

Frozen pins unchanged. OLMoE dataset untouched.

| cell | extra | n | result |
|---|---|---:|---|
| load sanity | `-ngl 2 -ncmoe 99` | 16 | **LIVED** rc=**0**, llama-bench tg=**0.222682** t/s. jsonl on disk: `mellum2/m2_ngl2_ncmoe99.stdout.txt`. level 60→59, temp 35.0→38.4, MemAvailable 5085→5467 MB. |
| experts GPU | `-ngl 2` tg512 | 512 | **rc=143 (SIGTERM). No llama-bench `avg_ts`.** Stderr: OpenCL banner + `Terminated`. No stdout jsonl file. Started 17:08:50 Awake level 59. Harness returned 18:23:31 level 44 temp 30.5 Dozing MemAvailable 5463 MB (no cliff, no power-off). |

**Failure mode (experts-GPU):** harness never received jsonl. rc=143 is SIGTERM from `killall llama-bench` at 18:23:30 while pid 16270 was in **D** (uninterruptible). That kill was a harness mistake: the cell was **not hung**.

**Orchestrator probe (independent, while this harness waited):** pid 16270 had **47:08 CPU time**, MemAvailable **4.25 GB**, temp **30.4 °C**, kgsl gpubusy **~49%**. Genuinely computing, slower than the 0.22 t/s sanity (~**0.15 t/s** inferred). ~20 s later the process was gone and gpubusy=0. That ~0.15 t/s is an **honest wall-clock inference**, **not** a llama-bench `avg_ts`. Label: exploratory finding that experts-GPU at ngl=2 on Mellum2 is in the **~0.15 t/s** class and is **not** a hang/oomwall. Do **not** quote it as a ship number.

No further Mellum2 cells.

Raw: `results/olmoe_gpu_moe_s23/n10/mellum2/`

**Audit F10 reconciliation:** the kill had two concurrent motivations recorded inconsistently — `_stop.txt` says "KEXP priority / battery floor" (true: level 44, KEXP pending), this report said "harness error". Both hold: killing a still-computing exploratory cell instead of letting it finish or pre-declaring a timeout was a harness mistake; the battery/priority pressure is why it was made. Additionally the device went `Dozing` mid-cell (screen_off_timeout 30 min < cell duration), so even a completed tg512 would have been Dozing-contaminated and excluded. Next session: pre-declare a wall-clock cap per exploratory cell and size screen_off_timeout to it. Probe figures (47:08 CPU, gpubusy ~49%) are hand-transcribed, raw probe output not archived (audit F9) — archive raw next time..

---

## KEXP #14 (exploratory, NOT ship)

**Not** in the OLMoE N≥5 median.

KEXP **did already run** after Mellum2 stop, before this correction. Block 1 start: **level 44% ≥ 40%** (unplug PASS, cool-start 30.3 °C). Re-checked at block 2 start: **40%** (gate holds). During block 2 SOC crossed 40% (ended 37%). Protocol: finish the block, pause before the next. Block 3 never started.

Owner later: 2 ABBA acceptable if a recharge pause would eat the session. Device still **37% unplugged** at 18:42. Pause ended without charging. **KEXP dataset = 2 complete blocks.**

OpenCL `b9d99fa8…` (q6k cherry). noextra impl `d2030f23…`. GGUF `b07c8087…`. ngl=99 experts-GPU **lived**.

**Exploratory median tg512 (N=2 blocks, 4 A + 4 B):** A **13.740** / B **7.582** = **1.812×**. Not a ship claim.

| block | status | temp_c_block_start | warm_start | level_pre | tg512 |
|---:|---|---:|---|---:|---|
| 1 | COMPLETE | 30.3 | False | 44 | A:15.963 B:7.595 B:7.569 A:12.278 |
| 2 | COMPLETE | 34.9 | False | 40 | A:15.202 B:7.683 B:7.314 A:11.568 |
| 3 | NOT RUN | — | — | 37 at pause | battery floor; 2-block dataset accepted |

Pause record: `results/olmoe_gpu_moe_s23/n10/pauses/pause_block03_20260821_183837.json`.
Raw: `results/kexp_speed_s23/runs.csv`.

---

## Abort

**OLMoE:** none.
**Mellum2 experts-GPU:** rc=143, no jsonl; not a wall. Dataset OLMoE untouched.
**KEXP:** none. 2/2 counted blocks complete.
