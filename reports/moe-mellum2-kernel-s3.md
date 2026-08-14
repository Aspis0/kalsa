# Mellum2 KERNEL S3 — Phase 0: is ARM REPACK a fused-FFN lever?

**S3_NO_HEADROOM**, then **S3_CLOSED_ALL_ANGLES(i8mm delta +4.0%)**. Phase 0: REPACK 8x4 vs vec_dot at t=2 does not buy 10% of compute (token-model **−0.0022 s/tok, −1.5% of 0.148**; Q4_K ID 64/6 **slower**, 948.9 vs 495.5 µs). Phase 0b: i8mm 8x8 **does** beat that 495.5 floor (388.69 µs, ×1.27) but the token-model is **+0.0060 s/tok = +4.0%** (capture +0.2%). Gate is 10%. Stopped. No kernel, no `--moe-repack-cache`, no Phase 1/2 cells.

**Date:** 2026-08-14
**Device:** Galaxy S23 · Termux ssh `u0_a344@192.168.1.152:8022`
**Branch:** `third_party/llama.cpp` `kalsa/kernel-s3-repack` off `kalsa/kernel-s2-layer-fuse` @ `4a3ae4e5e`
**New bins:** `~/bin/kernel_s3/test-s3-repack-bench` only. Campaign pin, mellum2, kernel_s1, kernel_s2 never written.
**Campaign pin before and after:** `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`
**Build:** NDK r27.1 · API 29 · `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` · REPACK ON · i8mm off · `-j 6` · tree `build-android-kernel-s3-ops` (bench only; no bmoe-cli tree)
**Regime:** UNPLUGGED. 68→67% / 27.4→31.1 °C. Floor 45%, abort 43 °C. Never tripped. Jelly/Xiaomi untouched. PC PPL left running.

---

## Honesty gate

Pre-declared: if the REPACK delta is < ~10% of compute at t=2 (0.0148 s/tok of the S2 stock 0.148) → `S3_NO_HEADROOM`, do not build.

| estimate | s/tok | % of 0.148 |
|---|---:|---:|
| Token model (ID path, k=6, 28 layers, half Q8_0 / half Q5_0 down) | **−0.0022** | **−1.5%** |
| Optimistic: take the 1.31× single Q4_K GEMV and ignore the ID-path loss | ~0.009 | ~6% |
| Gate | 0.0148 | 10% |

Both miss. REPACK on the path a fused consumer would actually call (`MUL_MAT_ID` or per-expert GEMV at t=2) is a wash or a loss.

---

## Phase 0.1 — does stock `--moe-stream` hit REPACK?

**No.**

`Session::open` always disables extra buffer types:

```
// core/src/engine/session.cpp:531
// Load with the layout the streamer requires: file-backed mmap, no repack (a repacked
// q4_K buffer would break the rebind).
mparams.use_mmap = true;
mparams.use_extra_bufts = false;
```

Unconditional. Stream or resident, bmoe-cli never places expert weights in a `CPU_REPACK` buffer. The stream cache rebinds `tensor->data` onto raw Q4_K/Q8_0/Q5_0 bytes. `ggml::cpu::repack::extra_buffer_type::supports_op` for `MUL_MAT_ID` requires `src[0]->buffer->buft == CPU_REPACK`; streamed tensors fail that and `ggml_compute_forward` falls through to `vec_dot`.

S2's 0.1585 vs 0.148 at k6d10 t2 is therefore **not** "stock has the interleaved 8-row kernel, fused does row-wise vec_dot". Both do vec_dot. The ~10 ms/tok lives in the fused launch itself (per-row gate/up bounce, 4 internal barriers, wait-all-three). Env `GGML_MOE_REPACK_TRACE` / `GGML_MOE_FUSED_FFN_PROFILE` landed in `ggml-cpu.c` but were not shipped in a bmoe-cli: the gate had already failed.

---

## Phase 0.2 — microbench, S23 unplugged

`test-s3-repack-bench`: same Q4_K / Q8_0 / Q5_0 expert shapes, host-buffer `MUL_MAT`/`MUL_MAT_ID` vs `CPU_REPACK` extra-buffer (triggers `set_tensor` → `q4_K_8x4` / `q8_0_4x4`). Features on device: `NEON=1 ARM_FMA=1 FP16_VA=1 DOTPROD=1 LLAMAFILE=1 REPACK=1`, `i8mm=0`. NMSE host-vs-REPACK ~2e-14.

Raw: `results/kernel_s3/s23/phase0_repack_bench.txt`. n=16 timed runs per cell.

