# q48 — OLMoE all-Q4_0 prep (vehicle for the experts-on-NPU prefill probe)

PC-only prep, completed 2026-08-24. Downloaded source + quantize executed by the
orchestrator (the delegated agent's async tool was broken — its detached launches
died instantly in cmd.exe; see `logs/job-*.log`); analysis scripts in this dir.

## Why this model

First-ever probe of **MoE EXPERTS on the Qualcomm NPU**: the HTP backend has a
full `MUL_MAT_ID` path (HMX + HVX fallback, VTCM-budget gate — verified in
`ggml-hexagon.cpp`), and it supports Q4_0. Our KEXP models can never use it
(experts are K-quants); an all-Q4_0 OLMoE is the clean vehicle. The q25 NO-GO on
experts-on-NPU was about DECODE (DRAM-bound, later confirmed 0.37×); the PREFILL
side is unmeasured by anyone.

## Source

`olmoe-1b-7b-0924-instruct-q8_0.gguf`, 7 359 943 136 B, sha256 `d089e8b1…`
(SOURCE.md pin, re-downloaded via `dl_olmoe.ps1`, self sha-verified).

## Quantize

`llama-quantize.exe --allow-requantize SRC DST Q4_0 16` — the
`--allow-requantize` flag is REQUIRED (llama-quantize refuses Q8_0 sources by
default). Q8_0→Q4_0 requantize is the established from-source methodology of the
q37/q43 cooks (the q36 quality collapse was from Q5_K/Q6_K sources, not Q8_0).
7017.29 MiB (8.51 BPW) → 3744.37 MiB (4.54 BPW). Log: `logs/quantize.err.log`.

## Output gguf

| | |
|---|---|
| file | `gguf/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf` |
| bytes | **3 928 037 856** (3.66 GiB — fits the S23 with room) |
| sha256 | `43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500` |

## Tensor types (`analysis.json`)

Q4_0 ×113, F32 ×81, Q6_K ×1. The ONLY non-Q4_0 quantized tensor is
`output.weight` (Q6_K, [2048, 50304]) — stays on CPU regardless (K-quant +
FAIL_DIM class). `token_embd` is Q4_0.

## Expert geometry (the probe's key numbers)

- `olmoe.expert_count` = **64**, `expert_used_count` = **8**, 16 layers.
- 48 expert tensors (16 × gate/up/down), **all Q4_0**:
  gate/up `[2048, 1024, 64]`, down `[1024, 2048, 64]`, 72 MiB each.
- Total expert bytes **3 623 878 656** (96.6 % of the file: this model IS its
  experts — if MUL_MAT_ID dispatches to HTP, virtually the whole prefill compute
  moves to the NPU).
- HTP predicates: type eligible (Q4_0) on all 48; ne[1] ≤ 32768 on all 48.
- Attn Q/K/V/O ×16: Q4_0 `[2048, 2048]`, desk predicates **PASS**
  (`npu_desk.md`).
- Per-expert slice for MUL_MAT_ID: gate/up = 2048×1024 Q4_0 ≈ 1.125 MiB per
  expert — comfortably under the 8 MiB VTCM budget per 2D matmul; the kernel
  runs one 2D matmul per routed expert.

## Device probe plan (next S23 window, after the LFM-B′ smoke)

Push gguf → sha on-device → HTP v73 harness (kalsahtp, same env as q44 phase 2)
→ pp16/tg8 `-v` with **execute-op proof on `ffn_*_exps` MUL_MAT_ID nodes**
(the headline: experts actually running on HTP0) → if sane, pp512 + tg128 + CPU
same-harness reference, all exploratory. Expected load: ~3.7 GiB anon (HTP path
materializes host buffers) vs 7 074 MiB MemTotal — fits, unlike Marco-B′.

Known risks for the probe: MUL_MAT_ID VTCM rejection at real shapes (the desk
predicates are per-tensor, the kernel gate is per-op with activations),
`nr=[2,1]`-style batch fallbacks (28e: no broadcasting in the kernel), and the
m%32 HMX contract (q35) on small routed-token counts.
