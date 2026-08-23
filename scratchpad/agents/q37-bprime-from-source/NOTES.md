# q37 B′ from source — working notes

PC-only. No device. No git push. Do not modify `BigMoeOnEdge/` WIP.
Do not delete pre-existing files we did not create.

## Model choice (2 + optional 3rd)

| # | model | why |
|---|---|---|
| 1 | **Marco-Mini-Instruct** (MANDATORY) | Product 6.4G KEXP. q36 proved trunk is 228 MB / 6.4 GB but A/B was double-quant. Source = same Q8_0 as original cook (18.36 GB, sha `3287457a…`). |
| 2 | **OLMoE-1B-7B-0924-Instruct** | Small MoE already in `models/` (Q4_K_M 4.21 GB). Fast A/B. Q8_0 source expected ≤8 GB. Different family from Qwen/Marco (AllenAI OLMoE). Control will be cooked KEXP-style (experts Q2_K+Q3_K, trunk Q5_K) from that source — the on-disk file is uniform Q4_K_M, not KEXP. |
| 3 | **LFM2.5-8B-A1B** (optional, do if disk allows after 1–2) | Hybrid MoE (attn + shortconv). KEXP already on disk (3.33 GB); recipe in `results/lfm25_kexp/`. Product-relevant: KEXP was pulled from the in-app catalog (PLAN #29). Official Q8_0 = 9.01 GB (`33ab3b8c…`); F16 = 16.95 GB. Prefer Q8_0 to stay near the 8 GB hint; F16 only if Q8_0 is unreachable. |

Skipped: CalaQwen 35B (owner: not required), Mellum2 (Q4_K_M already 8.07 GB → source ≫ 8 GB), Qwen3-30B, Ornith, REAP.

## Disk rules

- Keep ≥40 GB free on C: at all times. Start: capture `Get-PSDrive C` to `DISK_LOG.md`.
- One model at a time. After that model's A/B: delete **our** source download and non-winning variants. Keep at most one winning GGUF per model under this directory.
- Never delete: shipped KEXP in `models/`, q36 GGUFs, imatrix files already in `models/`, `LFM2-8B-A1B-Q4_K_M.gguf.BADSIZE`.

## Cook rule (from source, not from KEXP)

All four arms from the same high-precision GGUF:

- **control** = KEXP recipe (experts Q2_K+Q3_K, trunk Q5_K/Q6_K as in the model's existing recipe file).
- **variants** = same experts, trunk → Q8_0 / IQ4_NL / Q4_0.
- Marco Q8_0 source requires `--allow-requantize`. F16 would not.
- Use `--imatrix` when the original cook did (Marco, LFM).
- `--pure` forbidden (skips overrides).

Trunk = every non-expert tensor that is Q5_K or Q6_K in the control (attn + token_embd; on LFM also shortconv in/out + leading dense FFN). F32 stays F32. Experts stay Q2_K/Q3_K.

## Verify / A/B / NPU

Reuse q36: `verify_variants.py` (expert payloads byte-identical; trunk types; size table), `run_q36_ab.py` harness (sanity + long, temp 0, conservative judge), NPU_DESK predicates on attn tensors.

Marco runtime: k=6 drop=0.0, `--chatml --no-think` (q36 / shipped-in-harness, not the later PLAN drop-1.0 card).
