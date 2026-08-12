# K2.1 — Root cause of S23 GPU E2E parity failure (diagnosis only)

Date: 2026-08-12
Device: Galaxy S23, Adreno 740, driver 0676.73
Fork: `BigMoeOnEdge/third_party/llama.cpp` @ `e5605f3bd` (**not modified**; one out-of-tree test patch, reverted)
Artifacts: `results/gdn_gpu_k21/`
Prior: `reports/moe-gdn-k2-e2e.md`, `reports/moe-gdn-k0-op-inventory.md`

## TL;DR

**CONFIRMED.** The K2 greedy garbage (`Here're her thoughts through her search engine` × N) is **not** GDN, not non-flash attention, not KV f16, not state `CPY`.

It is the **tied lm_head** `MUL_MAT` **Q6_K** `[k=2048, m=248320]` on OpenCL. There is no `output.weight`; the GGUF uses `token_embd.weight` type Q6_K, duplicated onto the output device when `-ngl >= 1`.

OpenCL routes that tensor through `use_flat_gemv_for_large_m_q6_K` → `kernel_mul_mv_q6_K_f32_flat` (`kernels/mul_mv_q6_k_f32_flat.cl`). That kernel is numerically wrong on this 740 (`ERR ≈ 9–12`, threshold 5e-4). The Adreno **noshuffle** Q6_K GEMV (`gemv_noshuffle_q6_k_f32.cl`) is **correct** on the same device (m=2048 and m=4096, k=2048, n=1: OK).

Minimal workaround (no source change): `-ngl 99 -fa off -ot token_embd.weight=CPU`. Greedy then matches CPU (`Thinking Process:`).

## 1. Reproduction

Same binary/model as K2. Prompt `The capital of France is`, `--temp 0 -s 42 -n 32 -no-cnv -st -c 512`.

| cell | first line | pp | tg |
|---|---|---:|---:|
| CPU `-ngl 0` | `Thinking Process:` | 13.5 | 7.3 |
| GPU `-ngl 99 -fa off` | `Here're her thoughts through her search engine…` | 11.0 | 2.9 |

K2's 128-token "search engine" loop reproduces at n=32. `-c 512` is required on-device: default `n_ctx=0` → 262144 → 3 GiB F16 KV and swap; first-token garbage does not depend on allocated ctx.

Battery: started ~79% UNPLUGGED 27 °C; ended ~76% UNPLUGGED 29 °C. Plugged was allowed; the phone stayed unplugged above 20%.

## 2. Layer map (Qwen3.5-2B)

GGUF: `block_count=24`, `embedding_length=2048`, `head_count=8`, `head_count_kv=2`, `key_length=value_length=256`, `ssm.state_size=128`, `ssm.group_count=16`, `ssm.time_step_rank=16`, `ssm.inner_size=2048`, `ssm.conv_kernel=4`, `full_attention_interval=4`, **no** `nextn.predict_layers`. `token_embd.weight` = Q6_K `[2048, 248320]`. `output_norm.weight` = F32 `[2048]`. No `output.weight` (tied + `TENSOR_DUPLICATED`).

`i_gpu_start = max(n_layer_all+1-ngl, 0)` (`llama-model.cpp:1292`). Input embeddings stay CPU.

| ngl | on GPU |
|---|---|
| 0 | nothing |
| 1 | output only (`output_norm` + duplicated `token_embd`) |
| 2 | layer 23 FULL attn + output (confirmed `-v`: `layer 23 assigned to device GPUOpenCL`, `offloaded 2/25`) |
| 3 | layer 22 GDN + 23 FULL + output |

FULL layers: 3, 7, 11, 15, 19, 23. Rest GDN.

## 3. Bisection

| N | ok? |
|---:|---|
| 0 (CPU) | YES |
| **1** | **NO** (same search-engine string) |
| 2, 3, 99 | NO (same class of garbage) |

The first transformer layer never has to enter. The bug is in the output slice.

## 4. Isolation (`-ot`)

Buffer types on this binary: `CPU`, `OpenCL`.

| cmd | meaning | ok? |
|---|---|---|
| `-ngl 1 -ot output_norm.weight=CPU` | only tied Q6_K lm_head on GPU | **NO** (search engine) |
| `-ngl 0 -ot output_norm.weight=OpenCL` | only `output_norm` RMS_NORM on GPU | **YES** |
| `-ngl 99 -fa off -ot token_embd.weight=CPU` | all 24 layers + GDN + non-flash attn on GPU, lm_head CPU | **YES** (`Thinking Process:`) |

So: **GDN GPU is fine. Non-flash attn GPU is fine. State writebacks are fine. `output_norm` is fine.** Only the Q6_K lm_head `MUL_MAT` is not.

## 5. Op-level (real shapes)

`test-backend-ops` filter `-o MUL_MAT -p q6_K` on the **K2 binary** (default cases only):

| case | path | result |
|---|---|---|
| `m=1,n=64,k=256` | LM GEMM `mul_mm_q6_k_f32_l4_lm` (`ne11>=32`) | **OK** |
| `m=16,n=1..9,k=256` | flat GEMV (`use_adreno_kernels` false: ne too small) | **FAIL `ERR≈9.01`** (10/11) |

K2's `MUL_MAT -p q4_K` 33/33 never touched this path. That is why GDN/SSM/Q4_K ops passed and E2E still garbaged.

Instrumented `test-backend-ops` (out-of-tree rebuild; patch `results/gdn_gpu_k21/test_q6k_lmhead_shapes.patch`, **reverted from the fork tree**):

