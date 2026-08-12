# K2.2 — Q6_K dispatch fix + S23 verification

Date: 2026-08-12
Device: Galaxy S23, Adreno 740, driver 0676.73
Fork: `BigMoeOnEdge/third_party/llama.cpp` branch `kalsa/opencl-q6k-dispatch-fix`
Base: `e5605f3bd` → HEAD `a92a51627`
Artifacts: `results/gdn_gpu_k22/`
Prior: `reports/moe-gdn-k21-parity.md` (CONFIRMED diagnosis), `reports/moe-gdn-k2-e2e.md`

## TL;DR

**Correctness: PASS. Speed (tg ≥ 1.15×): FAIL.**

Recommendation 1 of K2.1 applied. The large-M redirect in
`use_flat_gemv_for_large_m_q6_K` no longer steals even-vocab Q6_K tensors
from the Adreno noshuffle GEMV. The Qwen3.5-2B tied lm_head
`[2048, 248320]` now hits `gemv_noshuffle_q6_k_f32`, which is numerically
correct on this 740.

Greedy `-ngl 99 -fa off` (no `-ot`) matches CPU token-for-token
(`Thinking Process:`). The three added real-shape `MUL_MAT` Q6_K cases PASS.
The first honest 740 decode number with correct output is **5.06 tok/s vs
12.37 tok/s CPU (0.41×)**. Prefill is a small win (1.29×). The 740 with this
backend and `-fa off` does not beat CPU on decode.

## 1. What changed

Nested-git only. Parent `BigMoeOnEdge` / `moe-experiments` not committed.

| commit | summary |
|---|---|
| `32b318aab` | `opencl: do not steal Q6_K noshuffle GEMV for large even-vocab M` |
| `a92a51627` | `tests: add Q6_K lm_head MUL_MAT shapes that must stay on noshuffle` |

Diff: `results/gdn_gpu_k22/fix.diff`.

### 1.1 Dispatch (`ggml/src/ggml-opencl/ggml-opencl.cpp`)

`use_flat_gemv_for_large_m_q6_K` **6459–6482**.

Before (K2.1 culprit):

```
if (ne1 % 128 != 0 && 2-D) return true;          // odd-vocab safety
return ne1 >= 32768 && ne0 >= 2048 && 2-D;       // large-M perf redirect
```

The 2B lm_head is `[ne0=2048, ne1=248320]`, `248320 % 128 == 0`, so it hit
the second return. Callers then skipped noshuffle (`17586–17588`, convert
`8699` / `8732`) and used `kernel_mul_mv_q6_K_f32_flat` (NMSE ~12).

After:

```
if (ne1 % 128 != 0 && 2-D) return true;          // noshuffle cannot take this
return false;                                    // do not steal legal noshuffle
```

Noshuffle preconditions are already enforced by `use_adreno_kernels`
(`6419–6434`: ne0/ne1 thresholds, `ne2==ne3==1`, Q6_K `ne1 % 128 == 0`)
and by `#ifdef GGML_OPENCL_USE_ADRENO_KERNELS` around the Adreno dispatch
block (`17530`). Below-threshold / small-M Q6_K still cannot enter that
block and still uses the flat kernel (K2.3).

The dropped large-M branch was unreachable for any tensor noshuffle cannot
legally take: every shape with `ne1 >= 32768 && ne0 >= 2048 && ne1 % 128 == 0`
already satisfies the Adreno 512 thresholds.

Comment updated. Q4_K large-M helper left alone (out of scope).

### 1.2 Tests (`tests/test-backend-ops.cpp` **8676–8685**)

Default `MUL_MAT` eval cases now include:

| m | n | k | path after fix | gate |
|---:|---:|---:|---|---|
| 248320 | 1 | 2048 | noshuffle (2B decode lm_head) | must PASS |
| 248320 | 16 | 2048 | noshuffle (2B short prefill) | must PASS |
| 32768 | 1 | 2048 | noshuffle (old large-M threshold) | must PASS |

`m=16,n=1,k=256` is **not** a default add — TODO(K2.3) next to the new cases.

## 2. Build

Out-of-tree reuse of `build-android-opencl-k2/`, `-j4`. CMake re-ran because
the ggml commit stamp changed (`e5605f3bd` → `a92a51627`).
`GGML_OPENCL_USE_ADRENO_KERNELS=ON`. Full command + hashes:
`results/gdn_gpu_k22/BUILD_MANIFEST.md`.

| binary | size | sha256 |
|---|---:|---|
| llama-cli | 188022720 | `6b48ee5b1eac7d943f44d3e410f92e9bc5964949dd14fb92d8f104832d938e5d` |
| llama-bench | 126084160 | `2da272069cf9a0601376e5022a676c242c6eb477f3a8ef5a94fb83110299fd7e` |
| test-backend-ops | 24993672 | `e96b7d4c107b9c9dcff50fbdbe51f2ce36a70de5c8b74dae5a02d3b2785261e3` |
| libc++_shared.so | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |

Pushed to S23 `~/gdn_k2/bin_fix/`. On-device sha256 matches. K2 binaries in
`~/gdn_k2/bin/` untouched.

## 3. Correctness (S23)

Battery started 75% UNPLUGGED 27.4 °C; stayed unplugged. Notes:
`results/gdn_gpu_k22/s23/battery_notes.txt`.

### 3.1 `test-backend-ops test -b GPUOpenCL -o MUL_MAT -p q6_K` — **GATE PASS**

Log: `s23/logs/test_MUL_MAT_q6k.txt`. Suite 4/14 (exit 1 = pre-existing small-flat).

