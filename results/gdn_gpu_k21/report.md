# K2.1 task summary — S23 GPU E2E parity diagnosis

## Verdict

**CONFIRMED.** Culprit is the tied Q6_K lm_head `MUL_MAT` on OpenCL, not GDN and not non-flash attention.

## What failed

Qwen3.5-2B-Q4_K_M has no `output.weight`. The lm_head is a GPU duplicate of `token_embd.weight` (**Q6_K `[2048, 248320]`**). Any `-ngl >= 1` puts that tensor on Adreno.

OpenCL then takes `use_flat_gemv_for_large_m_q6_K` (`ggml-opencl.cpp:6459`) because `ne1=248320 >= 32768` and `ne0=2048`, and runs `kernel_mul_mv_q6_K_f32_flat`. That kernel is numerically wrong on Adreno 740 driver 0676.73 (`ERR ≈ 12`). The first sampled token is already garbage, hence the "search engine" loop.

The Adreno **noshuffle** Q6_K GEMV is correct on the same device (`m=2048` and `m=4096`, `k=2048`, `n=1`: OK). The 2B vocab is a legal noshuffle shape (`248320 % 128 == 0`); a perf redirect steals it.

## Minimal evidence

| experiment | result |
|---|---|
| CPU greedy | `Thinking Process:` |
| GPU `-ngl 99 -fa off` | `search engine` loop |
| `-ngl 1` (output only) | already garbage |
| `-ngl 1 -ot output_norm.weight=CPU` | still garbage → lm_head |
| `-ngl 0 -ot output_norm.weight=OpenCL` | healthy → RMS_NORM OK |
| `-ngl 99 -fa off -ot token_embd.weight=CPU` | **healthy** → trunk GPU is fine |
| `test-backend-ops` Q6_K `m=248320,n=1,k=2048` | **FAIL ERR=12.45** |
| same, `m=2048,n=1,k=2048` (noshuffle) | **OK** |
| default Q6_K `m=16,n=1,k=256` (also flat GEMV) | **FAIL ERR=9.01** |

## Fix class (not applied)

1. Gate `use_flat_gemv_for_large_m_q6_K` so Adreno keeps noshuffle when `ne1 % 128 == 0`.
2. Separately fix `kernels/mul_mv_q6_k_f32_flat.cl` for shapes that cannot use noshuffle.
3. Until then: `-ot token_embd.weight=CPU`.

Full write-up: `reports/moe-gdn-k21-parity.md`. Logs: `results/gdn_gpu_k21/s23/logs/`. Fork sources unchanged.

DONE
