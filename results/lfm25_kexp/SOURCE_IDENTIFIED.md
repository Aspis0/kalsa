# LFM2.5-8B-A1B — source identification

**Date:** 2026-08-12  
**Rule:** official LiquidAI GGUF only. Highest precision usable for requant.

## Chosen source — F16 (on disk, sha verified)

| | |
|---|---|
| Repo | https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF |
| File | `LFM2.5-8B-A1B-F16.gguf` |
| URL | https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/main/LFM2.5-8B-A1B-F16.gguf |
| Size | **16 947 260 640** B (16.9 GB, HF LFS) |
| sha256 (HF LFS oid) | `c6eb857414327e26d32654d996838d305cb57c01c06def0894bde244f7baa159` |
| Dest | `models/LFM2.5-8B-A1B-F16.gguf` |
| pc_sha (Get-FileHash 2026-08-12) | `c6eb857414327e26d32654d996838d305cb57c01c06def0894bde244f7baa159` |
| Match | **YES** — size + sha equal HF LFS oid |
| Why | Highest-precision official GGUF. llama-quantize from F16 does **not** need `--allow-requantize`. Better than Q8_0 for a 2–3 bit expert pass. |

## Considered, not chosen

| file | size | sha256 (HF LFS) | why not |
|---|---:|---|---|
| `LFM2.5-8B-A1B-BF16.gguf` | 16 947 260 640 | `2b471037695ef5908cb88065c7ebb23fe285a07950d7433fabf0c865273728ab` | Same width as F16; llama.cpp pipeline historically prefers F16 |
| `LFM2.5-8B-A1B-Q8_0.gguf` | 9 010 195 680 | `33ab3b8ce6a964fb8ebac89360c9b3cf72c4fa418d5e4c0a94d46883124d5c02` | KEXP/Marco precedent, but **not** highest precision. Fallback if F16 download fails |
| Unsloth BF16 / Q8 | different SHAs | — | Community re-export. Not official LiquidAI |

## Already on disk (NOT the requant source)

| file | size | sha256 | role |
|---|---:|---|---|
| `models/LFM2.5-8B-A1B-Q4_K_M.gguf` | 5 155 564 768 | `4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0` | A0 baseline + tensor-name dump. MATCHES HF LFS |
| `models/LFM2-8B-A1B-Q4_K_M.gguf` (+ `.BADSIZE`) | — | — | **DEPRECATED** older LFM2, not 2.5. Do not use |

## Download

```
hf download LiquidAI/LFM2.5-8B-A1B-GGUF LFM2.5-8B-A1B-F16.gguf --local-dir models
```

Log: `results/lfm25_kexp/download_f16.log`  
Post-download: `Get-FileHash models\LFM2.5-8B-A1B-F16.gguf -Algorithm SHA256` must equal the LFS oid above.  
`pc_sha` recorded here only after that check.
