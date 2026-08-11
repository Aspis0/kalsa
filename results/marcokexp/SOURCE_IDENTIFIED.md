# MarcoKEXP — A.1 Sorgente individuata (NO download)

**Stato:** solo identificazione. Download **bloccato** finché non compare
verdetto T2c con Marco promosso in `results/trial_marco/` (o istruzione esplicita).

Check T2c al momento prep: `quality_gates.json` assente / Marco non promosso
(T3 Jelly già FAIL velocità; bpb IT Marco disastroso). → **non scaricare**.

## Scelta sorgente (preferenza mandato: Q8_0 GGUF se esiste)

| campo | valore |
|---|---|
| **Repo HF** | `mradermacher/Marco-Mini-Instruct-GGUF` (static, non i1) |
| **File** | `Marco-Mini-Instruct.Q8_0.gguf` |
| **Size atteso** | **18 356 453 952** B (17.09 GiB) |
| **SHA256 atteso (LFS oid)** | `3287457af7a6632cce7b9e9dd37a7bce72f6e61c3d64eb79deea474bda5e6f1c` |
| **URL resolve** | https://huggingface.co/mradermacher/Marco-Mini-Instruct-GGUF/resolve/main/Marco-Mini-Instruct.Q8_0.gguf |
| **Licenza** | Apache-2.0 (modello Marco-Mini-Instruct upstream) |
| **Perché** | Q8_0 GGUF → pipeline quantize identica a KEXP 1c (llama-quantize + tensor_types); niente convert HF |

### Alternative scartate per la prep (documentate)

| opzione | note |
|---|---|
| `ATH-MaaS/Marco-Mini-Instruct` / `AIDC-AI/Marco-Mini-Instruct` | upstream HF weights (BF16/safetensors) — tree API senza file GGUF utili in listing; richiederebbe convert_hf_to_gguf |
| `mradermacher/...-i1-GGUF` Q8 | i1 ha fino a Q6_K / i1-Q*; Q8_0 static è sul repo **non-i1** |
| i1-Q4_K_M già in casa | è il candidato trial, **non** il sorgente alta-precisione per requant |

## imatrix (A.2, solo nota — download con sorgente se T2c passa)

| campo | valore |
|---|---|
| **Disponibile?** | **Sì** — mradermacher espone imatrix sul repo i1 |
| **Repo** | `mradermacher/Marco-Mini-Instruct-i1-GGUF` |
| **File** | `Marco-Mini-Instruct.imatrix.gguf` |
| **Size** | **81 548 704** B |
| **SHA256 atteso (LFS oid)** | `f05d4d4a7b043904728a1fed6496715e5348b4bd825e47eda5cbdc97fb8aec23` |
| **URL** | https://huggingface.co/mradermacher/Marco-Mini-Instruct-i1-GGUF/resolve/main/Marco-Mini-Instruct.imatrix.gguf |
| **Nota** | Se si rifiuta l’imatrix mradermacher (corpus sconosciuto vs gate multi5), ricalcolare con `llama-imatrix` su corpus **disgiunto** da multi5 (lezione REAP). |

## Spazio PC

Verificare ≥20 GB liberi in `models/` prima del download (Q8 ~18 GB + imatrix ~78 MB + margine).

## Comando download (NON eseguire finché T2c non promuove Marco)

```powershell
# SOLO dopo T2c PASS / Marco promosso
$dest = "models"
curl.exe -L -C - -o "$dest/Marco-Mini-Instruct.Q8_0.gguf" `
  "https://huggingface.co/mradermacher/Marco-Mini-Instruct-GGUF/resolve/main/Marco-Mini-Instruct.Q8_0.gguf"
# verify: size == 18356453952 && sha256 == 3287457a...
curl.exe -L -C - -o "$dest/Marco-Mini-Instruct.imatrix.gguf" `
  "https://huggingface.co/mradermacher/Marco-Mini-Instruct-i1-GGUF/resolve/main/Marco-Mini-Instruct.imatrix.gguf"
# verify: size == 81548704 && sha256 == f05d4d4a...
```
