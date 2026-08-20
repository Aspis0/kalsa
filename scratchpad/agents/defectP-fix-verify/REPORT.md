# DEFECT-P FIX — DEVICE VERIFICATION (S23)

**Session:** 2026-08-19/20 (device verification of the defect-P fix; no performance timing).
**Repo root:** `C:\Users\gualt\Desktop\Kalsa\moe-experiments`.
**Submodule `BigMoeOnEdge/third_party/llama.cpp`:** branch `kalsa/kernel-s3-repack`; fix commit `39a0b130f` (parent `5a952cb2`). **NO push.**
**Fix under test:** `cvt.cl` `trans4_pack_hi`/`trans4_pack_lo` rewritten shift-first-then-mask in BOTH arms (bytewise `#else` + bitselect `#ifdef GGML_OPENCL_CVT_BITSELECT`). New `libggml-opencl.so` sha256 = `69d6d862bd37955bd6edffcc167b59895beec45ede58659945d92b13266d1732` (pre-fix was `9198f38779db531c92818a9d7b23ba0d471df1d95aba1498b61c9cbf1d07f43c`).
**Discipline:** adb shell from PC only (never Termux); `MSYS_NO_PATHCONV=1` from Git-bash; `df /data` first; sha256 of on-device `libggml-opencl.so` checked BEFORE EVERY run (must be `69d6d862…`); one process per cell; envvar traps per retrial (HOST_REPACK/DUMP_Q/ORACLE presence-only → unset to disable; **actual env name is `GGML_OPENCL_HOST_REPACK`**; CVT_VARIANT/LOG_WEIGHT_PATH/ROUNDTRIP_FILL value-parsed); no git push; report written incrementally.
**Device:** Galaxy S23, SM-S911U, kalama, Adreno 740, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. Device dir `/data/local/tmp/s3oracle` (recreated fresh; `s3base`/`s3fix`/`s3printf` untouched).
**Logs:** `results/oracle_consumer_s23/defectP_fix/` (`run1a…run5…`, `MANIFEST.txt`).

## Headline (stated up front)

**defect P fixed on device: NO.** The shift-first-then-mask rewrite of `trans4_pack_hi`/`trans4_pack_lo` in `cvt.cl` had **ZERO effect** on the device convert kernel. Every trans4-MoE round-trip mismatch count is **byte-identical to the pre-fix defectP experiment** (`9198f387`) across all four fills AND both arms — including the bit7 cross-check counters. e2e stays PASS everywhere (self-consistency), which is NOT fidelity evidence (stated plainly below). This triggers the report's documented fallback: bytewise still corrupts after the helper rewrite (and bitselect corrupts identically) → the residual site is the **shared x0/x1 LOAD or hi[j] STORE (rank 2)**; the single-pair probe is the designed next step (NOT run here — no improvisation).

## Phase 0 — Device + dir setup (DONE)

- `adb devices`: two devices attached; S23 targeted by serial. Identity: `SM-S911U` / `kalama` / `adreno`.
- `df /data`: 104G size, 83G used, **21G avail** (81%).
- `/data/local/tmp/s3oracle` recreated fresh. `s3base`/`s3fix`/`s3printf` untouched.

## Phase 1 — Push + sha verification (DONE; all 10 files PC sha == device sha)

| file | PC sha256 | device sha256 | match |
|---|---|---|---|
| **libggml-opencl.so** (the fix) | `69d6d862…` | `69d6d862…` | **✓** |
| libggml-base.so | `781e13aa…` | `781e13aa…` | ✓ |
| libggml-cpu.so | `fd9cb4b1…` | `fd9cb4b1…` | ✓ |
| libggml.so | `3f07bb31…` | `3f07bb31…` | ✓ |
| libllama.so | `f8b11fc3…` | `f8b11fc3…` | ✓ |
| libllama-common.so | `bab524c3…` | `bab524c3…` | ✓ |
| test-opencl-moe-roundtrip | `94a6b8fe…` | `94a6b8fe…` | ✓ (byte-identical to defectP build — same test code; only .so changed → ideal controlled experiment) |
| test-backend-ops | `e5f2ecd4…` | `e5f2ecd4…` | ✓ |
| libc++_shared.so (NDK aarch64) | `e69496a4…` | `e69496a4…` | ✓ |
| libomp.so (NDK clang-18 aarch64) | `ea27efff…` | `ea27efff…` | ✓ |

