# moe-litert-qwen — Qwen family on S23 LiteRT GPU (unplugged)

**Data:** 2026-08-12  
**Device:** Galaxy S23 (SM-S911U) · Adreno 740  
**Power:** **UNPLUGGED** (AC/USB/Wireless = false) · batt ~87%→83%  
**Gallery:** `com.google.ai.edge.gallery` 1.0.18 sm8550  
**Method:** same as F1 Gemma — UI wall label + words×1.3; llama-bench `-t 4` twin

## 1. Models tested

| model | stack | size | note |
|-------|-------|-----:|------|
| DeepSeek-R1-Distill-Qwen-1.5B | LiteRT GPU (catalog) | 1.8 GB q8 | long CoT thinking |
| Qwen2.5-1.5B-Instruct | LiteRT GPU (catalog) | 1.6 GB | short instruct, primary |
| Qwen2.5-1.5B-Instruct Q4_K_M | llama-bench CPU | 0.94 GB | size-class twin |
| qwen35_2b.litertlm (import) | LTLM magic | 1.9 GB | **skip** — Gallery rejects |
| qwen3_4b_mixed_int4.litertlm | import LITERTLM | 2.7 GB | present, not timed this run |

## 2. CPU twin (llama-bench, UNPLUGGED)

| | |
|--|--|
| Model | Qwen2.5-1.5B-Instruct Q4_K_M · 980 MB |
| Bin | Termux `build-safe` llama-bench · `-t 4` |
| Artifact | `results/litert_f1/llama_bench_qwen_unplugged.json` |

| test | n | avg tok/s | samples |
|------|---|----------:|---------|
| prefill pp128 | 128 | **57.57** | 58.2 / 56.9 |
| **decode tg256** | 256 | **25.80** | **26.47 / 25.12** |

(Segfault on bench teardown exit 139 after both tests completed — numbers in JSON are valid.)

## 3. LiteRT GPU

### 3a. Qwen2.5-1.5B-Instruct (primary — same prompt as Gemma F1)

| campo | valore |
|-------|--------|
| Accelerator | **Model on GPU** |
| Prompt | "Explain cofee in five sentences." |
| UI wall | **7.7 s** |
| words | 111 |
| est tokens (×1.3) | **144.3** |
| **est tok/s** | **18.7** |
| Artifact | `results/litert_f1/qwen25_gpu_rep1.json` |

### 3b. DeepSeek-R1-Distill-Qwen-1.5B (secondary)

| campo | valore |
|-------|--------|
| Accelerator | **Model on GPU** |
| UI wall | **37.8 s** (thinking + answer) |
| words total | ~571 (thinking ~427 + answer ~144) |
| est tokens | ~742 |
| **est tok/s** | **~19.6** |
| Artifact | `results/litert_f1/qwen_ds_gpu_rep1.json` |

Note: R1-distill dumps long CoT; a11y hierarchy hides off-screen bubbles — must scroll to read UI timer.

## 4. Gate vs CPU (Qwen 1.5B class)

| metrica | CPU tg256 | LiteRT GPU (Qwen2.5) | ratio |
|---------|----------:|---------------------:|------:|
| tok/s | **25.80** | **~18.7** | **0.73×** |

**Gate ≥1.15×: FAIL** on 1.5B class (GPU slower than CPU twin).

Compare Gemma-4-E2B (F1 report): GPU ~26.8 vs Llama-3.2-3B CPU 9.7 → **2.76× PASS**.

## 5. Lettura onesta

1. **CPU 1.5B è già veloce** (~26 tok/s Q4) — headroom GPU basso; UI wall include prefill+overhead.
2. **Gemma E2B (~2–3B class)** batte CPU size-matched; **Qwen 1.5B** no, con la stessa metrica UI.
3. Metodo non è pure-decode (stesso caveat F1): se prefill pesa, pure-decode GPU potrebbe essere più alto, ma non abbastanza da ribaltare 0.73× senza instrumentazione nativa.
4. DeepSeek ~19.6 tok/s coerente con Qwen2.5 ~18.7 (stessa fascia, file q8 più grosso).
5. Non confutare il PASS Gemma: il win GPU è **size/stack-dependent**, non universale su ogni dense ≤2B.
6. Per kernel-rewrite ROI: evidenza positiva su E2B-class; su 1.5B Q4 il CPU llama-bench già batte LiteRT Gallery wall.

## 6. Artefatti

```
results/litert_f1/
  llama_bench_qwen_unplugged.json
  qwen25_gpu_rep1.json
  qwen_ds_gpu_rep1.json
  qwen_end.xml, q25_end.xml, …
```

## 7. STOP

Qwen LiteRT unplugged **chiuso** con numeri.  
Opz: qwen3_4b import + GGUF 4B twin se serve fascia intermedia; non bloccante.
