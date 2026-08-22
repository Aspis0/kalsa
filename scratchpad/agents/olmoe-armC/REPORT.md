# OLMoE arm C -- queue #20 (DECISION CELL, exploratory-registered)

**Not a prereg ship claim.** Full #18 gate discipline. Protocol `armC-exploratory-gates-v1.2`. git HEAD `b8e55a92985d87da5d23a048810564f7c79c2559`.

**HEAD BUILD** currently deployed in `/data/local/tmp/s3oracle` (verified, no rebuild/redeploy): impl `8adc148c...`, opencl `f4325483...`, stub `b2ae0fa6...`. **NOT** the old OLMoE-N5 pin `2ed2e48a` (no longer extant). Arm A is **RE-MEASURED in this session**. Never compare C against the old n10 A numbers.

Arms: A `-ngl 16`, C `-ngl 0`. BOTH `-nr -fa off -t 4`. tg512 `-p 0 -n 512 -r 1 -o jsonl`. Palindrome A,C,C,A x 3. Model OLMoE-1B-7B Q4_K_M sha `3bd9ec48...`. Battery floor 40% = **SESSION END** (no recharge pause).

## Running medians (complete blocks only; full precision; display 3 dp; no pre-rounding)

| set | nA | nC | med A | med C | A/C | med peakT A | med peakT C | max peakT A | max peakT C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| all complete (primary) | 6 | 6 | 20.034 | 27.685 | 0.724 | 35.850 | 36.300 | 38.500 | 38.500 |
| cool-start only (secondary) | 6 | 6 | 20.034 | 27.685 | 0.724 |  |  |  |  |

Per-block mean(A)/mean(C) robustness: 0.809, 0.764, 0.606

**Dossier framing (exploratory, not ship):** GPU = cool mode (pure CPU C beats full-GPU A; same pattern as KEXP A/C refute)

A-decay is pre-declared: second-A cells are **never** dropped from complete blocks.

## Blocks

| block | status | temp_c_block_start | warm_start | level pre->post | tg512 (*excluded) | A-decay | mean(A)/mean(C) | governor |
|---:|---|---:|---|---|---|---:|---:|---|
| 1 | COMPLETE | 25.8 | False | 62->60 | A:25.711266999999999 C:29.772033 C:29.638660000000002 A:22.367788999999998 | 13.004 | 0.809 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |
| 2 | COMPLETE | 33.4 | False | 60->57 | A:21.912662999999998 C:27.955075000000001 C:24.388998000000001 A:18.076657000000001 | 17.506 | 0.764 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |
| 3 | COMPLETE | 34.5 | False | 57->55 | A:18.154731000000002 C:27.415866000000001 C:25.751335000000001 A:14.068153000000001 | 22.510 | 0.606 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |

## Flags

- protocol=armC-exploratory-gates-v1.2
- git_head=b8e55a92985d87da5d23a048810564f7c79c2559
- complete_blocks=3/3
- cool_start_complete=3
- C_over_cap=0
- HEAD_BUILD=impl 8adc148c / opencl f4325483 / stub b2ae0fa6 (NOT old OLMoE-N5 pin 2ed2e48a)
- A is RE-MEASURED in-session; do not compare C to n10 session A

Raw: `results/olmoe_gpu_moe_s23/armC/runs.csv`  probes: `results/olmoe_gpu_moe_s23/armC/probes/`  cells: `results/olmoe_gpu_moe_s23/armC/cells/`

## Session close (2026-08-22)

**Bag:** 3/3 complete palindromes A,C,C,A. 12/12 cells counted. 0 exclusions. 0 over-cap. 3/3 cool-start. All `wake_pre`/`wake_post` = Awake. All `no_repack=true`. jsonl `build_commit=7686ca6fc` (HEAD). Independent csv=jsonl check: 0 mismatches (`results/olmoe_gpu_moe_s23/armC/_verify_medians.txt`). Full-precision medians: A **20.033697** / C **27.6854705** / A/C **0.7236177** (display 20.034 / 27.685 / 0.724).

**Decision (exploratory, not a ship claim):** C beats A in every cell of every block. Framing = **GPU = cool mode**, not "GPU default candidate". Same qualitative result as KEXP A/C (0.812). OLMoE A/C is **0.724**. GPU is the slower arm; median peakT A 35.85 vs C 36.30 (A cooler by 0.45 °C). A intra-block decay 13.0 / 17.5 / 22.5 %. Per-block mean(A)/mean(C) **0.809 / 0.764 / 0.606** (thermal compression of A, not a C collapse).

**Do not mix with n10 A.** n10 A was a different opencl pin (`2ed2e48a`) and a different arm-B comparison. This session's A is the HEAD-build re-measure.

### Battery ledger (unplugged throughout)

| block | level pre→post | charge_counter first→last cell | temp start |
|---:|---|---|---:|
| 1 | 62→60 | 2351250→2276250 | 25.8 |
| 2 | 60→57 | 2276250→2182500 | 33.4 |
| 3 | 57→55 | 2156250→2088750 | 34.5 |

Session: level **62→55** (−7 pts). Charge counter **2351250→2088750** (Δ 262500). No recharge pause (forbidden this session). Floor 40% not approached.

---

## ERRATUM (owner arbitration post-audit, 2026-08-22)

Audit F5 (CONFIRMED): the "GPU = cool mode" framing is OVERREACH for this
dataset. Median peak gap A vs C is only 0.45 C and the MAX peaks are
identical (38.5 = 38.5). Binding wording for OLMoE: **"full-GPU is slower
at near-thermal-parity"**. The cool-mode framing belongs to the KEXP cell
only (2.75 C peak gap). The speed verdict (A/C 0.724, C wins every cell,
decision invariant under coolest-block-only and drop-block-3 prunings —
audit-verified, bias direction checked) stands unchanged.