| case | result |
|---|---|
| `m=248320,n=1,k=2048` | **OK** |
| `m=248320,n=16,k=2048` | **OK** |
| `m=32768,n=1,k=2048` | **OK** |
| `m=1,n=64,k=256` (LM GEMM, pre-existing) | OK |
| `m=16,n=1..9,k=256` (flat GEMV, 10 cases) | FAIL `ERR≈4–11` (pre-existing, not a gate) |

K2.1 on the same three real shapes, routed to flat: FAIL ERR 11.8–12.5.
After the dispatch change they PASS. That is the op-level proof.

### 3.2 Greedy E2E — **GATE PASS**

Prompt `The capital of France is`, `--temp 0 -s 42 -n 32 -no-cnv -st -c 512`.
No `-ot`. GPU: `-ngl 99 -fa off`.

| cell | first generated line | rest of n=32 | pp | tg |
|---|---|---|---:|---:|
| CPU `-ngl 0` | `Thinking Process:` | identical | 23.3 | 7.3 |
| GPU `-ngl 99 -fa off` | `Thinking Process:` | identical | 17.1 | 4.0 |

Generated body (both):

```
Thinking Process:

1.  **Analyze the Request:** The user is asking a simple factual question: "The capital of France is".

2.
```

K2/K2.1 GPU garbage (`Here're her thoughts through her search engine` × N) is gone.

Logs: `s23/logs/greedy_cpu.txt`, `s23/logs/greedy_gpu_faoff.txt`.

### 3.3 GDN-family regression — **PASS** (no rebuild damage)

| op | result |
|---|---|
| `GATED_DELTA_NET` | **36/36 OK** |
| `SSM_CONV` | **45/45 OK** |
| `L2_NORM` | **20/20 OK** (noncontig = not supported, not FAIL) |
| `SOLVE_TRI` | **24/24 OK** |
| `CUMSUM` | **15/15 OK** |

Same 36 + 104 split as K2. Zero FAIL lines.

## 4. Speed (UNPLUGGED, batt ≥ 45%)

`llama-bench -m <2B> -t 4 -p 128 -n 256 -r 2 -o json`.
CPU 74%→73% 28.3→29.9 °C; GPU 73%→73% 29.9→29.3 °C. Never plugged.

JSON: `s23/logs/bench_cpu.json`, `s23/logs/bench_gpu_faoff.json`.

| cell | pp 128 tok/s (reps) | tg 256 tok/s (reps) |
|---|---:|---:|
| CPU `-ngl 0` | **63.62** (82.29 / 44.95) | **12.37** (11.80 / 12.94) |
| GPU `-ngl 99 -fa off` | **82.26** (82.16 / 82.36) | **5.06** (5.34 / 4.78) |

| ratio GPU/CPU | value | gate |
|---|---:|---|
| pp | 1.29× | n/a |
| tg | **0.41×** | ≥ 1.15× → **FAIL** |

CPU pp has a large first-to-second drop (mmap / thermal). Using K2's CPU tg
11.10 as a cross-session check still gives 5.06/11.10 = 0.46×. Same verdict.

K2 diagnostic (wrong flat kernel, garbage text) was tg 3.00 (0.27×).
Noshuffle is faster than that kernel *and* correct. It is still slower than
CPU decode. Do not treat this as a 740 win.

This is the number that decides the 740's fate with the current OpenCL
backend and `-fa off`: **correct, not faster**.

## 5. Gate verdicts

| gate | verdict |
|---|---|
| Branch + 2 clean commits, parent repos untouched | PASS |
| Three real-shape Q6_K `MUL_MAT` cases PASS | **PASS** |
| Greedy GPU matches CPU (`Thinking Process:`) | **PASS** |
| GDN-family ops still 100% PASS | **PASS** |
| Speed tg GPU/CPU ≥ 1.15× (unplugged) | **FAIL** (0.41×) |

## 6. What remains

### K2.3 — flat Q6_K kernel repair

`kernels/mul_mv_q6_k_f32_flat.cl` (and/or generic `kernel_convert_block_q6_K`)
is still numerically wrong on this 740. Small / odd-`ne1` Q6_K cannot use
noshuffle (`use_adreno_kernels` false, or `ne1 % 128 != 0`) and still FAIL
(`m=16,n=1,k=256` ERR ~4–11). Granite-style odd-vocab lm_heads stay on that
path. Add the small flat case as a default test only after the kernel is
fixed. Dispatch is no longer the bug for even-vocab large M.

### Flash-attn hole (not this task)

Official `-ngl 99` (flash auto) still aborts on this 740:
`sub_group_shuffle_xor` implicit-decl + `map::at` (K2 / K5). `-fa off` is
required for a runnable hybrid trunk. A decode win, if one exists, almost
certainly needs a compiling flash path or a different backend. This fix
does not touch flash.

### Still true from K2, untouched

- `MUL_MAT_ID` Q4_K is independently broken (MoE / 35B experts stay CPU).
- Xiaomi 750 still untested (K2 BLOCKED).
- Product workaround `-ot token_embd.weight=CPU` is no longer needed for
  correctness on this 2B. It would still avoid the (now-correct but slow)
  GPU lm_head if someone wants CPU decode + GPU trunk.

## 7. File map

```
results/gdn_gpu_k22/
  fix.diff
  BUILD_MANIFEST.md
  build_opencl_ndk.log
  bin/                    (sha256s + copies)
  run_k22.sh
  s23/battery_notes.txt
  s23/logs/               (ops, greedy, bench json, battery dumps)
reports/moe-gdn-k22-fix.md
```

On device (kept): `~/gdn_k2/bin_fix/` + `~/gdn_k2/k22/`. K2 `~/gdn_k2/bin/`
untouched.

DONE
