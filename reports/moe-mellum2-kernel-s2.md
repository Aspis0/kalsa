# Mellum2 KERNEL S2 — fused single-token MoE SwiGLU FFN (one launch per layer)

**CORRECTNESS_FAIL · S2_UNGATED.** Device NMSE 7/7 and n=32 greedy prefix match. n=256 fused ON vs OFF diverges at generation character **677** (word 110: `(or` vs `(and`). Timed gate cells were not started. The compute gate (PASS ≤ 0.14 / PARTIAL 0.14–0.17 / FAIL > 0.17) is **unscored**.

**Date:** 2026-08-14
**Device:** Galaxy S23 · Termux ssh `u0_a344@192.168.1.152:8022` · adb `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
**Branch:** BigMoeOnEdge `kalsa/kernel-s2-layer-fuse` @ `0c54a27` (not rebased, not pushed)
**llama.cpp:** `74e37a625` (`cpu: fuse single-token MoE SwiGLU FFN into one launch`)
**New bins:** `~/bin/kernel_s2/` only + wrapper `~/bin/bmoe-cli-kernel-s2`. Campaign pin and mellum2 / kernel_s1 never written.
**Campaign pin before, after install, after stop:** `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`
**mellum2 pin:** `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c` (untouched)
**kernel_s1 pin:** `559bc59d341441473d3a4e5e0876991cbec90b46d5bbf0b884aeb8a4651b7a73` (untouched)
**Build:** NDK r27.1 · API 29 · `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` · REPACK default ON · `HAVE_MATMUL_INT8` Failed · `-j 4` · trees `build-android-kernel-s2` (bmoe-cli) + `build-android-kernel-s2-ops` (test-backend-ops)
**Regime:** UNPLUGGED entire window. Start 90% / 29.4 °C, stop 87% / 36.2 °C. Floor 45%, abort 43 °C. Never tripped. Jelly/Xiaomi untouched. No PC inference.
**Screen:** `mWakefulness=Awake` on every adb `dumpsys power` poll. Termux `dumpsys` returns empty (SELinux) — column filled from adb.

---

## What was built (from the impl report)

Backend-level fusion of the per-layer single-token MoE SwiGLU FFN into **one ggml CPU launch**. No new `GGML_OP`. Geometry is read from tensors at runtime (no 64 / 8 / 896 / 2304 / 28 in the kernel). Q8_0/Q5_0 packing, i8mm, and REPACK untouched.

| repo | branch | commit | message |
|---|---|---|---|
| `third_party/llama.cpp` | `kalsa/kernel-s2-layer-fuse` | `74e37a625` | `cpu: fuse single-token MoE SwiGLU FFN into one launch` |
| BigMoeOnEdge | `kalsa/kernel-s2-layer-fuse` | `0c54a27` | `feat(moe): add --moe-fused-ffn flag (default ON)` |

Matcher requires five consecutive compute nodes `MUL_MAT_ID, MUL_MAT_ID, GLU(SWIGLU split), MUL_MAT_ID, MUL`, `ids->ne[1]==1` (prefill stays stock), K-quant gate/up, any down with a `vec_dot`. Optional VIEW/ADD reduce tail. `ggml_can_fuse` is not used (siblings + shape change).

Fused compute is one launch with internal barriers: quantize hidden → virtual tall GEMV of `k * n_ff` rows (gate `vec_dot` + up `vec_dot` + `ggml_vec_swiglu_f32` per row) → quantize hidden_ff → steal over `n_embd` down rows with weight reduce. Expert-ready hook is **wait-all-three** (gate + up + down) before any weight row is read. No `compute(i) ∥ wait(i+1)` overlap.

Flag: `--moe-fused-ffn` / `--no-moe-fused-ffn` / `BMOE_MOE_FUSED_FFN` / `GGML_CPU` setter. Default ON. `use_ref` keeps the test oracle on the stock unfused graph.

PC: `test-backend-ops test -b CPU -o MOE_SWIGLU_ID` → **7/7** (impl report). No PC inference. No Android build until this night.

---

## Phase 1 — correctness on device

### 1a. Kernel NMSE — PASS

```
test-backend-ops test -b CPU -o MOE_SWIGLU_ID
```

S23, 8 threads (harness default), ~56 s:

| case | result |
|---|---|
| Mellum-class Q4_K/Q4_K/Q8_0 64/8/1 2304×896 | OK |
| Q5_0 down | OK |
| k=1 | OK |
| k=6 | OK |
| n=2 must NOT fuse | OK |
| Qwen3moe-class 128/8/1 768×2048 | OK |
| cheap edge 32/4/1 256×256 | OK |

**7/7 tests passed. Backend CPU: OK.** Raw: `results/kernel_s2/s23/p1a_ops.txt`.

### 1b. Greedy n=32 vs S1 prefix — PASS

Same flags as S1 gate 3: `-t 4 --n-expert-used 8 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096`, fused ON, `p_fact`, fadvise first.

Generated prefix matches S1 exactly:

`A Mixture-of-Experts (MoE) language model is a type of neural network that splits the model into many specialized “expert” sub‑`

stderr: `bmoe: moe-fused-ffn ON`. decode 2.286 tok/s, compute 0.207, hit 60.3% (cache filling). n=32 is not a timed gate.

### 1c. Greedy n=256 fused ON vs OFF — FAIL

Same flags, n=256, fadvise between cells. Both hit EOS before the cap (ON 221 tokens, OFF 213).

The entire first paragraph is byte-identical. Divergence starts in the first bullet:

| | text |
|---|---|
| common prefix (677 chars) | `…The router evaluates the current token (` |
| **ON** | `or context) and assigns it to a few pre‑selected experts, ensuring that only the most relevant sub‑models are used for each prediction.` |
| **OFF** | `and often its context) and assigns it to a few selected experts, ensuring that only the most relevant sub‑models are used.` |

- first differing **character: 677**
- first differing **word: 110** (`(or` vs `(and`)
- first differing **byte** in the extract file (prompt included): **1037**

n=32 cannot see this. That is why the review asked for n=256.

Possible causes, not separated tonight:

1. Accumulated fused-vs-stock float error (kernel NMSE budget is 5e-4) flipping a near-tie greedy argmax.
2. Streamer / cache / hook non-determinism (cold fadvise between the two cells; different expert-load order).

An ON-vs-ON n=256 would split (1) from (2). Not run: the brief said STOP.

Raw: `results/kernel_s2/s23/p1c_on_stdout.txt`, `p1c_off_stdout.txt`, `p1c_diff.txt`, `p1c_diff_pos.txt`.

---

## Phase 2 — gate cells

**Not run.** Brief: identical n=256 or STOP.

Intended matrix (for the next attempt, after the drift is classified):

- k6d065: fused OFF t2 (re-anchor) → ON t2 → ON t4 → ON t6 · 2 reps · n=200
- k6d1.0: fused OFF t2 → ON t2 → ON t4 · 2 reps · n=200
- fadvise DONTNEED between cold cells · UNPLUGGED · floor 45% · abort 43 °C · column `screen`

### Unofficial numbers from the n=256 correctness cells (t=4, k=8, no drop)

These are **not** the gate. Different n, different k, cache still the F1d geometry, one rep each, EOS not n=200.

| cell | decode tok/s | compute s/tok | flash s/tok | MiB/tok | hit% | RSS MiB | batt | temp | screen |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| fused ON | 2.730 | **0.179** | 0.419 | 179.10 | 77.5 | 2958 | 88→88 | 33.3→34.3 | Awake |
| fused OFF | 3.046 | 0.204 | 0.426 | 180.67 | 77.2 | 2958 | 88→87 | 34.3→36.2 | Awake |
| S1 t=2 k=8 n=64 (ref) | 2.818 | 0.182 | 0.496 | 219.2 | 68.2 | — | — | — | — |
| K0-B t=2 / t=4 | 2.839 / 2.732 | 0.181 / 0.236 | — | — | 68.2 | — | — | — | — |

Compute ON 0.179 vs OFF 0.204 is a real-looking −0.025 s/tok (−12%) at t=4. That is the dispatch-slice direction S2 was supposed to attack (K0 slice 5 = 0.097). It is still **above 0.17**, so even if we scored this cell it would be **S2_FAIL**. Wall tok/s went the other way because flash + overlap dominate (stall 0.166 ON vs 0.105 OFF). Do not read 2.730 vs 3.046 as “fused is slower compute”.

---

## Verdict

| gate | result | evidence |
|---|---|---|
| 1a kernel NMSE 7/7 on S23 | **PASS** | `p1a_ops.txt` |
| 1b n=32 greedy vs S1 prefix | **PASS** | `p1b_gen.txt` |
| 1c n=256 ON vs OFF identical | **FAIL** | first diff char 677 / word 110 |
| compute s/tok ≤ 0.14 / 0.14–0.17 / > 0.17 | **UNGATED** | cells not run |
| Xiaomi relative A/B | **NOT RUN** | S23 phases not done |

**S2_UNGATED / CORRECTNESS_FAIL.** No S2_PASS / S2_PARTIAL / S2_FAIL on the compute number.

Best *unofficial* compute: **0.179 s/tok** fused ON t=4 k=8. Best *unofficial* wall: **3.046 tok/s** fused OFF t=4 k=8. Neither is a campaign cell.

---

## Xiaomi tail

Not run. Prerequisite was “S23 phases DONE”. They are not.

---

## Hygiene

- Campaign pin sha before install, after install, after stop: `1ca51420…`. mellum2 and kernel_s1 never used as install targets.
- New tools only under `~/bin/kernel_s2/` (`test-backend-ops` stripped 2 490 912 B sha `581aa153…`; `bmoe-cli` 6 388 664 B sha `71f3556d…` + six `.so`).
- No kill of foreign work. No Jelly/Xiaomi. Builds `-j 4`.
- Timed cells would have been UNPLUGGED; we never reached them. Correctness ran UNPLUGGED 90→87%, peak 36.2 °C.
- `screen` column: adb `mWakefulness=Awake` at 00:24, 00:25, 00:27, 00:29.

Artifacts: `results/kernel_s2/` (`bin/`, `s23/`, `bin.sha256`, `campaign.sha256.before`, `campaign.sha256.after`, `runs.csv`, `build_android*.log`).

DONE