Exes `chmod 755`. **On-device `libggml-opencl.so` == `69d6d862…` (the fix) confirmed pre-run on every cell.** Verified `CVT_VARIANT=bitselect` actually switches arms: `ggml-opencl.cpp:1657` appends `-DGGML_OPENCL_CVT_BITSELECT=1` to the `clBuildProgram` options, so the embedded (fixed) source is compiled with the bitselect define at runtime → matrix 3 genuinely tests the bitselect arm.

## Phase 2 — Matrix results (each cell: pre-run .so sha = 69d6d862 confirmed)

### Matrix 1 — q4_0 4-fill sweep, bytewise arm

| cell | fill | predicted (post-fix) | measured | pre-fix ref | verdict |
|---|---|---|---|---|---|
| 1a | lcg | 0 / clean | **65,536 / odd_qs_hi_to_f**, first=39, bit7clear=63,488, clean_odd_bit7set=63,488 | 65,536 / 63,488 / 63,488 | **VIOLATED** (byte-identical) |
| 1b | const40 | 0 / clean | **0 / clean**, rc=0 | 0 / clean | CONFIRMED (trivial — was 0 pre-fix; no positions to fix) |
| 1c | constC0 | 0 / clean | **131,072 / odd_qs_hi_to_f**, first=3, bit7clear=0 | 131,072 / 0 | **VIOLATED** (byte-identical) |
| 1d | lcg29 | 0 / clean | **57,344 / odd_qs_hi_to_f**, first=5, bit7clear=15,360, clean_odd_bit7set=23,552 | 57,344 / 15,360 / 23,552 | **VIOLATED** (byte-identical) |

Logs: `run1a_lcg_bytewise.log`, `run1b_const40_bytewise.log`, `run1c_constC0_bytewise.log`, `run1d_lcg29_bytewise.log`.

### Matrix 2 — full 5-type + K + dense sweep, lcg, bytewise (no HOST_REPACK)

(from the plain bytewise lcg run; `host_repack=0`)

| type | predicted | measured | pre-fix ref | verdict |
|---|---|---|---|---|
| q4_0 | 0 clean | **65,536 dirty** | 65,536 | **VIOLATED** |
| q4_1 | 0 clean | **65,536 dirty** | 65,536 | **VIOLATED** |
| q5_0 | 0 clean | **65,536 dirty** | 65,536 | **VIOLATED** |
| q5_1 | 0 clean | **65,536 dirty** | 65,536 | **VIOLATED** |
| mxfp4 | 0 clean | **65,536 dirty** (first=2) | 65,536 (first=2) | **VIOLATED** |
| q4_K | clean | 0 clean | 0 | CONFIRMED |
| q5_K | clean | 0 clean | 0 | CONFIRMED |
| q6_K | clean | 0 clean | 0 | CONFIRMED |
| dense q4_0 (256×512×1) | clean | 0 clean | 0 | CONFIRMED |
| dense q4_0 (512×512×1) | clean | 0 clean | 0 | CONFIRMED |

All 5 affected trans4 types still 65,536 dirty / `odd_qs_hi_to_f`; K-quants + dense clean. Byte-identical to pre-fix. Log: `run4_hostrepack_lcg_bytewise.log` (the run with the wrong `HOST_REPACK` name did not engage host-repack → `host_repack=0` → effectively the plain bytewise lcg 5-type sweep; data valid for matrix 2).

### Matrix 3 — bitselect arm, lcg (5-type sweep, separate process)

| type | predicted | measured | pre-fix ref (bitselect) | verdict |
|---|---|---|---|---|
| q4_0 | 0 clean | **65,536 / odd_qs_hi_to_f**, first=39, bit7clear=63,488 | 65,536 / 63,488 | **VIOLATED** (byte-identical to pre-fix AND identical to bytewise) |

The bitselect arm corrupts **identically** to the bytewise arm (both 65,536, same first=39, same bit7 partition) — the same as pre-fix. Since the helper rewrite changed BOTH arms' pack-helper code and neither arm's behavior changed at all, the residual cannot be in the pack helpers; it is in the **shared x0/x1 LOAD or hi[j] STORE** (the only constructs common to both arms) — exactly the rank-2 fallback the maxrecall-puzzle report flagged. Log: `run3_bitselect_lcg.log`.

