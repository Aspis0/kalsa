# DEFECT-P FIX ATTEMPT 2 — DEVICE VERIFICATION (S23)

**Session:** 2026-08-19/20 (device verification of attempt 2 = scalar-uint qs rewrite).
**Repo root:** `C:\Users\gualt\Desktop\Kalsa\moe-experiments`.
**Submodule `BigMoeOnEdge/third_party/llama.cpp`:** branch `kalsa/kernel-s3-repack`; attempt-2 commit `f63746555` (parent `bb05e4a0b` = probe; `39a0b130` = attempt 1). **NO push.**
**Fix under test:** scalar-uint rewrite of the qs path of the five `kernel_convert_block_*_trans4_ns` converts (per-byte qs loads widened to uint, one uint expression per output word, ONE uint store per word; uchar `trans4_pack_lo/hi` → uint `trans4_pack_lo_u32/hi_u32`). Motivation: probe localized the defect to the convert WRITE (raw SoA dirty, even-partner bit7 gate, cross-byte smear ⇒ byte-lane re-vectorization); the restore used the same scalar-uint form successfully.
**On-device `libggml-opencl.so` sha256 = `2032b7c7e25d0f9488213f757c2fa8f073ba675c18e2a8d333934603a996e2e7`** (verified before EVERY run). Pre-fix attempt-1 was `69d6d862…`; pre-fix was `9198f387…`.
**Discipline:** adb shell from PC only; `MSYS_NO_PATHCONV=1`; sha256 on-device `.so` before every run; one process per cell; HOST_REPACK/DUMP_Q presence-only; no git push; report incremental.
**Device:** Galaxy S23 SM-S911U / kalama / Adreno 740, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. Dir `/data/local/tmp/s3oracle` (recreated fresh). 21G free on /data.
**Logs:** `results/oracle_consumer_s23/defectP_fix2/`.

## Pre-registered predictions (raw readback is the PRIMARY gate this time)

| # | matrix | prediction (attempt 2) | pre-fix / attempt-1 ref |
|---|---|---|---|
| 1 | RAW SoA readback (DUMP_Q) q4_0 bytewise, lcg + pair8040 | **raw_mismatch = 0 in BOTH** | attempt-1: lcg 18,688 / pair8040 32,768 (raw dirty) |
| 2 | q4_0 roundtrip, 4 fills (lcg/const40/constC0/lcg29), bytewise | 0,0,0,0 | 65,536 / 0 / 131,072 / 57,344 |
| 3 | 5 types + K + dense, lcg bytewise | 5 affected → 0; controls unchanged | 5×65,536; K+dense clean |
| 4 | same sweep, bitselect arm + raw readback under bitselect | all 0; raw 0 | bitselect == bytewise (65,536) pre-fix |
| 5 | e2e bytewise (q4_0 74/74, q4_1 75/75, q5_0 3/3, q5_1 3/3, mxfp4 74/74, q8_0 75/75, q6_K 3/3, dense 915/925) + bitselect q4_0 spot-check 74/74 | all PASS unchanged | PASS (self-consistency) |
| 6 | HOST_REPACK q4_0 control | 0 | 0 |

**Fidelity framing:** e2e PASS is self-consistency (not fidelity) in BOTH worlds. The **write-side fidelity** evidence is **matrix 1 raw readback = 0** (producer stores contract bytes); the **end-to-end fidelity** evidence is **matrix 2/3/4 round-trip = 0** (restore inverts contract storage to the original bytes). Any violation → STOP that thread, record verbatim; the review's "next structural escalation" is the designed fallback (not improvised here).

## Phase 0/1 — device + push (DONE; all 10 shas PC==device)

`.so` = `2032b7c7…`, `libggml-base.so`=`408ea9e7…`, `libggml-cpu.so`=`fd9cb4b1…`, `libggml.so`=`3f07bb31…`, `libllama.so`=`f8b11fc3…`, `libllama-common.so`=`588be8e6…`, `test-opencl-moe-roundtrip`=`1e50038b…`, `test-backend-ops`=`e5f2ecd4…`, `libc++_shared.so`=`e69496a4…`, `libomp.so`=`ea27efff…`.

---

