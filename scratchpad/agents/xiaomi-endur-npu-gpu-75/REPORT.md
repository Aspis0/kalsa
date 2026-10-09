# Cell #75 — NPU vs GPU decode endurance on the real Xiaomi 14 (SM8650, Adreno 750, v75)

- **Device:** Xiaomi 14 (23127PN0CG, SM8650), the owner's daily driver, lent for this cell.
- **Conditions:** UNPLUGGED. Battery 83 % at the start, 76 % at the end. Screen awake and keyguard off for the whole run.
- **Question:** how far does each leg get before skin reaches 43 C, and at what speed? The answer feeds the SM8650 row of the binding legs table.

## Setup

- **Engine and bench:** governor-bench 50f33830 (static, engine 23b2a44d7). Release skel v75 938e432b, model sha a247afd6. The same binaries as cell #74.
- **Script:** `run-xiaomi-npu-vs-gpu.sh`.
  - It runs two arms in order, `npu` then `gpu`. Each arm is arm L pinned to one leg, 2048 tokens per run, up to 4 runs.
  - Before each arm it waits for skin ≤ 35 C, for at most 900 s.
  - It stops an arm when skin reaches 43 C.
- **Skin sensor:** the max `mName=skin` value from the "Current temperatures from HAL" section of `dumpsys thermalservice`, sampled every 10 s. The "Cached temperatures" block was ignored: it held a stale 46.7 C while the live value was 31.0 C.
- **Run:** 09:18:57–09:37:26 EDT.
- **Evidence:** in `raw/`:
  - `endur_report.grep`, `endur_out.grep`;
  - `endur_{1_npu,2_gpu}.csv` (skin and battery every 10 s);
  - `endur_{1_npu,2_gpu}_log.grep`.
- The device directory was removed after the pull. File sizes were checked against the phone.

## Result

| | NPU | GPU |
|---|---|---|
| skin at the start | 33.4 C | 35.8 C (after a 360 s cool wait) |
| runs completed | 4 of 4 (8192 tokens, exit 0) | 1 (2048 tokens), then stopped at 43 C |
| tok/s per run | 17.46, 15.40, 15.00, 13.98 | 19.67 |
| skin at the end | 42.2 C, never reached 43 | 43.1 C at 141 s |
| skin rise in the first 100 s | +4.0 C | +6.3 C |
| skin rise per 1k tokens | 8.8 C / 8.2k = **1.07 C** | about 6.5 C / 2.0k = **about 3.2 C** |

How the GPU column was measured:
- The GPU's 2048 tokens took 104 s, and skin was about 42.3 C when they finished.
- The stop came while run 2 was still loading: its log ends at `sched_reserve`, then `Terminated`. So no tokens were generated after the first 2048.

No error, abort or refusal lines were found in either log.

## Reading

**Speed vs heat on SM8650.** On this phone the GPU decodes 13–40 % faster than the NPU. It also heats skin about 3× more per token, and it hit the 43 C stop after one run. The NPU slows as it warms, from 17.5 to 14.0 tok/s, but it ran 8192 tokens in ~10 minutes and stayed under 43 C.

**What this means for the governor:**
- The fastest leg and the coolest leg are not the same one here. On the S23 they are: the NPU is both.
- So a fixed "always NPU" or "always GPU" choice is wrong on one of the two phones.
- On SM8650 the heat-ranked rule should keep the NPU as the base leg and spend the GPU only while there is headroom.

**Caveats:**
- The GPU arm started 2.4 C warmer on skin, and with the battery at 35.9 C instead of 31.3 C. That inflates its per-token rise somewhat.
- This is one run per arm. The per-1k-token rates are indicative, not a calibration.

**Indicative heat per token for an SM8650 row:** NPU ≈ 1.1, GPU ≈ 3.2 (C per 1k tokens, skin). There is no CPU arm in this cell.