### t=1 (one thread, no pool tax)

| case | host µs | REPACK µs | GB/s host | GB/s REPACK | × |
|---|---:|---:|---:|---:|---:|
| Q4_K gemv 896×2304 | 63.00 | 41.44 | 18.6 | 28.2 | **1.52** |
| Q4_K gemv 8×2304 | 4.62 | 4.44 | 4.2 | 4.4 | 1.04 |
| Q4_K tall 7168×2304 | 477.69 | 304.75 | 19.5 | 30.5 | **1.57** |
| Q8_0 gemv 2304×896 | 80.25 | 37.19 | 27.4 | 59.1 | **2.16** |
| Q5_0 gemv 2304×896 | 112.69 | — | 12.6 | — | no traits |
| Q4_K ID 64/8 896×2304 | 561.12 | 374.06 | 16.7 | 25.0 | **1.50** |
| Q4_K ID 64/6 896×2304 | 433.62 | 282.50 | 16.2 | 24.9 | **1.54** |
| Q8_0 ID 64/8 2304×896 | 731.62 | 520.38 | 24.0 | 33.8 | **1.41** |

t=1 is the K0-A-shaped win: interleaved 8-row gemv reuses the Q8_K activation across 8 outputs. ~1.5× on Q4_K, ~2.2× on Q8_0 GEMV. Q5_0 has no REPACK type. This is **not** the on-model thread count.

### t=2 (the on-model count)

| case | host µs | REPACK µs | × |
|---|---:|---:|---:|
| Q4_K gemv 896×2304 | 116.62 | 89.31 | **1.31** |
| Q4_K tall 7168×2304 | 420.75 | 331.81 | **1.27** |
| Q8_0 gemv 2304×896 | 383.12 | 400.19 | **0.96** |
| Q4_K ID 64/8 | 807.19 | 1118.50 | **0.72** |
| Q4_K ID 64/6 | 495.50 | 948.88 | **0.52** |
| Q8_0 ID 64/8 | 944.12 | 1407.12 | **0.67** |

Host t=2 GEMV is already slower than host t=1 (117 vs 63 µs): the second thread does not pay. Same U K0-B measured on-model. REPACK's 1.31× on a single Q4_K GEMV is real and small. On `MUL_MAT_ID` — the launch a fused consumer would issue for streamed experts — REPACK **loses**.

t=8 is WALT/little-core garbage (4 ms for a GEMV that is 63 µs at t=1). Same placement tax K0-C documented. Not a kernel number.

### Token model at t=2, k=6, 28 layers

```
host   gate+up 705.1 µs + down 780.9 µs = 0.0416 s/tok
REPACK gate+up 729.9 µs + down 833.6 µs = 0.0438 s/tok
delta  -0.0022 s/tok = -1.5% of S2 stock compute 0.148
```

Q5_0 down has no REPACK type, so half the down traffic stays on vec_dot in both columns. The capture rerun (after the t=1/t=2/t=8 sweep) is a bit warmer than the table; direction is the same.

Optimistic ceiling if we threw away the ID-path result and kept only the 1.31× single Q4_K GEMV on gate+up: 28 µs × 28 layers × 2 × 6 experts ≈ 9.4 ms ≈ 6% of 0.148. Still under the 10% gate, and we do not get that number on the ID path.

---

## Why t=1 wins and t=2 ID loses

`ggml::cpu::repack::tensor_traits::forward_mul_mat_id` (`repack.cpp:4386`) walks experts one at a time, splits **rows** across `nth`, then **aligns the split to `NB_COLS=8`**. On a single 896-row GEMV at nth=2 that is a modest win (1.31×). On ID, the per-expert align + mapping + extra barrier costs more than the 8-row gemv saves, because stock `vec_dot` ID at t=2 is already at the packed floor (S1: fused ID = stock ID = tall `MUL_MAT` ≈ 421 µs).

There is no i8mm kernel on this device (`HAVE_MATMUL_INT8` Failed). The ARM type is `q4_K_8x4` (dotprod), not `q4_K_8x8`. No hidden matmul-int8 lever.

K0 already told us i8mm/REPACK-ON extra-buffer was a refuted F1d cell. S3 re-opened it with a direct A/B on the expert shapes. Same answer at t=2.

---

## What this means for the fused 10 ms/tok

S2 fused ON is slower than OFF at every same-t pair (k6d10 t2: 0.1585 vs 0.148). That gap is **not** REPACK. Both paths use `vec_dot` on raw Q4_K. Remaining cost inside the fused launch, in likely order:

1. Phase B interleaves `vec_dot(gate)` + `vec_dot(up)` + SwiGLU **per row**, bouncing between two 9.3 MiB expert tensors. Stock streams all gate rows, then all up.
2. Four `ggml_barrier`s per layer (A/B/C/D) vs stock node boundaries.
3. Wait-all-three before any weight byte. Cheap at d1.0 hit ~88%; less so at d0.65. Matches S2: ON-slower on both cells.

A later spike that wants those 10 ms should profile those three, not REPACK. The env-gated `GGML_MOE_FUSED_FFN_PROFILE` print (per-token last-28, hook/A/B/C/D) is in the tree for that.

---

## What was / was not built

| | |
|---|---|
| Branch | `kalsa/kernel-s3-repack` @ llama.cpp, not pushed |
| Bench | `tests/test-s3-repack-bench.cpp` + `llama_build` in `tests/CMakeLists.txt` |
| Trace | `GGML_MOE_REPACK_TRACE`, `GGML_MOE_FUSED_FFN_PROFILE` in `ggml-cpu.c` (off unless env set) |
| Matcher | untouched (S2 15+4 predicates stand) |
| `--moe-repack-cache` | **not added** |
| Fused B/D REPACK dispatch | **not added** |
| Cache-insert pack | **not added** |
| S23 gate cells / bmoe-cli | **not built, not run** |
| BigMoeOnEdge branch | **not created** (no flag) |

---

## Hygiene

- Campaign pin sha before and after: `1ca51420…`. mellum2 `0ac612de…` and kernel_s1 `559bc59d…` / kernel_s2 `71f3556d…` never used as install targets.
- New tool only under `~/bin/kernel_s3/` (stripped 1 341 992 B sha `fcbcad43…`).
- No kill of the PC PPL. Builds `-j 6`. No `build-llama-pc` interference. No reuse of `build-android-kernel-s2*`.
- Timed cell UNPLUGGED, 68→67%, peak 31.1 °C.
- Jelly / Xiaomi untouched.

Artifacts: `results/kernel_s3/` (`bin/`, `s23/phase0_repack_bench.txt`, `bin.sha256`, `campaign.sha256`).

---

## Phase 0b — i8mm arm

**S3_CLOSED_ALL_ANGLES(i8mm delta +4.0%).** The S23 cores run i8mm. A dedicated `armv8.6-a+dotprod+fp16+i8mm` build (`HAVE_MATMUL_INT8` Success) selects `q4_K_8x8` / `q8_0_4x8`. Q4_K `MUL_MAT_ID` 64/6 at t=2 is **388.69 µs** vs the Phase-0 host floor **495.50 µs** (×1.27, −106.8 µs). That is a real cell win — 8x8 also **fixes the 8x4 ID collapse** (948.9 → 388.7). Token-model ID-only: **+0.0060 s/tok = +4.0% of 0.148**. Same capture token model as Phase 0: **+0.0003 s/tok = +0.2%**. Gate is 10%. Miss. No fused/ID consumer.

**Date:** 2026-08-14
**Device:** Galaxy S23 · Termux ssh `u0_a344@192.168.1.152:8022`
**Branch:** `third_party/llama.cpp` `kalsa/kernel-s3-repack` @ `8d3c2ea75` (no new kernel code)
**New bin:** `~/bin/kernel_s3_i8mm/test-s3-repack-bench` only. Campaign pin, mellum2, kernel_s1, kernel_s2, kernel_s3 never written.
**Campaign pin before and after:** `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`
**Build:** NDK r27.1 · API 29 · `GGML_CPU_ARM_ARCH=armv8.6-a+dotprod+fp16+i8mm` · REPACK ON · **i8mm on** · `-j 6` · tree `build-android-kernel-s3-i8mm`
**Binary:** stripped 1 265 192 B sha `60cc103238ad38096cedef333519402f8cbee532f16331f5a4ef902df20e7e2a`
**Regime:** UNPLUGGED. 65→65% / 26.1→29.3 °C. Floor 45%, abort 43 °C. Never tripped. Jelly/Xiaomi untouched. PC PPL left running.

Features on device: `NEON=1 ARM_FMA=1 FP16_VA=1 MATMUL_INT8=1 DOTPROD=1 REPACK=1`, **`i8mm=1`**. Trace: `repack tensor W with q4_K_8x8` / `q8_0_4x8`. NMSE host-vs-REPACK ~3e-14. This binary reports `llamafile=0` (Phase 0 host had llamafile=1); this-run host ID t=2 is 601.88, not 495.50. REPACK does not use llamafile — the gate compares i8mm 388.69 to the Phase-0 495.50 floor.