## Results (filled incrementally)

_(appended below)_

## M1 — RAW SoA readback (PRIMARY gate), q4_0 bytewise, DUMP_Q=1

| run | fill | KALSA_SPLIT (lo/hi) | KALSA_DUMP_Q raw | roundtrip q4_0 | verdict |
|---|---|---|---|---|---|
| 1a | lcg | **0 / 0** | **BUFFER MATCHES HOST REFERENCE (producer is correct)** | 0 clean | **CONFIRMED** (raw 0; was 18,688) |
| 1b | pair8040 | **0 / 0** | **BUFFER MATCHES HOST REFERENCE (producer is correct)** | 0 clean | **CONFIRMED** (raw 0; was 32,768) |

**The convert WRITE now stores contract bytes** — raw trans4 SoA matches the host reference exactly. This is the write-side fidelity gate, passed. Logs: `m1_raw_lcg_bytewise.log`, `m1_raw_pair8040_bytewise.log`.

## M2 — q4_0 roundtrip, 4 fills, bytewise

| fill | predicted | measured | pre-fix/attempt-1 | verdict |
|---|---|---|---|---|
| lcg | 0 | 0 clean | 65,536 | **CONFIRMED** |
| const40 | 0 | 0 clean | 0 | CONFIRMED (trivially clean) |
| constC0 | 0 | 0 clean | 131,072 (ALL fire) | **CONFIRMED** (the all-fire case → 0) |
| lcg29 | 0 | 0 clean | 57,344 | **CONFIRMED** |

constC0 (every byte 0xC0, bit7 set — which fired 131,072 = ALL odd-qs pre-fix) is now **0**. The even-partner bit7 gate is fully defeated. Logs: `m2_const40/constC0/lcg29_bytewise.log` (lcg from M1).

## M3 — full 5-type + K + dense sweep, lcg bytewise

| type | predicted | measured | pre-fix | verdict |
|---|---|---|---|---|
| q4_0 | 0 | 0 clean | 65,536 | **CONFIRMED** |
| q4_1 | 0 | 0 clean | 65,536 | **CONFIRMED** |
| q5_0 | 0 | 0 clean | 65,536 | **CONFIRMED** |
| q5_1 | 0 | 0 clean | 65,536 | **CONFIRMED** |
| mxfp4 | 0 | 0 clean | 65,536 | **CONFIRMED** |
| q4_K / q5_K / q6_K | clean | 0 clean | 0 | CONFIRMED (controls unchanged) |
| dense q4_0 (256×512×1, 512×512×1) | clean | 0 clean | 0 | CONFIRMED (controls unchanged) |

All 5 affected trans4 types → 0; K + dense clean (unchanged). (const40/constC0/lcg29 runs also show all 5 types clean.) Log: `m1_raw_lcg_bytewise.log`, `m2_*_bytewise.log`.

## M4 — bitselect arm, lcg + raw readback (separate process)

| check | predicted | measured | verdict |
|---|---|---|---|
| raw readback (DUMP_Q) bitselect lcg | 0 | **BUFFER MATCHES HOST REFERENCE** (0/0 split) | **CONFIRMED** (raw 0 under bitselect) |
| 5 types + K + dense roundtrip, bitselect lcg | all 0 | all 0 clean | **CONFIRMED** |

The bitselect arm is fixed too (both arms now clean, as predicted — bitselect-on-uint collapses to the same safe scalar-uint code). Log: `m4_bitselect_lcg_dumpq.log`.

## M5 — e2e test-backend-ops (`-b GPUOpenCL`)

| cell | op | variant | predicted | measured | verdict |
|---|---|---|---|---|---|
| q4_0 | MUL_MAT_ID | bytewise | 74/74 | 74/74 PASS | CONFIRMED |
| q4_1 | MUL_MAT_ID | bytewise | 75/75 | 75/75 PASS | CONFIRMED |
| q5_0 | MUL_MAT_ID | bytewise | 3/3 | 3/3 PASS | CONFIRMED |
| q5_1 | MUL_MAT_ID | bytewise | 3/3 | 3/3 PASS | CONFIRMED |
| mxfp4 | MUL_MAT_ID | bytewise | 74/74 | 74/74 PASS | CONFIRMED |
| q8_0 | MUL_MAT_ID | bytewise | 75/75 | 75/75 PASS | CONFIRMED |
| q6_K | MUL_MAT_ID | bytewise | 3/3 | 3/3 PASS | CONFIRMED |
| dense | MUL_MAT | bytewise | 915/925 | 915/925 (10 pre-existing q6_K flat) | CONFIRMED (unchanged) |
| q4_0 spot-check | MUL_MAT_ID | bitselect | 74/74 | 74/74 PASS | CONFIRMED |

