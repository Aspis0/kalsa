# PREP PC — MarcoKEXP + LiteRT fail-fast (mandato `prep-marcokexp-litert.md`)

**Data:** 2026-08-11  
**Scope:** solo PC, zero telefoni. Niente quantize, niente F0/F1 su device.  
**T2c Marco:** non promosso al momento della prep (`quality_gates.json` assente; bpb IT Marco fallimentare; T3 Jelly FAIL 0.72×). → **sorgente Q8 non scaricato**.

---

## A — MarcoKEXP prep (parziale su istruzione gualt)

### A.1 Sorgente — SOLO individuazione (NO download)

| | |
|---|---|
| Repo | **`mradermacher/Marco-Mini-Instruct-GGUF`** (static) |
| File | **`Marco-Mini-Instruct.Q8_0.gguf`** |
| Size atteso | **18 356 453 952** B |
| SHA256 atteso (HF LFS oid) | **`3287457af7a6632cce7b9e9dd37a7bce72f6e61c3d64eb79deea474bda5e6f1c`** |
| URL | https://huggingface.co/mradermacher/Marco-Mini-Instruct-GGUF/resolve/main/Marco-Mini-Instruct.Q8_0.gguf |
| Motivo | Q8_0 GGUF → stessa pipeline di KEXP; preferito a BF16 upstream |

**imatrix (nota, non scaricata):** sì, su `mradermacher/Marco-Mini-Instruct-i1-GGUF`  
`Marco-Mini-Instruct.imatrix.gguf` · **81 548 704** B · sha  
`f05d4d4a7b043904728a1fed6496715e5348b4bd825e47eda5cbdc97fb8aec23`

Verbale esteso: `results/marcokexp/SOURCE_IDENTIFIED.md`  
**Download:** solo se compare T2c con Marco promosso in `results/trial_marco/` (o ordine esplicito).

### A.3 Recipe (dal dump in casa — fatto)

Sorgente dump: `results/gpu_xiaomi/logs/marco_gguf_dump.txt` (i1-Q4_K_M, 338 tensori, arch qwen3moe, h=1024 expert int=768).

| file | ruolo |
|---|---|
| `results/marcokexp/tensor_types.txt` | default = **conservative q3_k** esperti |
| `results/marcokexp/tensor_types_conservative_q3k.txt` | dense/attn **q4_k**, emb/output **q5_k**, esperti **q3_k**, norms/router **f32** |
| `results/marcokexp/tensor_types_aggressive_q2k.txt` | stessi dense; esperti **q2_k** |
| `results/marcokexp/tensor_types_patterns.txt` | riepilogo |
| `results/marcokexp/QUANTIZE_CMD_NOT_RUN.md` | comando llama-quantize scritto, **non eseguito** |

**OpenCL:** dense in q4_k/q5_k (compat), non IQ*.  
**Ancora:** `^output\.weight$=q5_k` (lezione 1c; può essere assente se emb tied).  
**Bpw esperti:** 2 opzioni dichiarate — scelta al metro post-T2c se mai si sblocca.

### A.4 STOP quantize

Comando pronto in `QUANTIZE_CMD_NOT_RUN.md`. **Non lanciato.**

---

## B — LiteRT fail-fast prep (completo)

### B.1–B.2 Artefatti scaricati su PC

| pezzo | path | size | sha256 |
|---|---|---:|---|
| Gallery **sm8550** (S23) | `models/litert-prep/ai-edge-gallery-sm8550-1.0.18.apk` | 47 063 610 | `A2BEA0169D8F190D838E3336D4567C738856461B3388C0414CDB6B39F1D96639` |
| Gallery generic | `models/litert-prep/ai-edge-gallery-1.0.18.apk` | 27 786 923 | `CFBB0C85D487BB3188F2BC73F1355B476E2D8C9C140BC0A9185EE6B4F861EB07` |
| **Gemma-4-E2B GPU** `.litertlm` | `models/litert-prep/gemma-4-E2B-it-gpu.litertlm` | 2 008 432 640 | `A53A59001894C58E6BDB5B9B227709F91A2E3E556BAA7D85ACF9C55402BA5CF5` |

- App: [google-ai-edge/gallery v1.0.18](https://github.com/google-ai-edge/gallery/releases/tag/1.0.18) · pkg `com.google.ai.edge.gallery` · Apache-2.0  
- Modello: [litert-community/gemma-4-E2B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) · variante **gpu** (OpenCL) · licenza Gemma  

**Perché non Llama-3.2-3B / Gemma2-2B:** HF **401 gated** senza login. Gemma-4-E2B-gpu è pubblico, ~2 GB, backend GPU esplicito — adatto fail-fast Adreno S23 (sm8550 APK).

Dettaglio: `results/litert-prep/ARTIFACTS.md`

### B.3 Protocollo F1

`results/litert-prep/F1_PROTOCOL.md` — 1 pagina:

- Come leggere **decode tok/s** da Gallery (stats UI; fallback CLI/logcat se assente)  
- Sostenuto ≥60 s, 2 rep, staccato  
- Gemello: `llama-bench -t 4 -p 128 -n 256 -r 2` su GGUF size-matched  
- Gate **≥1.15×**  
- Verbale minimo campi  

### B.4 STOP

Nessun sideload / run su S23. Mandato successivo.

---

## Deliverable checklist

| | |
|---|---|
| A sorgente+sha a verbale | sì (`SOURCE_IDENTIFIED.md`) |
| A download Q8 | **no** (T2c non promuove Marco) |
| A recipe | sì |
| A quantize | comando scritto, non eseguito |
| B APK+modello+sha | sì (su disco, fuori git se &gt;100MB) |
| B protocollo F1 | sì |
| Commit report+recipe+verbali | sì (no push GGUF/APK/litertlm grandi) |

**STOP.**
