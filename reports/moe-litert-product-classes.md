# moe-litert-product-classes — Qwen ~2B / ~4B dense (S23 LiteRT vs CPU)

**Data:** 2026-08-12  
**Device:** Galaxy S23 (SM-S911U) · Adreno 740  
**Power:** **UNPLUGGED** (AC/USB/Wireless = false) · batt ~57%→53% · temp max ~36.8°C  
**Gallery:** `com.google.ai.edge.gallery` 1.0.18  
**Method:** same as F1 / Qwen prior — UI wall label + words×1.3; llama-bench `-t 4 -ngl 0 -p 128 -n 256 -r 2` twin  
**Goal:** GO/NO-GO for custom GPU kernels on product dense classes (~2B and ~4B)

## 1. Models tested

| model | stack | size | note |
|-------|-------|-----:|------|
| qwen3_4b_mixed_int4.litertlm | Gallery import (LITERTLM) | 2.7 GB | **Qwen3-4B** (not 3.5) — size-class twin; listed Imported / Downloaded |
| Qwen3.5-4B-Q4_K_M.gguf | llama-bench CPU | 2.74 GB | sha256 `00fe7986…11a4` on device |
| Qwen3.5-2B-Q4_K_M.gguf | llama-bench CPU | 1.28 GB | pushed; sha256 `aaf42c8b…f74d` |
| official ~2B Qwen `.litertlm` | LiteRT GPU | — | **absent** from litert-community |
| qwen35_2b.litertlm (import) | LTLM magic | 1.9 GB | still listed; prior run **Gallery rejected** (wrong magic) |
| Qwen2.5-1.5B GPU (prior) | LiteRT GPU | 1.6 GB | 18.7 tok/s — already on file, not re-run |

## 2. CPU twins (llama-bench, UNPLUGGED)

### 2a. Qwen3.5-4B-Q4_K_M

| | |
|--|--|
| Bin | Termux `build-safe` llama-bench · `-t 4 -ngl 0` |
| Artifact | `results/litert_product/llama_bench_qwen35_4b.json` |
| Teardown | segfault exit 139 (same as prior; JSON valid) |

| test | n | avg tok/s | samples |
|------|---|----------:|---------|
| prefill pp128 | 128 | **16.91** | 17.03 / 16.80 |
| **decode tg256** | 256 | **8.38** | **8.55 / 8.21** |

### 2b. Qwen3.5-2B-Q4_K_M

| | |
|--|--|
| Bin | same build-safe · `-t 4 -ngl 0` |
| Artifact | `results/litert_product/llama_bench_qwen35_2b.json` |
| Teardown | segfault exit 139 (JSON valid) |

| test | n | avg tok/s | samples |
|------|---|----------:|---------|
| prefill pp128 | 128 | **44.13** | 44.51 / 43.75 |
| **decode tg256** | 256 | **18.10** | **18.52 / 17.68** |

## 3. LiteRT / Gallery GPU cells

### 3a. Cell 4B-GPU — **NO GPU OPTION** (not measurable as GPU)

| campo | valore |
|-------|--------|
| Model | qwen3_4b_mixed_int4.litertlm (Imported, Downloaded) |
| Settings → Accelerator | **CPU only** (no GPU chip in UI) |
| After gen label | **Model on CPU** |
| Evidence | `q4b_cfg.xml`, `q4b_r1_p1.xml`, `cell_4b_gpu_NO_GPU_OPTION.json` |

Gallery wall runs still completed (CPU backend) for method continuity — **not** a GPU gate number:

#### Rep 1

| campo | valore |
|-------|--------|
| Prompt | "Explain coffee in five sentences." |
| UI wall | **14.6 s** |
| words | 64 |
| est tokens (×1.3) | **83.2** |
| **est tok/s** | **5.70** |
| Label | Model on CPU |
| Artifact | `qwen3_4b_gallery_rep1.json` |

#### Rep 2

| campo | valore |
|-------|--------|
| Prompt | "List ten facts about coffee, one line each." |
| UI wall | **20.0 s** (timer required scroll) |
| words visible | 81 (item 5 line missing from a11y tree) |
| est tokens (×1.3) | **105.3** |
| **est tok/s** | **5.27** |
| Label | Model on CPU |
| Artifact | `qwen3_4b_gallery_rep2.json` |

**HF note:** `litert-community/Qwen3-4B` documents Android GPU OpenCL (e.g. SM-S937U1 ~19 tok/s decode) via LiteRT-LM — but Gallery 1.0.18 on this S23 does **not** expose GPU for the imported LTLM.

### 3b. Cell 2B-GPU — **BLOCKED**

