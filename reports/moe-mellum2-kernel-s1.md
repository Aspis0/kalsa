# Mellum2 KERNEL S1 — virtual pack of k selected Q4_K experts

**S1_FAIL(4)** · fused MUL_MAT_ID Q4_K 8-of-64 = **231.59 µs** (t=8, unplugged) · on-model compute **0.182 s/tok** (t=2, n=64, 2 reps). Kernel-level gate holds. On-model compute gate (≤ 0.17) does not: 0.182 is K0-B t=2 (0.181) plus noise. At `-t 2` the layout tax is already gone (stock ID = fused = tall MUL_MAT ≈ 421 µs).

**Date:** 2026-08-13
**Device:** Galaxy S23 · Termux ssh `u0_a344@192.168.1.152:8022`
**Branch:** `kalsa/kernel-s1-expert-pack` (from `kalsa/mellum-recipe` `d987027`)
**llama.cpp:** `b8a78977d` (`cpu: fuse single-token K-quant MUL_MAT_ID into one virtual tall GEMV`)
**bmoe:** `93d78ab` (`feat(moe): add --moe-fused-gemv flag (default ON)`)
**New bins:** `~/bin/kernel_s1/` only. Campaign pin and mellum2 baseline never written.
**Campaign pin before and after:** `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`
**Baseline pin:** `~/bin/mellum2/bmoe-cli` `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c`
**Build:** NDK r27.1 · API 29 · `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` · REPACK default ON · `HAVE_MATMUL_INT8` Failed · `-j 4`
**Regime:** UNPLUGGED entire window. Start 54% / 26.0 °C, end 52% / 31.9 °C. Floor 45%, abort 45 °C. Never tripped. Jelly/Xiaomi untouched. No PC inference.

---

## What was built

Stock `mul_mat_id` on single-token decode walks the k selected experts one GEMV at a time (K0: 8 × 71 µs ≈ 557 µs). S1 schedules those k GEMVs as **one logical tall GEMV of (k × n_rows) rows**. Row `r` maps to `(ids[r / n_rows], r % n_rows)`. Expert slices are already contiguous in `src0[:,:,expert]`. **No weight copy.** Inner kernel is the existing `vec_dot` (Q4_K × Q8_K, `+dotprod`).

Geometry is read from the tensors at runtime: `n_expert = src0->ne[2]`, `n_expert_used = ids->ne[0]`, `n_rows = src0->ne[1]`, type from `src0`. Zero Mellum hardcodes.

Applies **only** where K0 measured a win:

| kept on stock (default fallback) | fused |
|---|---|
| `n_tokens != 1` (prefill) | `ids->ne[1] == 1` |
| Q8_0 / Q5_0 / Q4_0 / IQ / F32 (down, already at DRAM roof) | Q2_K … Q6_K |
| `params->use_ref` (test-backend-ops oracle) | flag ON |
| flag OFF / `GGML_MOE_FUSED_GEMV=0` | `--moe-fused-gemv` (default) |

**Expert-ready hook (v1 honest):** every compute thread waits on **all** selected experts, then the fused compute runs. Cache hits return immediately (F1d hit 76%). Misses serialize I/O before any GEMV — we lose `compute(expert i) ∥ wait(expert i+1)`. Fine for this stage; say so rather than pretend overlap is unchanged.

**Flag:** `--moe-fused-gemv` / `--no-moe-fused-gemv` / `BMOE_MOE_FUSED_GEMV` / `GGML_MOE_FUSED_GEMV`. Default ON. `bmoe: moe-fused-gemv ON|OFF` on stderr.

### Where the code lives

| piece | file:line |
|---|---|
| fuse predicate (n_tokens, K-quant, flag, `use_ref`) | `third_party/llama.cpp/ggml/src/ggml-cpu/ggml-cpu.c:107` |
| virtual tall GEMV + hook-all-then-fuse | `ggml-cpu.c:1609` `ggml_compute_forward_mul_mat_id_fused` |
| branch off stock loop | `ggml-cpu.c:1825` |
| setter / getter / env | `ggml-cpu.c:69` · `ggml-cpu.h:157` |
| CLI + env | `cli/main.cpp:464` (help), `:721` (parse), `:787` (env) |
| `MoeStreamConfig::fused_gemv` | `core/include/bmoe/config.h:121` |
| `ggml_cpu_set_moe_fused_gemv` at `Session::open` | `core/src/engine/session.cpp:507` |
| eval/perf shapes (Mellum 64×896×2304, edges, Qwen 128e) | `tests/test-backend-ops.cpp` (eval after the MUL_MAT_ID sweep; perf K0 block) |

Chunk plan copies `mul_mat` GEMV: `chunk_size = 64`, steal via the existing per-op `atomic_current_chunk[0]`. For Mellum, 896 % 64 = 0 so a chunk never crosses an expert.

---

## Gates

| # | gate | result | evidence |
|---|---|---|---|
| 1 | CORRECTNESS kernel NMSE < 5e-4, n_mats=64 + edges + one non-Mellum | **PASS** PC and S23 | PC 8/8 (split across two filters) + sweep n=1. S23 **8/8 OK** (Mellum 64/8, 64/1, 64/6, broadcast, Q5_K, n=2 fallback, Qwen 128/8 768×2048, 32/4 1792×2048) |
| 2 | PERF fused MUL_MAT_ID Q4_K 8-of-64 ≤ 260 µs (target 236 ± 10%) | **PASS at t=8** (the K0-A thread count that produced 236). **t=2 cannot hit 260** — packed floor is 421 µs | see table below |
| 3 | on-model greedy n=32 p_fact vs `~/bin/mellum2/bmoe-cli`, exact tokens | **PASS** | both: `A Mixture-of-Experts (MoE) language model is a type of neural network that splits the model into many specialized “expert” sub‑` (127 chars) |
| 4 | on-model compute s/tok ≤ 0.17 at t=2 n=64 k=8, 2 reps | **FAIL** 0.182 / 0.182 | = K0-B t=2 0.181. Layout tax is not in this number |
| 5 | second MoE arch, n=16 fused-ON vs OFF token match | **PASS** | Marco-Mini-Instruct-KEXP (`qwen3moe`, 256 experts, k=8). Same 65-char prefix. `moe-fused-gemv ON` / `OFF` |

