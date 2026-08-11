# LiteRT fail-fast prep — artefatti (PC, ready sideload)

## App demo (S23 = SM-S911U · Snapdragon 8 Gen 2 · sm8550)

| artefatto | path locale | size B | sha256 |
|---|---|---:|---|
| **Gallery sm8550** (primario S23) | `models/litert-prep/ai-edge-gallery-sm8550-1.0.18.apk` | 47 063 610 | `A2BEA0169D8F190D838E3336D4567C738856461B3388C0414CDB6B39F1D96639` |
| Gallery generica (fallback) | `models/litert-prep/ai-edge-gallery-1.0.18.apk` | 27 786 923 | `CFBB0C85D487BB3188F2BC73F1355B476E2D8C9C140BC0A9185EE6B4F861EB07` |

- **Release:** github.com/google-ai-edge/gallery **v1.0.18** (2026-08-10)  
- **URL sm8550:** https://github.com/google-ai-edge/gallery/releases/download/1.0.18/ai-edge-gallery-sm8550.apk  
- **URL generic:** https://github.com/google-ai-edge/gallery/releases/download/1.0.18/ai-edge-gallery.apk  
- **Package:** `com.google.ai.edge.gallery`  
- **Licenza app:** Apache-2.0 (repo gallery)  
- **Note:** le varianti sm8550/sm8650/… sono build chipset-specifiche (NPU/vendor kernels). S23 = **sm8550**. Play Store: `com.google.ai.edge.gallery` (stesso prodotto, versione può differire).

## Modello size-matched (OpenCL / GPU)

| artefatto | path | size B | sha256 (LFS oid HF) |
|---|---|---:|---|
| **Gemma-4-E2B-it GPU** | `models/litert-prep/gemma-4-E2B-it-gpu.litertlm` | **2 008 432 640** (verified on disk) | `A53A59001894C58E6BDB5B9B227709F91A2E3E556BAA7D85ACF9C55402BA5CF5` |

- **Repo:** `litert-community/gemma-4-E2B-it-litert-lm`  
- **URL:** https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-gpu.litertlm  
- **Licenza:** Gemma (termini Google Gemma) — accettare HF license se richiesto  
- **Perché questo e non Llama-3.2-3B / Gemma2-2B:**  
  - `litert-community/Llama-3.2-3B` → **401 gated** (serve HF login)  
  - `Gemma2-2B-IT` `.task` → **401 gated**  
  - Gemma-4-E2B GPU `.litertlm` → **pubblico**, ~1.9 GB, backend **GPU/OpenCL** esplicito nel nome — adatto porta-740 Adreno S23  
- **Size-match:** ~2 GB vs dense 2–3B class (mandate); non è Llama-3.2-3B letterale ma classe equivalente per fail-fast.

### Alternativa se serve Llama-3.2-3B esatto

Dopo `huggingface-cli login` (account con accesso Meta):

```
https://huggingface.co/litert-community/Llama-3.2-3B/resolve/main/llama3_2_3b_mixed_int4_gpu.litertlm
size atteso: 2207940608
```

## Sideload (solo riferimento — NON eseguire ora)

```text
adb -s <S23> install -r models/litert-prep/ai-edge-gallery-sm8550-1.0.18.apk
adb -s <S23> push models/litert-prep/gemma-4-E2B-it-gpu.litertlm /sdcard/Download/
# In-app: import model from Downloads / HF URL
```
