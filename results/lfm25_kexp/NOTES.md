# LFM2.5-8B-A1B KEXP — class justifications

Dump: `tensor_dump.txt` from official Q4_K_M (256 tensors, arch `lfm2moe`).  
F16 source checked 2026-08-12: **same 256 names**, empty symmetric difference, `general.file_type=1` (F16).  
Recipe: `tensor_types_lfm25.txt`. Patterns: `tensor_types_patterns.txt`. Layers: `layer_map.txt`.

## Architecture facts (from `gguf_header_arch.txt`)

| key | value |
|---|---|
| arch | `lfm2moe` |
| layers | 24 |
| hidden | 2048 |
| dense FFN | 7168 |
| expert count | 32 |
| expert used (K0) | 4 |
| expert FFN | **1792** |
| leading dense | **2** (blk.0, blk.1) |
| attn layout | GQA n_kv=8 on **6** layers: 2, 6, 10, 14, 18, 21 |
| mixer on other 18 | `shortconv` (l_cache=3), **not** SSM |
| shared expert | **none** |
| embeddings | tied (`token_embd` only; no `output.weight`) |
| vocab | 128000 |
| languages (card) | en, ar, zh, fr, de, ja, ko, es, pt |

## Class map (every tensor kind)

| tensors | n | type | why |
|---|---:|---|---|
| `ffn_gate_exps`, `ffn_up_exps` | 22+22 | **q2_k** | KEXP 1c: routed gate/up get the aggressive 2-bit tier. These dominate bytes. |
| `ffn_down_exps` | 22 | **q3_k** | KEXP 1c: down is the residual path; one extra bit. Official Q4_K_M mixed 10×Q6_K + 12×Q4_K on these. |
| `ffn_gate`, `ffn_up` (dense) | 2+2 | **q5_k** | Leading dense blocks. Always-on. KEXP dense class. |
| `ffn_down` (dense) | 2 | **q6_k** | Same role as KEXP `ffn_down_shexp` (always-on down). No shexp exists here. |
| `attn_q/k/v/output` | 6 each | **q5_k** | KEXP attn class. Only 6 layers — cheap in bytes, expensive in quality if hit. Official Q4_K_M kept **`attn_v` at Q6_K on blk.10 and blk.21** (last two attn layers) and Q4_K on the other four. We do **not** copy that mix: all six V stay q5_k. That is a deliberate uniform-KEXP choice, not an oversight. Extra bytes of two 2048×512 V at Q6 vs Q5 are ~0.1 MB; the quality question is whether the official mix knew something. Disclose, don't silently match. |
| `attn_*_norm`, `ffn_norm`, `token_embd_norm` | many | **f32** | Norms stay F32 in every KEXP recipe. |
| `ffn_gate_inp` | 22 | **f32** | Router. KEXP keeps router F32. Tiny. |
| `exp_probs_b.bias` | 22 | **f32** | LFM-specific router bias. Not in qwen35moe. Leave F32 (already F32). |
| `shortconv.conv` | 18 | **f32** | 3×2048. Analog of KEXP `ssm_conv1d` (F32). Already F32. |
| `shortconv.in_proj` | 18 | **q5_k** | **Not in KEXP.** This *is* the mixer on 18/24 layers. Treat as attn-class. |
| `shortconv.out_proj` | 18 | **q6_k** | Analog of KEXP `ssm_out=q6_k` (mixer output into residual). Stated as analogy, not identity. |
| `token_embd` | 1 | **q5_k** | KEXP embd class. Official Q4_K_M used Q6_K here; we follow KEXP not the official mix. |
| `^output\.weight$` | 0 | **q5_k** | Safety regex. 1c originally pinned output to **q4_k**; later notes preferred q5_k. **Will not match** — embeddings are tied. |

## Where the KEXP split is inapplicable (do not invent tensors)

1. **No shared expert.** `ffn_*_shexp` and `ffn_gate_inp_shexp` do not exist. The "keep shexp high" half of KEXP has no target. The 2 leading dense FFN blocks are the closest always-on FFN and are kept Q5_K/Q6_K.
2. **No SSM.** qwen35moe KEXP has `ssm_alpha/beta/conv1d/norm/out`. LFM2.5 uses `shortconv.{conv,in_proj,out_proj}`. Mapping is an **analogy** (conv→F32, in_proj→attn-class, out_proj→ssm_out-class), not a name match. If this analogy is wrong, quality risk is on the 18 mixer layers, not the experts.
3. **No fused `attn_qkv` / `attn_gate`.** Unfused Q/K/V on 6 layers only. Straight Q5_K.
4. **Tied embeddings.** `output.weight` absent. `--leave-output-tensor` would be a no-op.

## Quality risk — honest, and a correction

The brief said "expert FFN 1792 — smaller experts than the 35B". **That is false on the measured 35B dump.**

| | LFM2.5-8B-A1B | Qwen3.5-35B-A3B (KEXP source) |
|---|---|---|
| expert_feed_forward_length | **1792** | **512** (`qwen35moe.expert_feed_forward_length`) |
| expert_count | 32 | 256-class (label 32x959M vs 35B-A3B) |
| MoE layers | 22 | 40 |
| shared expert | no | yes (`ffn_*_shexp`) |
| default k | 4 | 8 (campaign later 6) |
| expert matrix | 2048×1792 | 2048-ish × 512 |

LFM experts are **wider** (1792 vs 512), so k-quant grouping is *easier* than on the 35B, not harder. The real risks are elsewhere:

1. **No shared expert.** Every residual FFN byte on 22/24 layers goes through the Q2/Q3 routed experts. KEXP's safety net is gone.
2. **32 experts, k=4.** Each expert is a generalist used often. Q2_K damage is more visible than on a 256-expert model where most experts are rare.
3. **Hybrid mixer.** 18/24 layers have no attention. If `shortconv` is under-quantized (we kept it high) we are fine; if we had crushed it, the model dies. We did **not** crush it.
4. **Q2_K gate/up** is the same aggressive 1c choice that worked on 35B *with* imatrix. Without imatrix this is a coin flip. We use Unsloth's LFM2.5 imatrix (see `IMATRIX_PLAN.md`).
5. **A0 does not exist yet.** Official Q4_K_M multi5 bpb is unmeasured. Gates below are pre-declared against a baseline we will run on the same PC, same binary, same corpus.

Expected file size (from dump n_elements, k-quant data-rates, not measured):
experts ~4.66 GB (Q4_K_M mix) → ~2.77 GB (Q2_K/Q3_K). Shared ~0.5 GB after
embd q6→q5 (−) and attn/shortconv q4→q5/q6 (+). **~3.4–3.6 GB** including
block overhead. Confirm after quantize. Speed projection stays G99's
14.5–18.5 t/s — still a projection.

## OpenCL / G99 note

Recipe stays in k-quants (Q2_K / Q3_K / Q5_K / Q6_K). No IQ*. Same constraint as MarcoKEXP (OpenCL-safe).
