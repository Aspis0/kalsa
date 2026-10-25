# Xiaomi lane-only memory cell — 2026-10-15 17:45-17:51 EDT

- Device: Xiaomi 14 (23127PN0CG, SM8650, v75, Adreno 750), owner's daily driver, UNPLUGGED, battery 97 %, battery temp 33.4-35.6 C (watchdog 43.0 never fired).
- Bench: governor-bench 50f33830 (kalsa-artifacts-b11514), skel libggml-htp-v75.so 938e432b, model ship.gguf a247afd6 (LFM2.5 2.6B Q4_0). Cell-74 env (HOSTBUF=1, HOSTBUF_REPACK=1, MBUF=832, OFFLOAD_MIN_BATCH=1, ADMIT_OPS=7), `--arm A -t 5 -r 1 --gen 128 -v`.
- Sampling: 1 Hz MemAvailable, VmRSS, smaps_rollup Pss. dmabuf sysfs is not readable without root.
- **Limit:** governor-bench has no `-c`; n_ctx = 2048, not the app's 16384. KV here 32 MiB (HTP0).

## Buffers (identical in both arms)
HTP0-TILE32 1306.12 MiB, HTP0-HOST-W 219.75 MiB, HTP0 KV 32.00, HTP0 compute 136.00, HTP0-HOST compute 258.00, output 0.49. Sum 1952.4 MiB. `shared weights: TILE32 1369571328 HOST 230420480 CPU 0`.

## Arms
| arm | dev | exit | MemAvailable start → plateau → after exit (MiB) | drop | released at exit | max RSS / PSS MiB |
|---|---|---|---|---|---|---|
| A lane-only | HTP0 | 0 | 4403 → ~3365 → 5466 | ~1040 | ~2100 | 130 / 109 |
| B | HTP0,GPUOpenCL, no TILE32 waiver | **134 (GGML_ASSERT view_src->data != NULL, ggml-backend.cpp:2275)** | - | - | - | - |
| B2 J(1) | HTP0,GPUOpenCL + GGML_OPENCL_TILE32_UNMEASURED=1 | 0 | 5712 → ~2845 → 4618 | ~2870 | ~1770 (1 s after exit, likely partial) | 143 / 121 |

B2: GPU leg imports the HOST-W buffer (one copy), OpenCL compute 0.50 MiB, HOST self-check PASS.

## Reading
- MemAvailable on the owner's phone is confounded by LMK/reclaim (A ends 1.06 GB above its start). The honest lane-only number is the buffer sum + RSS ≈ **2070-2100 MiB** (A's release at exit agrees: ~2100).
- J(1) costs ≈ **2870 MiB** at the same ctx: the GPU leg adds ≈ 770 MiB ≈ the 800 MiB Adreno fixed term of lanePrice (q44 identity of the 800 confirmed on a second device/model).
- App formula today (lane, with +219): 3385.06. Without the compute+kv duplicate (385): J(1) 3000 vs measured 2870 (over by ~130, safe); lane-only without the 800 GPU term: 2200 vs measured ~2100 (over by ~100, safe) — but measured at ctx 2048; at the app's ctx the HTP KV grows (app KV types), so the 300 MiB margin is what covers it.
- With the owner's ≥300 MiB margin at 3004.93 MiB available: J(1) 3000+300 → NoFit; lane-only 2200+300 = 2500 → Fit with ~505 MiB spare.
- B (no waiver) is a crash, not a refusal: on an Adreno without the TILE32 gate token, a {HTP0,GPUOpenCL} load asserts in the scheduler. The app must never request J(1) where the TILE32 leg is unavailable.
