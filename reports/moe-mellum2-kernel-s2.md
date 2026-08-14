# Mellum2 KERNEL S2 — fused single-token MoE SwiGLU FFN (one launch per layer)

**DETERMINISTIC_REORDER · S2_PARTIAL.** Device NMSE 7/7 and n=32 greedy prefix match. n=256 fused ON vs OFF still diverges at generation character **677** (`(or` vs `(and`), but ON==ON and OFF==OFF (byte-identical, two back-to-back reps each). That is fused summation-order, not a race. Gate cells ran. Best fused-ON compute **0.1585 s/tok** (k=6 drop=1.0 t=2) sits in the 0.14–0.17 band. ON is slower than OFF at every same-t pair. pending numerics policy (deterministic reorder, ON!=OFF at n>=110 tokens).

**Date:** 2026-08-14
**Device:** Galaxy S23 · Termux ssh `u0_a344@192.168.1.152:8022` · adb `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
**Branch:** BigMoeOnEdge `kalsa/kernel-s2-layer-fuse` @ `0c54a27` (not rebased, not pushed)
**llama.cpp:** `74e37a625` (`cpu: fuse single-token MoE SwiGLU FFN into one launch`)
**New bins:** `~/bin/kernel_s2/` only + wrapper `~/bin/bmoe-cli-kernel-s2`. Campaign pin and mellum2 / kernel_s1 never written.
**Campaign pin before, after install, after stop:** `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`
**mellum2 pin:** `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c` (untouched)
**kernel_s1 pin:** `559bc59d341441473d3a4e5e0876991cbec90b46d5bbf0b884aeb8a4651b7a73` (untouched)
**Build:** NDK r27.1 · API 29 · `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` · REPACK default ON · `HAVE_MATMUL_INT8` Failed · `-j 4` · trees `build-android-kernel-s2` (bmoe-cli) + `build-android-kernel-s2-ops` (test-backend-ops)
**Regime:** UNPLUGGED entire window. Correctness 90→87% / 29.4→36.2 °C. Phase A+B 86→75% / 31.2→38.9 °C. Floor 45%, abort 43 °C. Never tripped. Jelly/Xiaomi untouched. No PC inference. No rebuild tonight.
**Screen:** Termux `dumpsys` returns empty (SELinux) — column filled from host adb. Phase 1 (earlier tonight): Awake. Phase A: Dozing. Phase B: Awake (KEYCODE_WAKEUP before first gate cell); Dozing only on the post-`GATES_DONE` poll.

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

Possible causes, separated in Phase A (below): accumulated fused-vs-stock float error flipping a near-tie greedy argmax. Not a race.

Raw: `results/kernel_s2/s23/p1c_on_stdout.txt`, `p1c_off_stdout.txt`, `p1c_diff.txt`, `p1c_diff_pos.txt`.

---

## Phase A — determinism triage (same P1C config, n=256, temp 0)

Two fused-ON and two fused-OFF back-to-back, fadvise DONTNEED between cells. Same prompt, `-t 4 --n-expert-used 8 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096`.

| pair | identical? | bytes | first_diff_byte | notes |
|---|---|---:|---:|---|
| ON r1 vs ON r2 | **yes** | 1435 / 1435 | — | decode 2.755 / 2.738, compute 0.177 / 0.176 |
| OFF r1 vs OFF r2 | **yes** | 1393 / 1393 | — | decode 3.038 / 3.057, compute 0.200 / 0.200 |
| ON r1 vs OFF r1 | **no** | 1435 / 1393 | **1037** | `(or context)` vs `(and often its context)` — same locus as P1C |

**VERDICT: DETERMINISTIC_REORDER.** ON==ON and OFF==OFF (harness + stock path are deterministic on this device). ON!=OFF is fused summation-order: NMSE is in budget, a near-tie logit flips at generation word 110. Not a race. Do not treat ON and OFF transcripts as interchangeable at n≥110 tokens.

Screen Phase A: Dozing (adb). UNPLUGGED 86→84%, 31.2→35.7 °C. Pin MATCH before and after.

Raw: `results/kernel_s2/s23/phaseA/` (`on_r{1,2}_gen.txt`, `off_r{1,2}_gen.txt`, `diff_on_on.txt`, `diff_off_off.txt`, `diff_on_off.txt`, `verdict.txt`, `VERDICT`).

---

## Phase 2 — gate cells

Ran after DETERMINISTIC_REORDER. Mellum2 Q4_K_M, n=200, temp 0, 2 reps/cell, fadvise DONTNEED between cold cells. UNPLUGGED 84→75%, floor 45% not hit, abort 43 °C not hit (peak 38.9). Screen Awake for every gate cell (host adb). CSV: `results/kernel_s2/runs.csv` (PLAN §8 columns + `screen`).

Harness note: first ON-slower retry crashed (`set -u`, `run_bmoe` called without `n=200`). Resume script started at that retry; completed cells were not re-run. Second retry (k6d10) had the fixed arity and ran clean.

### k6d065 (k=6, `--drop-cold-experts 0.65`)

| cell | fused | t | decode tok/s | compute s/tok | flash s/tok | MiB/tok | hit% | RSS | batt | temp | screen |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| OFF t2 r1 | off | 2 | 3.846 | 0.163 | 0.250 | 99.70 | 80.7 | 2954 | 84→83 | 33.0→34.3 | Awake |
| OFF t2 r2 | off | 2 | 3.827 | 0.163 | 0.250 | 99.70 | 80.7 | 2970 | 83→83 | 34.3→34.3 | Awake |
| **OFF t2 med** | off | 2 | **3.837** | **0.163** | 0.250 | 99.70 | 80.7 | — | — | — | Awake |
| ON t2 r1 | on | 2 | 3.368 | 0.173 | 0.248 | 99.79 | 80.0 | 2962 | 83→82 | 34.3→35.7 | Awake |
| ON t2 r2 | on | 2 | 3.354 | 0.174 | 0.247 | 99.79 | 80.0 | 2948 | 82→82 | 35.7→35.7 | Awake |
| **ON t2 med** | on | 2 | **3.361** | **0.1735** | 0.248 | 99.79 | 80.0 | — | — | — | Awake |
| ON t2 retry | on | 2 | 3.370 | 0.173 | 0.251 | 99.79 | 80.0 | 2930 | 81→81 | 34.6→34.6 | Awake |
| ON t4 r1 | on | 4 | 3.523 | 0.163 | 0.246 | 99.79 | 80.0 | 2959 | 81→80 | 34.6→35.8 | Awake |
| ON t4 r2 | on | 4 | 3.525 | 0.160 | 0.250 | 99.79 | 80.0 | 2966 | 80→80 | 35.8→35.8 | Awake |
| **ON t4 med** | on | 4 | **3.524** | **0.1615** | 0.248 | 99.79 | 80.0 | — | — | — | Awake |
| ON t6 r1 | on | 6 | 1.529 | 0.457 | 0.390 | 99.79 | 80.0 | 2928 | 80→79 | 35.8→36.9 | Awake |
| ON t6 r2 | on | 6 | 1.543 | 0.444 | 0.395 | 99.79 | 80.0 | 2928 | 79→78 | 36.9→37.8 | Awake |
| **ON t6 med** | on | 6 | **1.536** | **0.4505** | 0.393 | 99.79 | 80.0 | — | — | — | Awake |

Re-anchor OFF t2 compute **0.163** vs K0-B / S1 t2 k=8 0.181 (different k and drop — expected). ON t2 is **slower** than OFF (0.1735 vs 0.163). Retry 0.173, accepted honestly.

### k6d1.0 (k=6, `--drop-cold-experts 1.0`)

| cell | fused | t | decode tok/s | compute s/tok | flash s/tok | MiB/tok | hit% | RSS | batt | temp | screen |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| OFF t2 r1 | off | 2 | 5.103 | 0.149 | 0.114 | 39.20 | 87.6 | 2943 | 78→78 | 37.8→37.8 | Awake |
| OFF t2 r2 | off | 2 | 5.198 | 0.147 | 0.109 | 39.20 | 87.6 | 2971 | 78→77 | 37.8→37.8 | Awake |
| **OFF t2 med** | off | 2 | **5.151** | **0.148** | 0.112 | 39.20 | 87.6 | — | — | — | Awake |
| ON t2 r1 | on | 2 | 4.477 | 0.161 | 0.121 | 41.14 | 87.8 | 2965 | 77→77 | 37.8→37.8 | Awake |
| ON t2 r2 | on | 2 | 4.591 | 0.156 | 0.123 | 41.14 | 87.8 | 2957 | 77→76 | 37.8→38.7 | Awake |
| **ON t2 med** | on | 2 | **4.534** | **0.1585** | 0.122 | 41.14 | 87.8 | — | — | — | Awake |
| ON t2 retry | on | 2 | 4.544 | 0.155 | 0.129 | 41.14 | 87.8 | 2940 | 76→76 | 38.7→38.7 | Awake |
| ON t4 r1 | on | 4 | 4.518 | 0.160 | 0.118 | 41.14 | 87.8 | 2946 | 76→76 | 38.7→38.7 | Awake |
| ON t4 r2 | on | 4 | 4.113 | 0.174 | 0.138 | 41.14 | 87.8 | 2963 | 76→75 | 38.7→38.9 | Awake |
| **ON t4 med** | on | 4 | **4.316** | **0.167** | 0.128 | 41.14 | 87.8 | — | — | — | Awake |

ON t2 again slower than OFF (0.1585 vs 0.148). Retry 0.155, accepted. t4 r2 is the only noisy pair (thermal 38.7–38.9 °C); both reps kept.

### Unofficial n=256 correctness cells (t=4, k=8, no drop) — not the gate

| cell | decode tok/s | compute s/tok | flash s/tok | MiB/tok | hit% | screen |
|---|---:|---:|---:|---:|---:|---|
| fused ON (P1C) | 2.730 | 0.179 | 0.419 | 179.10 | 77.5 | Awake |
| fused OFF (P1C) | 3.046 | 0.204 | 0.426 | 180.67 | 77.2 | Awake |
| Phase A ON med | 2.747 | 0.1765 | 0.421 | 179.10 | 77.5 | Dozing |
| Phase A OFF med | 3.048 | 0.200 | 0.427 | 180.67 | 77.2 | Dozing |
| S1 t=2 k=8 n=64 | 2.818 | 0.182 | 0.496 | 219.2 | 68.2 | — |
| K0-B t=2 / t=4 | 2.839 / 2.732 | 0.181 / 0.236 | — | — | 68.2 | — |

At t=4 k=8 no-drop, ON compute still beats OFF (0.177 vs 0.200). That is the unofficial dispatch-slice direction. It is **not** the declared gate matrix, and it is still above 0.17.

---

## Verdict

| gate | result | evidence |
|---|---|---|
| 1a kernel NMSE 7/7 on S23 | **PASS** | `p1a_ops.txt` |
| 1b n=32 greedy vs S1 prefix | **PASS** | `p1b_gen.txt` |
| 1c n=256 ON vs OFF identical | **FAIL** (classified) | first diff char 677 / word 110; Phase A = DETERMINISTIC_REORDER |
| Phase A ON==ON and OFF==OFF | **PASS** | `s23/phaseA/verdict.txt` |
| compute s/tok ≤ 0.14 / 0.14–0.17 / > 0.17 | **S2_PARTIAL** | best fused ON 0.1585 (k6d10 t2) |
| Xiaomi relative A/B | **NOT RUN** | out of scope tonight |

**S2_PARTIAL.** Best fused-ON compute **0.1585 s/tok**, best fused-ON wall **4.534 tok/s**, config **fused ON · k=6 · drop=1.0 · t=2 · n=200**.

pending numerics policy (deterministic reorder, ON!=OFF at n>=110 tokens) — final adoption needs a PPL/quality gate, not tonight.

Honesty that the PARTIAL band is not an S2 win:

- At every same-t pair, fused ON is **slower** than OFF by ~0.010 s/tok compute (k6d065 t2 0.1735 vs 0.163; k6d10 t2 0.1585 vs 0.148). Retries confirmed. Accept.
- k6d10 OFF t2 is already 0.148 — drop-cold + k=6, not the fused kernel.
- t=6 is thermal/oversub (0.45 s/tok). Ignore as a kernel number.
- The 0.097 dispatch slice S2 was supposed to spend did not show up on the t=2 on-model cells. The only ON-faster-compute picture is the unofficial t=4 k=8 no-drop pair (0.177 vs 0.200), still FAIL vs 0.17.

---

## Xiaomi tail

Not run. Out of scope tonight (Jelly/Xiaomi reserved).

---

## Hygiene

- Campaign pin sha before install, after install, after Phase A, after Phase B: `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`. mellum2 and kernel_s1 never used as install targets. No rebuild. Pin file never written.
- New tools only under `~/bin/kernel_s2/` (`test-backend-ops` stripped 2 490 912 B sha `581aa153…`; `bmoe-cli` 6 388 664 B sha `71f3556d…` + six `.so`).
- No kill of foreign work. No Jelly/Xiaomi. No `build-llama-pc` interference.
- Timed cells UNPLUGGED. Correctness 90→87%, peak 36.2 °C. Phase A+B 86→75%, peak 38.9 °C. Floor 45% / abort 43 °C never tripped.
- `screen` column: host adb `mWakefulness`. Phase 1 Awake; Phase A Dozing; Phase B Awake. Continuous poller died after the first sample; spot checks in `s23/screen_poll_host.txt`.

Artifacts: `results/kernel_s2/` (`bin/`, `s23/`, `s23/phaseA/`, `logs/`, `bin.sha256`, `campaign.sha256.*`, `runs.csv`, `run_s2_phaseA.sh`, `run_s2_phaseB.sh`, `run_s2_phaseB_resume.sh`).

DONE
