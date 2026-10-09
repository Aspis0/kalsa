# Cell #76 — per-leg heat and load step on the real Xiaomi 14 (SM8650, Adreno 750, v75)

- **Device:** Xiaomi 14 (23127PN0CG), the owner's daily driver, lent for 15 minutes.
- **Conditions:** UNPLUGGED. Battery 75 % → 73 %. Screen awake throughout.
- **Purpose:** the values the SM8650 legs-table row still lacked after cell #75:
  - the CPU skin heat per 1k tokens;
  - every leg's own zone rise under load (the load step).

## Setup

- **Binaries:** governor-bench 50f33830 (engine 23b2a44d7), skel v75 938e432b, model sha a247afd6. Same as cells #74/#75; hashes were checked on the phone.
- **Script:** `run-xiaomi-legheat.sh`.
  - Arm L with `--legs <leg>` and `--hop 32`, in the order cpu (1024 tokens), npu (512), gpu (512).
  - There is no cool wait between arms; the 15-minute window did not allow one.
  - The sampler reads every ~2 s:
    - skin, from the HAL current section;
    - the maximum of the 6 `nsp*` zones, the 8 `gpuss*` zones and the 15 `cpu-*` zones.
- **Run:** 09:52:27–09:55:19 EDT. Every arm exited 0, and the skin stop at 43 C never fired.
- **Evidence:** in `raw/`:
  - `legheat_report.grep` and `legheat_out.grep`;
  - `legheat_{cpu,npu,gpu}.csv`;
  - `legheat_{cpu,npu,gpu}_log.grep`.
- The device directory was removed after the pull. File sizes were checked against the phone.

## Speed

| leg | tokens | tok/s |
|---|---|---|
| cpu | 1023 | 14.71 |
| npu | 511 | 16.52 |
| gpu | 511 | 21.26 |

## Zone means while each leg runs

The window runs from 15 s after the arm starts (past the model load) to the end of decode. Values are in C.

| arm (window) | skin | nsp max | gpu max | cpu max |
|---|---|---|---|---|
| cpu (61 s, n=35) | 37.4 | 59.8 | 64.2 | **83.7** |
| npu (22 s, n=13) | 39.7 | **64.8** | 53.6 | 53.2 |
| gpu (14 s, n=9) | 39.7 | 58.9 | **69.4** | 62.2 |

**Load step.** This is the S23 round-3 method (archived PLAN, "Round 3, arms 2-3"): the own zone loaded, minus the mean of the same zone in the other two arms.

| leg | loaded | idle reference | load step |
|---|---|---|---|
| NSP | 64.8 | 59.4 | **≈ 5** |
| GPU | 69.4 | 58.9 | **≈ 11** |
| CPU | 83.7 | 57.7 | **≈ 26** |

## Heat per token (skin C per 1k tokens, the S23 row's unit)

| leg | value | source |
|---|---|---|
| CPU | **≈ 7.3** | this cell: skin 32.9 → 40.3 over 1023 tokens, from a start comparable to cell #75 |
| NPU | **≈ 1.1** | cell #75 |
| GPU | **≈ 3.2** | cell #75 |

The S23 row has 2.8 / 3.2 / 4.7 (npu/gpu/cpu). The order is the same, but the spread on SM8650 is much wider.

## Caveats

- **The NPU and GPU windows are short (22 s and 14 s).** Their zones had not reached a plateau, so those two load steps are lower bounds.
- **No cool wait between arms.** The npu and gpu arms started with skin at ~40 C, after the CPU arm. The CPU heated the NSP and GPU zones, which inflates their idle references.
- **One run per arm.** The values are indicative, which is what cell #75 found too.

## Reading for the SM8650 row

- **Under HEAT_RANK the NPU is the cheapest leg on this phone (1.1 vs 3.2 vs 7.3).** Its zone rises only ~5 C under load. So the NPU stays "fit", and the rule will keep decode on the NPU, at ~15–16.5 tok/s.
- **The GPU (~21 tok/s) gets used only when the NSP headroom falls below guard + load step.** Cell #75 did not reach that point in 10 minutes.
- **The trade-off this choice makes:** on SM8650 the rule buys heat, not speed. The GPU is the faster leg here and costs about 3× the skin heat per token.
- **The CPU is the worst leg on both axes:** the slowest, and about 7× the NPU's heat per token.
