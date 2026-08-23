# q37 sources (public, no token)

## 1. Marco-Mini-Instruct (mandatory)

| | |
|---|---|
| File | `Marco-Mini-Instruct.Q8_0.gguf` |
| URL | https://huggingface.co/mradermacher/Marco-Mini-Instruct-GGUF/resolve/main/Marco-Mini-Instruct.Q8_0.gguf |
| Size | **18 356 453 952** B |
| sha256 | `3287457af7a6632cce7b9e9dd37a7bce72f6e61c3d64eb79deea474bda5e6f1c` |
| Why | Same source the original KEXP 1c was cooked from (`results/marcokexp/SOURCE_IDENTIFIED.md`, q36 REPORT). |
| imatrix | https://huggingface.co/mradermacher/Marco-Mini-Instruct-i1-GGUF/resolve/main/Marco-Mini-Instruct.imatrix.gguf — 81 548 704 B, sha `f05d4d4a7b043904728a1fed6496715e5348b4bd825e47eda5cbdc97fb8aec23` |

Dest: `scratchpad/agents/q37-bprime-from-source/src/` (not `models/`). Deleted after this model's A/B.

## 2. OLMoE-1B-7B-0924-Instruct (small MoE)

| | |
|---|---|
| File | `olmoe-1b-7b-0924-instruct-q8_0.gguf` |
| Repo | **official** `allenai/OLMoE-1B-7B-0924-Instruct-GGUF` (not bartowski/mradermacher) |
| URL | https://huggingface.co/allenai/OLMoE-1B-7B-0924-Instruct-GGUF/resolve/main/olmoe-1b-7b-0924-instruct-q8_0.gguf |
| Size | **7 359 943 136** B (7.36 GB) — under the ≤8 GB hint |
| sha256 (HF LFS oid) | `d089e8b12dee00764c1783f6c557a2ddd1f680ffb0d22b44ad28ef25f8909c66` |
| Why | Already in the campaign (`models/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf` 4.21 GB, architecture `olmoe`, 64 experts / top-8, 16 layers, hidden 2048, **untied** `output.weight`). Different family from Qwen/Marco. On-disk file is uniform Q4_K_M, not KEXP — control is cooked KEXP-style from this Q8_0. |
| imatrix | none (official Q8_0 repo does not ship one) |

On-disk Q4_K_M is 4 213 513 024 B vs official q4_k_m 4 213 512 672 B (352 B delta) — different converter, same architecture. We do **not** requant that Q4_K_M (double-quant).

## 3. LFM2.5-8B-A1B (optional 3rd, after 1–2)

| | |
|---|---|
| File | `LFM2.5-8B-A1B-Q8_0.gguf` |
| URL | https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/main/LFM2.5-8B-A1B-Q8_0.gguf |
| Size | **9 010 195 680** B (9.01 GB) — slightly over the 8 GB small-model hint; listed separately by the owner because the KEXP artifact was pulled from the in-app catalog (PLAN #29). |
| sha256 | `33ab3b8ce6a964fb8ebac89360c9b3cf72c4fa418d5e4c0a94d46883124d5c02` |
| Why | Hybrid MoE (`lfm2moe`, 32 experts / top-4, 24 layers, 6 attn + 18 shortconv). Existing KEXP recipe `results/lfm25_kexp/tensor_types_lfm25.txt`. Official LiquidAI GGUF. |
| Fallback F16 | 16 947 260 640 B, sha `c6eb857414327e26d32654d996838d305cb57c01c06def0894bde244f7baa159` — original KEXP source. Prefer Q8_0 for disk. |
| imatrix | already on disk `models/imatrix_lfm25_unsloth.gguf_file` (pre-existing, do not delete) |

## Not used

CalaQwen 35B, Mellum2 (Q4_K_M already 8.07 GB), Qwen3-30B, Ornith, REAP, LFM2 (not 2.5).