All e2e PASS, unchanged from pre-fix — as expected (e2e is self-consistency; with the producer now contract-correct, GPU and judge both see the ORIGINAL bytes x, so PASS is now also fidelity). Logs: `m5_e2e_bytewise_*.log`, `m5_e2e_dense_mulmat.log`, `m5_e2e_bitselect_q4_0.log`.

## M6 — HOST_REPACK q4_0 control, lcg bytewise

| check | predicted | measured | verdict |
|---|---|---|---|
| q4_0 (`host_repack=1`) | 0 | 0 clean | **CONFIRMED** |

HOST_REPACK bypasses the device convert for q4_0 (host repack → contract storage) → 0; path-independent. Env unset on device after (inline-only, clean). Log: `m6_hostrepack_lcg_bytewise.log`.

## Verdict table (summary)

| matrix | cell | predicted | measured | verdict |
|---|---|---|---|---|
| 1 | raw readback q4_0 lcg + pair8040, bytewise | raw 0 / raw 0 | 0 / 0 (MATCHES) | **CONFIRMED** |
| 2 | q4_0 roundtrip lcg/const40/constC0/lcg29, bytewise | 0,0,0,0 | 0,0,0,0 | **CONFIRMED** |
| 3 | 5 types + K + dense, lcg bytewise | 5×0; controls clean | 5×0; controls clean | **CONFIRMED** |
| 4 | bitselect sweep + raw readback, lcg | all 0; raw 0 | all 0; raw 0 (MATCHES) | **CONFIRMED** |
| 5 | e2e (7 types + dense + bitselect spot) | all PASS | 74/74, 75/75, 3/3, 3/3, 74/74, 75/75, 3/3, 915/925, 74/74 | **CONFIRMED** |
| 6 | HOST_REPACK q4_0 | 0 | 0 | **CONFIRMED** |

**All pre-registered predictions CONFIRMED; zero violations.**

## One-line conclusion

**defect P fixed on device: YES.**

The scalar-uint rewrite of the five trans4 convert kernels (commit `f63746555`) defeats the Adreno byte-lane re-vectorization: the convert WRITE now stores contract bytes (raw SoA readback = 0 under lcg AND pair8040 AND bitselect), the round-trip is 0 across all four fills and all five affected types in both arms (including constC0, the all-fire case that was 131,072 pre-fix), e2e stays PASS (now weight-faithful — GPU and judge both see the original bytes x), and HOST_REPACK remains path-independent at 0. The even-partner bit7 cross-byte smear is eliminated. The restore READ was always innocent (raw was dirty pre-fix; now raw is clean so restore trivially inverts to 0). Production wrong-weights risk for the convert stage is closed at the byte level; the deferred production smoke (does the live MoE load path actually dispatch this convert?) remains the only unmeasured fidelity link for the real engine.

## Discipline / chain-of-custody

- On-device `libggml-opencl.so` == `2032b7c7…` (attempt-2 fix) verified pre-run on every cell. `cvt.cl`/`ggml-opencl.cpp` carry the committed fix; test exes unchanged (`1e50038b`/`e5f2ecd4`).
- HOST_REPACK/DUMP_Q presence-only; DUMP_Q set only for M1/M4 (inline, unset after); ORACLE never set; CVT_VARIANT value-parsed (bytewise default + bitselect arm both verified).
- No fix/patch attempted on device (matrix only). No git push. Submodule at `f63746555`.
- Device temp binaries cleaned up at end (`/data/local/tmp/s3oracle` removed; `s3base`/`s3fix`/`s3printf` untouched). Logs + MANIFEST retained on PC.