### Matrix 4 — HOST_REPACK q4_0 control, lcg, bytewise (`GGML_OPENCL_HOST_REPACK=1`)

| type | predicted | measured | verdict |
|---|---|---|---|
| q4_0 | 0 (HOST_REPACK bypasses device convert) | **0 / clean**, `host_repack=1` | **CONFIRMED** |
| q4_1 / q5_0 / q5_1 / mxfp4 | (HOST_REPACK is q4_0-only) | 65,536 dirty, `host_repack=1` | consistent with defectP report (HOST_REPACK q4_0-only) |
| q4_K / q5_K / q6_K | clean | 0 clean | CONFIRMED |

`HOST_REPACK=[1] CVT_VARIANT=[bytewise]` echoed by the harness; `host_repack=1` in every ROUNDTRIP line; env unset on device after (inline-only, clean). Confirms path independence: when the host produces contract-correct storage (q4_0), the fixed restore inverts it to 0. Log: `run4_hostrepack_lcg_bytewise.log` (retry with correct env name).

### Matrix 5 — e2e test-backend-ops (`-b GPUOpenCL`)

| cell | op | variant | predicted | measured | verdict |
|---|---|---|---|---|---|
| q4_0 | MUL_MAT_ID | bytewise | 74/74 | 74/74 PASS | CONFIRMED |
| q4_1 | MUL_MAT_ID | bytewise | 75/75 | 75/75 PASS | CONFIRMED |
| q5_0 | MUL_MAT_ID | bytewise | 3/3 | 3/3 PASS | CONFIRMED |
| q5_1 | MUL_MAT_ID | bytewise | 3/3 | 3/3 PASS | CONFIRMED |
| mxfp4 | MUL_MAT_ID | bytewise | 74/74 | 74/74 PASS | CONFIRMED |
| q8_0 | MUL_MAT_ID | bytewise | 75/75 | 75/75 PASS | CONFIRMED |
| q6_K | MUL_MAT_ID | bytewise | 3/3 | 3/3 PASS | CONFIRMED |
| dense | MUL_MAT | bytewise | 915/925 (unchanged) | 915/925 (10 FAIL, pre-existing q6_K flat) | CONFIRMED (unchanged baseline) |
| q4_0 spot-check | MUL_MAT_ID | **bitselect** | PASS | 74/74 PASS | CONFIRMED |

All e2e PASS exactly as predicted and identical to the pre-fix state. Logs: `run5_e2e_bytewise_<type>.log`, `run5_e2e_dense_mulmat.log`, `run5_e2e_bitselect_q4_0.log`.

## Fidelity note (stated plainly)

e2e PASS in BOTH the pre-fix (`9198f387`) and post-fix (`69d6d862`) worlds proves only **judge/GPU self-consistency on the same (dirty) weights** — the GPU consumer dequants the same miscompiled storage the fixed restore reconstructs for the CPU judge, so they agree to <5×10⁻⁴. It is **NOT** fidelity evidence. The fidelity evidence for the fix would have been the **round-trip zero counts** (producer storing the model's original bytes x). Those zeros did **NOT** materialize — the round-trip is byte-identical to pre-fix. Therefore there is **no fidelity evidence** here; the latent wrong-weights risk stands **UNCHANGED**: real MoE load paths that dispatch `set_tensor → kernel_convert_block_*_trans4_ns` on this `.so`/Adreno 740 still run with 65,536 corrupted odd-qs hi-nibbles per affected tensor. The deferred production smoke (does the live engine's MoE load actually dispatch this convert?) remains the open fidelity link for the real engine — and now, even if it does dispatch, **the committed fix does not remediate it**.

## Diagnosis — why the helper rewrite had zero effect

The maxrecall-puzzle report (Task 4.2) ranked the defect sites and explicitly flagged the fallback this run triggers:

> **2. Shared LOAD of x0/x1 and global STORE of hi[j] in the five `kernel_convert_block_*_trans4_ns` kernels — the only constructs shared by the bytewise AND bitselect arms, which corrupt IDENTICALLY (65,536). If the rank-1 rewrite clears only the bytewise arm, the residual site is here. SECONDARY / required to fully explain bitselect-identical corruption.**

Post-fix, **both arms still corrupt identically** (bytewise 65,536; bitselect 65,536; same first=39; same bit7 partition) — byte-identical to pre-fix. Since the helper rewrite touched the only code that DIFFERS between the two arms and neither arm changed at all, the residual must lie in the **shared** load/store (rank 2), OR the Adreno compiler miscompiles `(x0 >> 4) & 0x0F` identically to `(x0 & 0xF0) >> 4` (same sign-fill), OR the defect was never localized to `trans4_pack_hi` in the first place. All three are consistent with "helper rewrite insufficient"; they are **not** distinguishable by these aggregates alone.

The designed discriminating next step (per the report's Task 4.4 fallback, NOT run here): a **targeted single-pair probe** — one block with the (even,odd) pair set to fixed values (e.g. even × {0x00,0x80} × odd × {0x40,0xC0}), all other bytes unit — observe which even-bit7 × odd-value combination floods, under BOTH variants, in one run. This localizes the trigger to the partner-byte load vs the pack-helper expression and to the load vs the store. (Also: dump the convert's intermediate buffers vs a CPU reference, and feed pre-transposed reference bytes straight into the gemv, to separate producer-write from consumer-read.)

## Verdict table (summary)

| matrix | cell | predicted | measured | verdict |
|---|---|---|---|---|
| 1a | q4_0 lcg bytewise | 0 | 65,536 | **VIOLATED** |
| 1b | q4_0 const40 bytewise | 0 | 0 | CONFIRMED (trivial) |
| 1c | q4_0 constC0 bytewise | 0 | 131,072 | **VIOLATED** |
| 1d | q4_0 lcg29 bytewise | 0 | 57,344 | **VIOLATED** |
| 2 | 5 affected types, lcg bytewise | 0 (×5) | 65,536 (×5) | **VIOLATED** (×5) |
| 2 | q4_K/q5_K/q6_K + dense, lcg bytewise | clean | clean | CONFIRMED |
| 3 | q4_0 lcg bitselect | 0 | 65,536 (= bytewise) | **VIOLATED** (shared load/store residual) |
| 4 | q4_0 HOST_REPACK lcg bytewise | 0 | 0 | CONFIRMED |
| 5 | e2e q4_0/q4_1/q5_0/q5_1/mxfp4/q8_0/q6_K bytewise | PASS | 74/74, 75/75, 3/3, 3/3, 74/74, 75/75, 3/3 | CONFIRMED (self-consistency) |
| 5 | e2e dense MUL_MAT | 915/925 | 915/925 | CONFIRMED (unchanged) |
| 5 | e2e q4_0 bitselect spot-check | PASS | 74/74 | CONFIRMED (self-consistency) |

**One-line conclusion: defect P fixed on device: NO.**

(The committed helper rewrite had zero device effect — all round-trip counts byte-identical to pre-fix in both arms; e2e self-consistency holds but is not fidelity. Residual = shared load/store (rank 2, per the report's fallback); single-pair probe is the designed next step, not run here. Production wrong-weights risk stands UNCHANGED.)

## Discipline / chain-of-custody

- `cvt.cl` and `ggml-opencl.cpp` carry the committed fix (`39a0b130f`); on-device `libggml-opencl.so` == `69d6d862…` verified pre-run on every cell.
- envvar traps honored: `GGML_OPENCL_HOST_REPACK` set only for matrix 4 (inline, unset after — verified `unset on device (clean)`); `DUMP_Q`/`ORACLE` never set; `CVT_VARIANT`/`ROUNDTRIP_FILL`/`LOG_WEIGHT_PATH` value-parsed (fills resolved correctly; bitselect verified to pass `-DGGML_OPENCL_CVT_BITSELECT=1`).
- No fix/patch/kernel change attempted on device (analysis + matrix only). No git push. Submodule left at `39a0b130f`.
- Device temp binaries cleaned up at end (`/data/local/tmp/s3oracle` removed; `s3base`/`s3fix`/`s3printf` left untouched). Logs + MANIFEST retained on PC.