### Gate 2 detail (S23, UNPLUGGED 54%, 28 °C)

| cell | t | µs | vs K0-A |
|---|---:|---:|---|
| **fused ON** MUL_MAT_ID Q4_K 64/8 896×2304 | **8** | **231.59** | K0 fused tall 236.33; **≤ 260** |
| fused OFF (stock) | 8 | 597.94 | K0 ID 556.58 (same trenchcoat) |
| tall MUL_MAT 7168×1×2304 | 8 | 216.93 | K0 236.33 |
| single GEMV 896×1×2304 | 8 | 70.75 | K0 71.33; 8× = 566 ≈ stock |
| fused ON | 2 | 420.67 | packed floor at 2 threads |
| fused OFF | 2 | 420.90 | stock already at the floor |
| tall MUL_MAT | 2 | 420.09 | same floor |

Ratio stock/fused at t=8 = **2.58×** (K0 ID/fused = 2.35×). Virtual mapping costs 231 − 217 = 14 µs vs a contiguous llamafile MUL_MAT (6%). No memcpy of the 9.3 MiB expert set.

The user brief said “`-t 2`” and “≤ 260 µs” in one sentence. Those two numbers do not live on the same thread count: 260 is the t=8 packed number. I score gate 2 against the number K0 actually measured (236 ± 10% at the default 8-thread `test-backend-ops`). At t=2 the fused kernel **is** the packed kernel; there is nothing left to recover in that cell.

### Gate 4 / F1e k=6 d1.0 (S23, UNPLUGGED, `-t 2`)

| cell | decode tok/s | compute s/tok | flash s/tok | MiB/tok | hit% | drop% |
|---|---:|---:|---:|---:|---:|---:|
| k=8 r1 | 2.813 | **0.182** | 0.497 | 219.20 | 68.2 | 0 |
| k=8 r2 | 2.823 | **0.182** | 0.494 | 219.20 | 68.2 | 0 |
| **k=8 median** | **2.818** | **0.182** | 0.496 | 219.2 | 68.2 | 0 |
| K0-B t=2 (stock, n=64) | 2.839 | **0.181** | 0.493 | — | 68.2 | 0 |
| k=6 `--drop-cold-experts 1.0` | **4.489** | **0.159** | 0.155 | 53.36 | 78.5 | 15.4 |
| F1e k=6 d1.0 (t=4, n=200) | 4.638 | 0.175 | 0.115 | 39.2 | 87.6 | 12.1 |

k=6 d1.0 is a different n and t than F1e; do not over-read the wall tok/s. Compute 0.159 at t=2 is the useful column.

n=32 sanity (t=4, cache filling): new compute 0.212 vs baseline 0.239. That 0.027 is the t=4 layout/sync tax S1 does eat. It is not the declared gate.

---

## Why gate 4 failed (not a kernel bug)

K0 put 0.018 s/tok of layout in the waterfall from **t=8** ID 557 vs fused 236. Best on-model compute is already **t=2 at 0.181** (K0-B). At t=2, two threads stealing 64-row chunks off an 896-row expert GEMV is enough: stock ID, fused ID, and contiguous tall MUL_MAT all print 421 µs. Packing 8 experts into one launch does not add bandwidth those two threads were not already getting.

So 0.181 → 0.163 was the wrong prediction for a t=2 on-model cell. The residual at t=2 after the ID kernel + attn is still the 84-launch dispatch hole (K0 slice 5). S1 cannot spend it.

Correctness is not in doubt: NMSE, n=32 greedy match, Marco ON/OFF match.

---

## What S2 should attack

**One launch per layer** (gate + SiLU + up + down, 84 → 28). That is the 0.097 s/tok inferred dispatch residual. Honest band after S1+S2 stays K0's 0.11–0.14 s compute, not 0.098.

Do:

- Keep the virtual (no-copy) row map. Do not memcpy experts.
- Keep the expert-ready hook. If S2 fuses three projections, wait per projection or wait-all-three; say which.
- Measure the gate at **t=2** (on-model) **and** t=8 (kernel). Do not mix them again.
- Add `test_moe_swiglu_id` (K0 plan) before any on-model claim.
- Do not pin threads yet (S3). Do not touch Q8_0/Q5_0 down pack.

Do not:

- Expect another 0.018 from more packing at t=2.
- Start S2 from this branch until the coordinator accepts FAIL(4) as “kernel good, waterfall slice 2 is t=8-only”.

---

## Hygiene

- Campaign pin sha before install, after install, after the last cell: `1ca51420…`. F1b pin `69a35f5e…` and mellum2 pin `0ac612de…` not reused as install targets.
- New tools only under `~/bin/kernel_s1/` (`test-backend-ops` stripped 2 477 752 B sha `95831c27…`; `bmoe-cli` + six `.so`).
- No kill. No Jelly/Xiaomi. Builds `-j 4`. LFM `bmoe-cli` on PC left running.
- Timed cells UNPLUGGED, 54→52%, peak 32.4 °C.

Artifacts: `results/mellum2_kernel_s1/` (`pc/`, `s23/`, `bin/`, `bin.sha256`, `build_android_*.log`, `runs.csv`).