Raw: `results/kernel_s3/s23/phase0b_i8mm_bench.txt`. n=16 timed runs per cell.

### t=1

| case | host µs | i8mm REPACK µs | GB/s host | GB/s i8mm | × |
|---|---:|---:|---:|---:|---:|
| Q4_K gemv 896×2304 | 79.56 | 46.81 | 14.7 | 25.0 | **1.70** |
| Q4_K gemv 8×2304 | 4.62 | 4.31 | 4.2 | 4.5 | 1.07 |
| Q4_K tall 7168×2304 | 482.69 | 351.06 | 19.3 | 26.5 | **1.38** |
| Q8_0 gemv 2304×896 | 80.19 | 40.44 | 27.4 | 54.3 | **1.98** |
| Q5_0 gemv 2304×896 | 113.69 | — | 12.5 | — | no traits |
| Q4_K ID 64/8 896×2304 | 557.44 | 442.81 | 16.8 | 21.1 | **1.26** |
| Q4_K ID 64/6 896×2304 | 426.81 | 326.38 | 16.5 | 21.5 | **1.31** |
| Q8_0 ID 64/8 2304×896 | 731.50 | 533.00 | 24.0 | 33.0 | **1.37** |

Same shape as Phase-0 t=1 (~1.3–2.0×). Token-model capture at t=1: +0.0087 s/tok = +5.9%. Still under 10%, and t=1 is not the on-model count.

### t=2 (the on-model count)

| case | host µs | i8mm REPACK µs | × | Phase-0 8x4 REPACK µs |
|---|---:|---:|---:|---:|
| Q4_K gemv 896×2304 | 142.56 | 108.06 | **1.32** | 89.31 |
| Q4_K tall 7168×2304 | 421.25 | 374.56 | **1.13** | 331.81 |
| Q8_0 gemv 2304×896 | 389.81 | 92.88 | **4.20** | 400.19 |
| Q4_K ID 64/8 | 884.31 | 493.38 | **1.79** | 1118.50 |
| **Q4_K ID 64/6** | **601.88** | **388.69** | **1.55** | **948.88** |
| Q8_0 ID 64/8 | 993.56 | 1454.94 | **0.68** | 1407.12 |

Q8_0 GEMV t=2 4.20× is the host thread-tax (t=1 host is 80 µs; t=2 host 390 is WALT). Do not put it in the honesty number. Q8_0 ID t=2 still loses.

### Token model at t=2, k=6, 28 layers

Same capture formula as Phase 0 (Q5_0 down has no REPACK type):

```
host   gate+up 704.6 µs + down 753.8 µs = 0.0408 s/tok
i8mm   gate+up 777.5 µs + down 671.8 µs = 0.0406 s/tok
delta  +0.0003 s/tok = +0.2% of S2 stock compute 0.148
```

ID-only vs the Phase-0 host floor the gate named:

```
ΔID     495.50 − 388.69 = 106.81 µs
gate+up 2 × 106.81 = 213.6 µs/layer
× 28    = 0.0060 s/tok = 4.0% of 0.148
```

Both miss 10%. 8x8 is faster than 8x4 on ID and faster than vec_dot on that cell. It is not a fused-FFN lever.

### What this closes

Phase 0 left mechanism 3 of `docs/kernel-s3-design.md` unmeasured (`HAVE_MATMUL_INT8` Failed on the armv8.2-a+dotprod target). Phase 0b built the missing arm. The CPU kernel lane is now measured on every axis: dotprod vec_dot floor, REPACK 8x4, i8mm 8x8. The t=2 config floor 0.148 stands.

A later spike that wants the fused 10 ms/tok should still profile Phase-B interleave / four barriers / wait-all-three, not a new kernel.

### Hygiene

- Campaign pin sha before and after: `1ca51420…`. mellum2 `0ac612de…` / kernel_s1 `559bc59d…` / kernel_s2 `71f3556d…` / kernel_s3 bench `fcbcad43…` never used as install targets.
- New tool only under `~/bin/kernel_s3_i8mm/`.
- No kill of the PC PPL. Builds `-j 6`. No `build-llama-pc` interference. No reuse of `build-android-kernel-s2*` / `build-android-kernel-s3-ops`.
- Timed cell UNPLUGGED, 65%, peak 29.3 °C.
- Jelly / Xiaomi untouched.

DONE

