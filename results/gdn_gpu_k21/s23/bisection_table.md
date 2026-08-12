# K2.1 bisection + isolation

All greedy: prompt `The capital of France is`, `--temp 0 -s 42 -n 32 -no-cnv -st -c 512`.
Qwen3.5-2B: 24 trunk layers, `full_attention_interval=4` → layers 3,7,11,15,19,23 FULL, rest GDN.
`n-gpu-layers` offloads from the end; ngl=1 is output only (tied `token_embd.weight` Q6_K + `output_norm`).

| tag | ngl | extra | first line | ok |
|---|---:|---|---|---|
| ngl0_cpu | 0 | — | Thinking Process: | YES |
| ngl1_faoff | 1 | `-fa off` | Here're her thoughts through her search engine… | NO |
| ngl2_faoff | 2 | `-fa off` (layer 23 FULL + output) | search-engine garbage | NO |
| ngl3_faoff | 3 | `-fa off` (layer 22 GDN + 23 FULL + output) | garbage | NO |
| greedy_gpu_faoff | 99 | `-fa off` | search-engine garbage | NO |
| iso_norm_cpu_lmhead_gpu | 1 | `-ot output_norm.weight=CPU` | search-engine garbage | NO |
| iso_norm_gpu_lmhead_cpu | 0 | `-ot output_norm.weight=OpenCL` | Thinking Process: | YES |
| iso_ngl99_lmhead_cpu | 99 | `-fa off -ot token_embd.weight=CPU` | Thinking Process: | YES |

First failing N is **1** (output layer only). Transformer GPU (GDN + non-flash attn) is healthy once the tied Q6_K lm_head stays on CPU.

Note: first bisection attempt used default `n_ctx=262144` (3 GiB F16 KV) and was killed; all scored runs use `-c 512`. First-token garbage is independent of allocated ctx.
