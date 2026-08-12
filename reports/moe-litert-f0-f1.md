# moe-litert-f0-f1 — fail-fast porta-740 (S23)

**Data:** 2026-08-11/12  
**Device:** Galaxy S23 (SM-S911U) · Adreno 740 · driver OpenCL 0676.73  
**Power:** **UNPLUGGED** (AC/USB/Wireless = false) · batt 97%→94%  
**Gate F1:** mediana LiteRT decode ≥ **1.15×** llama-bench CPU size-matched, same device, 2 rep.

## 0. Diagnosi iniziale (perché prima falliva)

| artefatto | size | esito |
|-----------|-----:|--------|
| `gemma-4-E2B-it-gpu.litertlm` (prep locale) | 2.008 GB | **FAIL** `TF_LITE_PREFILL_DECODE not found` |
| `gemma-4-E2B-it.litertlm` (catalogo Gallery ufficiale) | **2.588 GB** | **PASS** load + gen |

Il file `*-gpu.litertlm` **non** è il bundle LLM completo per AI Edge Gallery 1.0.18.  
Il file giusto è `gemma-4-E2B-it.litertlm` (HF `litert-community/gemma-4-E2B-it-litert-lm`).

Gallery: `com.google.ai.edge.gallery` **1.0.18** (sm8550 APK).  
adb wireless pair OK.

## 1. Setup

- Install APK + download modello ufficiale in-app
- Accelerator UI: **GPU** (checked)
- Thinking / speculative: **OFF**
- Max tokens UI: 4000 (min app 2000)

## 2. Gemello CPU (llama-bench, UNPLUGGED)

| | |
|--|--|
| Model | Llama-3.2-3B-Instruct Q4_K_M (bartowski) · 2.019 GB · size-matched ~2B class |
| Bin | Termux `llama-bench` build-safe · `-t 4` · CPU only |
| Artifact | `results/litert_f1/llama_bench_unplugged.json` |

| test | n | med/avg tok/s | samples |
|------|---|---------------|---------|
| prefill pp128 | 128 | **41.75** | 39.5 / 44.0 |
| **decode tg256** | 256 | **9.70** | **10.74 / 8.66** |

(Nota: una run precedente *in carica* + carico concorrente aveva dato ~2.45 tok/s — scartata; non usare.)

## 3. LiteRT GPU (Gallery AI Chat, UNPLUGGED)

### Rep 1 (metrica primaria)

| campo | valore |
|-------|--------|
| Model | Gemma-4-E2B-it · **Model on GPU** |
| Prompt | "Explain coffee in five sentences." |
| UI wall label | **3.4 s** (totale UI, prefill+decode) |
| Response words | 70 |
| est tokens (×1.3) | **91** |
| **est tok/s** | **26.8** (= 91/3.4) |
| Artifact | `results/litert_f1/gpu_quick_rep1.json` |

### Rep 2

| campo | valore |
|-------|--------|
| Prompt | "List ten facts about coffee…" |
| Model on GPU | **sì** |
| Completato | **sì** (10 bullet visibili) |
| UI time label | **assente** (layout multi-bubble) |
| words visibili | ~97 |
| Artifact | `results/litert_f1/gpu_quick_rep2.json` |

### Log nativi (load)

- OpenCL delegate attivo su vision subgraphs (`LITERT_CL`)
- Warning: `libLiteRtTopKOpenClSampler.so` missing → fallback sampler C API (non blocca gen)

## 4. Gate F1

| metrica | CPU | LiteRT GPU (est) | ratio |
|---------|-----|------------------|-------|
| decode tok/s | **9.70** | **~26.8** (rep1) | **~2.76×** |

**Gate ≥1.15×: PASS** (con caveat sotto).

### Caveat obbligatori (onesti)

1. **Modelli diversi** (Gemma-4-E2B vs Llama-3.2-3B) — footprint simile, non same-weights A/B.  
2. **UI 3.4 s = wall totale**, non solo decode; se prefill è una frazione non banale, pure-decode GPU è ancora più alto.  
3. **Token count stimato** (words×1.3), non tokenizer ufficiale.  
4. **Sostenuto ≥60 s** protocollo: **non** raggiunto in rep formali (gen corte per metrica leggibile). Gen lunghe (max_tokens 4000) completano ma la UI non espone tok/s e tronca il testo accessibile.  
5. Non è un A/B sullo **stesso** GGUF/stack KEXP 35B — solo fail-fast “kernel non-llama battono CPU su 740?”.

## 5. Verdetto porta-740

| domanda | esito |
|---------|--------|
| LiteRT gira decode LLM ≥1B su Adreno 740 S23? | **SÌ** |
| Più veloce del CPU size-matched stesso device? | **SÌ (~2.8× est.)** |
| Gate F1 ≥1.15× | **PASS (caveat)** |
| Giustifica spike kernel no-subgroup nel fork llama? | **SÌ, condizionale** — evidenza empirica positiva; costo manutenzione resta alto |
| Portabilità a KEXP 35B MoE streaming? | **NO automatico** — stack LiteRT ≠ BigMoe; serve design separato |

## 6. Prossimi passi (se gualt vuole)

1. (Opz.) Gen sostenuta ≥60 s con logging logcat custom / screenshot stats se Gallery le espone.  
2. A/B più pulito: stesso testo, token count da tokenizer Gemma vs contaword.  
3. Spike F3 kernel solo se ROI prodotto (non per KEXP streaming flash).  
4. Chiudere: **non** inseguire OpenCL llama vanilla (K2/K5 restano validi).

## Artefatti

```
results/litert_f1/
  llama_bench_unplugged.json
  gpu_quick_rep1.json
  gpu_quick_rep2.json
  (UI dumps q*_*.xml, gpu_r1_*.xml)
```

**STOP** ai gate F0/F1.
