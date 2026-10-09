# Cell #74 — one-copy legs on the real Xiaomi 14 (SM8650, Adreno 750, v75) with the merged engine

- **Device:** Xiaomi 14 (23127PN0CG, SM8650), the owner's daily driver, lent for 20 minutes.
- **Conditions:** UNPLUGGED, battery 87 %. Correctness cell; the tok/s are indicative.
- **Evidence:** `raw/legs_report.grep`.

## Setup

- **Engine:** 23b2a44d7. It is upstream b11514 merged into e01a61cee, which includes the GPU-750 `l4_y8` gate, plus the audit fixes. The later 2e723bd9d only changes the Hexagon setter, and the bench does not use it.
- **Bench:** governor-bench 50f33830, a static build. Release skel v75 938e432b. The hashes on the phone match the Mac copies.
- **Model:** `/data/local/tmp/govhtp-xiaomi/model/ship.gguf`, sha a247afd6.
- **Script:** `run-legs.sh` = cell #73's script (battery watchdog 43.0 C, screen woken before every arm) with `R=/data/local/tmp/kalsa74`. The device directory was removed after the pull.
- **Run:** 08:49:29-09:01:52 EDT. Battery 37.1 C at the start, 38.2 C at most; the watchdog never fired.

## Result (every arm exit 0, PASS, no ABORT/refusal/error lines)

| arm | KL mean / max | tok/s (indicative) |
|---|---|---|
| L (hops every 32 over 256) | 0.000017 / 0.000389 | cpu 13.6, gpu 21.6, npu 15.4 |
| L-npu | 0.000022 / 0.000434 | 15.4 |
| L-gpu = L-gpu2 = V-gpu | 0.000010 / 0.000431 | 22.2 / 22.2 |
| L-cpu | 0.000012 / 0.000199 | 13.8 |
| A-gpu | 0.000012 / 0.000510 | - |
| A-j1 | 0.000022 / 0.000441 | - |
| E5 (4000 v4 GEMV calls) | worst 2.218e-05 x RMS | - |

## Reading

**The real Xiaomi's GPU leg is fixed.** On the pre-fix engine this leg failed KL on this phone, wrong and nondeterministic, which is what led to cells #67/#70. It now gives the same deterministic KL as QDC #71/#72: identical across L-gpu, L-gpu2 and V-gpu. The KL values match the QDC SM8650 run of the same engine (#72) digit for digit.

With this cell, every one-copy leg is correct on the merged engine on both real phones (S23 #73, Xiaomi #74) and on three QDC SoCs (#72).

On this phone, plugged off and warm, the GPU decode (22 tok/s) is faster than the NPU (15 tok/s). On the S23 the NPU is the fastest leg.