| m | n | k | intended path | result |
|---:|---:|---:|---|---|
| 2048 | 1 | 2048 | Adreno noshuffle GEMV | **OK** |
| 4096 | 1 | 2048 | Adreno noshuffle GEMV | **OK** |
| 32768 | 1 | 2048 | flat GEMV (large-M redirect) | **FAIL ERR=11.84** |
| 32768 | 16 | 2048 | flat GEMV | **FAIL ERR=12.18** |
| **248320** | **1** | **2048** | **exact 2B decode lm_head** | **FAIL ERR=12.45** |
| **248320** | **16** | **2048** | **exact 2B short prefill** | **FAIL ERR=12.02** |

First generated token is sampled from **prefill** logits. Short prompt `n_tokens < 32` uses GEMV, not LM GEMM (`ggml-opencl.cpp:18133` `if (ne11 < 32) break;`). Prefill and decode both hit the broken kernel.

## 6. Culprit path (file:line)

Dispatch, all in `ggml/src/ggml-opencl/ggml-opencl.cpp`:

1. `use_flat_gemv_for_large_m_q6_K` **6459–6478**: `true` when `ne[1] >= 32768 && ne[0] >= 2048` (or `ne[1] % 128 != 0`). 2B lm_head is `[2048, 248320]` → **true**. Comment says this is a *perf* redirect away from noshuffle.
2. Adreno Q6_K noshuffle GEMV is then **skipped** **17586–17588**.
3. Convert uses generic `kernel_convert_block_q6_K` (not `_noshuffle`) **8698–8700**; no transpose **8732**.
4. Compute uses `kernel_mul_mv_q6_K_f32_flat` **19052–19066** (`kernels/mul_mv_q6_k_f32_flat.cl`). Adreno launch: `nth0=64, nth1=2, ndst=16`, local `{64,2,1}` **19227–19231**.

The **working** sibling is `kernels/gemv_noshuffle_q6_k_f32.cl` + `kernel_convert_block_q6_K_noshuffle` + the 4-plane transpose **8737–8750**. That path requires `use_adreno_kernels` (`ne0>=512, ne1>=512, ne1%128==0`) — the 2B vocab **satisfies** this (`248320 % 128 == 0`). The large-M predicate steals the tensor anyway.

Small-M Q6_K (e.g. `m=16,k=256`) also uses the flat GEMV because it fails the noshuffle thresholds. Same kernel, same FAIL. So the flat kernel is wrong in general on this 740, not only at vocab size.

## 7. Confidence

**CONFIRMED.**

- E2E breaks at ngl=1 (output only).
- `-ot` splits `output_norm` (OK) from lm_head (broken).
- Full GPU trunk + CPU lm_head matches CPU greedy.
- `test-backend-ops` fails the exact decode shape `Q6_K m=248320 n=1 k=2048` with NMSE ~12.
- Same kernel family fails the default `m=16 n=1 k=256` case; noshuffle controls pass.

Not missing: PPL (superseded by NMSE), `-ctk f32` / `-nkvo` (KV not implicated). Xiaomi 750 still untested (K2 BLOCKED).

## 8. Fix recommendation (do not apply here)

Change class, in order of preference:

1. **Stop the large-M redirect on Adreno when noshuffle is legal.**  
   `use_flat_gemv_for_large_m_q6_K` (`ggml-opencl.cpp:6459`): return `true` only for the odd-`ne1` safety case (`ne1 % 128 != 0`). Drop `ne1 >= 32768 && ne0 >= 2048` (or AND it with `!use_adreno_kernels(...)`).  
   This puts the 2B lm_head back on `gemv_noshuffle_q6_k_f32`, which already passes on this 740. Comment at 6460–6473 already says noshuffle is correct for `ne1 % 128 == 0`; the large-M branch was a speed hack.

2. **Fix `kernels/mul_mv_q6_k_f32_flat.cl` (and/or generic `kernel_convert_block_q6_K`) for Adreno.**  
   Needed for Q6_K shapes that cannot use noshuffle (small `ne0`/`ne1`, or odd vocab). Suspect class: Adreno `REQD_SUBGROUP_SIZE_64` + dispatch local `{64,2,1}` / `N_DST=16` (`ggml-opencl.cpp:19060–19063`, `19227–19231`) vs a 1-D subgroup kernel. Compare with the working noshuffle GEMV. Add the `m=16,n=1,k=256` and `m=32768,n=1,k=2048` cases to the default `test-backend-ops` suite so this cannot regress.

3. **Product workaround until (1)/(2):** `-ot token_embd.weight=CPU`. Leaves GDN + non-flash attn on GPU. Decode will still be CPU-bound on the 248k GEMV (K2 0.27× was this kernel *and* it was wrong).

4. **Do not** treat this as a GDN/`FLASH_ATTN_EXT`/f16-KV bug. K2 flash abort (`sub_group_shuffle_xor` / `map::at`) is a **separate** official-cell crash; `-fa off` is sufficient for the hybrid trunk once the lm_head is correct.

Out of scope but still true from K2: `MUL_MAT_ID` Q4_K is independently broken (MoE / 35B experts stay CPU).

## 9. File map

```
results/gdn_gpu_k21/
  test_q6k_lmhead_shapes.patch          (reverted from fork tree)
  run_greedy.sh  run_bisection.sh  run_isolate.sh
  s23/bisection_table.md
  s23/logs/                             (all cmd/txt/err, op tests, layer map)
reports/moe-gdn-k21-parity.md
```

On device (kept, nothing deleted): `~/gdn_k2/k21/` scripts + logs + `k21/bin/test-backend-ops` (instrumented). K2 binaries in `~/gdn_k2/bin/` untouched.

DONE