| campo | valore |
|-------|--------|
| Official litert-community ~2B Qwen LTLM | **none** (Qwen family: 0.5B / 0.6B / 1.5B / 4B only) |
| `litert-community/Qwen3.5-2B-LiteRT` | **404** |
| Unofficial `qwen35_2b.litertlm` | still listed Imported 1.9 GB; prior **reject** (wrong LTLM magic) — not re-imported |
| Artifact | `cell_2b_gpu_BLOCKED.json` |

Do **not** re-run 1.5B GPU (18.7 already on file).

## 4. Gate table (pre-declared ≥1.15×)

| class | CPU tg256 | LiteRT GPU est | ratio | gate ≥1.15× |
|-------|----------:|---------------:|------:|-------------|
| **~2B product** | **18.10** | **BLOCKED** (no official bundle) | — | **BLOCKED** |
| **~4B product** | **8.38** | **NO GPU OPTION** in Gallery | — | **BLOCKED** |
| 1.5B (prior) | 25.80 | ~18.7 | 0.73× | **FAIL** |
| E2B / 3B-class (prior) | 9.70 | ~26.8 | 2.76× | **PASS** |

### Size curve (CPU decode tg256, this device)

| size class | model | tok/s |
|------------|-------|------:|
| 1.5B | Qwen2.5-1.5B Q4_K_M (prior) | **25.80** |
| 2B | Qwen3.5-2B Q4_K_M (**new**) | **18.10** |
| 3B-class | Llama-3.2-3B Q4_K_M (prior) | **9.70** |
| 4B | Qwen3.5-4B Q4_K_M (**new**) | **8.38** |

### Size curve (LiteRT Gallery GPU wall est)

| size class | model | est tok/s |
|------------|-------|----------:|
| E2B | Gemma-4-E2B-it (prior) | **~26.8** |
| 1.5B | Qwen2.5-1.5B (prior) | **~18.7** |
| 2B product | — | **BLOCKED** |
| 4B product | qwen3_4b mixed_int4 | **no GPU path** (CPU wall ~5.5 only) |

## 5. Honest caveats

1. **UI wall includes prefill + overhead**, not pure decode (same as F1/Qwen).
2. **Token count = words × 1.3**, not official tokenizer.
3. **4B model-version mismatch:** Gallery LTLM is **Qwen3-4B**; CPU twin is **Qwen3.5-4B** Q4_K_M — size-class twin, not same-weights.
4. **4B GPU cell is not a GPU measurement** — Gallery only offered CPU; chat label "Model on CPU".
5. **2B GPU cell blocked** before timing — no official Gallery-compatible bundle; unofficial already rejected.
6. llama-bench **segfault on teardown** (exit 139) after both tests completed — numbers in JSON are valid (same prior pattern).
7. Official HF OpenCL numbers on other SKUs are **not** this Gallery wall metric and were not re-run here.

## 6. Product reading (GO/NO-GO)

| domanda | esito |
|---------|--------|
| Can we measure GPU ≥1.15× CPU on product ~2B via Gallery? | **NO — BLOCKED** (no official LTLM) |
| Can we measure GPU ≥1.15× CPU on product ~4B via Gallery? | **NO — BLOCKED** (GPU not offered in Gallery UI) |
| CPU size curve consistent? | **YES** — 25.8 → 18.1 → 9.7 → 8.4 tok/s |
| Does 1.5B FAIL still stand? | **YES** (0.73×) |
| Does E2B PASS still stand? | **YES** (2.76×) — different stack/size class |
| **ROI for custom GPU kernels on product dense 2B/4B (Gallery path)?** | **NO-GO** on current evidence: 2B has no official GPU bundle; 4B import does not expose GPU in Gallery 1.0.18 on S23; adjacent 1.5B Qwen GPU already loses to CPU |

Kernel-rewrite ROI remains conditional on stacks that already pass (e.g. Gemma E2B-class), not a blanket dense ≤4B win.

## 7. Artefatti

```
results/litert_product/
  battery_notes.md
  battery_*_raw.txt
  cell_2b_gpu_BLOCKED.json
  cell_4b_gpu_NO_GPU_OPTION.json
  gallery_start.xml, models_list.xml, ml_*.xml
  q4b_cfg.xml, q4b_ready.xml, q4b_r1_*.xml, q4b_r2_*.xml
  qwen3_4b_gallery_rep1.json
  qwen3_4b_gallery_rep2.json
  llama_bench_qwen35_4b.json
  llama_bench_qwen35_2b.json
```

## 8. STOP

Product-class twin **closed**:
- 4B-GPU: **BLOCKED** (Gallery NO GPU OPTION)
- 2B-GPU: **BLOCKED** (no official bundle)
- 4B-CPU + 2B-CPU: **measured** (8.38 / 18.10 tg256)
- Gate verdicts: both product classes **BLOCKED** → product dense custom-GPU **NO-GO** on this path
