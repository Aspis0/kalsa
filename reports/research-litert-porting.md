# LiteRT porting recon: Qwen3.5-2B/4B — 2026

**Scope:** Can we port product models **Qwen3.5-2B / Qwen3.5-4B** to complete `.litertlm` bundles with **GPU** on Android (S23 Adreno class + MediaTek Mali class), for a React Native app?

**Date of recon:** 2026-08-12. Web-primary sources only; no weight downloads.

**Critical architecture note (load-bearing):** Qwen3.5 is **not** “Qwen3 with more training.” It is a **hybrid Gated DeltaNet + full-attention** decoder (and the public HF cards are multimodal VLMs). That distinction dominates every conversion/GPU answer below.

---

## 1. Conversion support

### Short answer

| Architecture | `export_hf` / official toolchain | Community precedent | GPU-ready path |
|---|---|---|---|
| **Qwen2 / Qwen2.5** (`Qwen2ForCausalLM`) | Yes | litert-community cards | Yes when graph fully delegates (official recipes) |
| **Qwen3 dense** (`Qwen3ForCausalLM`) | Yes | 0.6B / 1.7B / 4B / 8B on litert-community | Yes (official OpenCL numbers) |
| **Qwen3.5** (`qwen3_5` / `Qwen3_5ForCausalLM`) | **No** in published supported list | litert-community 0.8B + third-party 2B | **CPU demonstrated; GPU blocked by full-delegation** on published 0.8B |

### Official supported architectures (2026)

Google’s GenAI conversion docs list Hugging Face architectures verified by `export_hf` via `config.json` `model_type`:

- Gemma 3 / 3n / 4  
- Llama, Mistral  
- **Qwen 2/2.5** (`Qwen2ForCausalLM`)  
- **Qwen 3** (`Qwen3ForCausalLM`)  
- SmolLM 3  

**Qwen3.5 / `Qwen3_5ForCausalLM` is not listed.**  
Source: https://developers.google.com/edge/litert/conversion/pytorch/genai (updated 2026-08-11)

`export_hf` is the streamlined path: HF id or local safetensors → optimizations + quantization → **`.litertlm`** for CPU/GPU/NPU via LiteRT-LM.

```bash
litert-torch export_hf \
  --model=google/gemma-3-270m-it \
  --output_dir=/tmp/gemma3-270m-it-litertlm
```

Default quant recipe: `dynamic_wi8_afp32` (per-channel INT8 weights, FP32 activations) via AI Edge Quantizer. Override with `--quantization_recipe`.

### Qwen examples in the repo

Path: `litert_torch/generative/examples/qwen/` on **google-ai-edge/litert-torch**

| File | Role |
|---|---|
| `qwen.py` | Qwen2-class authoring |
| `qwen3.py` | Qwen3 builders |
| `convert_to_tflite.py` | Qwen2 conversion entry |
| `convert_v3_to_tflite.py` | Qwen3 conversion entry |
| `verify_qwen2.py` / `verify_qwen3.py` | Correctness checks |

`convert_v3_to_tflite.py` sizes: **`0.6b`, `1.7b`, `4b` only** — no 2B, no 3.5.

```python
_MODEL_SIZE = flags.DEFINE_enum(
    'model_size', '1.7b', ['0.6b', '1.7b', '4b'], ...)
```

Source: https://github.com/google-ai-edge/litert-torch/blob/main/litert_torch/generative/examples/qwen/convert_v3_to_tflite.py  
Directory: https://github.com/google-ai-edge/litert-torch/tree/main/litert_torch/generative/examples/qwen

### litert-community HF inventory (Qwen family)

Official collection (as of recon): **Qwen2.5** 0.5B/1.5B/Coder-3B; **Qwen3** 0.6B / 1.7B / 4B / 8B / Thinking-4B; plus ASR/TTS. **No ~2B Qwen3 and no Qwen3.5-2B/4B** in the family collection.

Source: https://huggingface.co/collections/litert-community/qwen-family

**Qwen3.5 exception:** `litert-community/Qwen3.5-0.8B` exists as a **text-decoder-only** hybrid conversion (not in that collection list, but live on HF). It explicitly states:

- First gated-delta-net hybrid served by released LiteRT-LM  
- **Requires litert-lm ≥ 0.15** (generalized state binding / `ExecutorMetadata`)  
- **CPU-only**: GPU fails with full-delegation error  
- Conversion used **litert-torch + hybrid-cache patches**, not stock `export_hf`

Source: https://huggingface.co/litert-community/Qwen3.5-0.8B

Third-party: `paulsp94/Qwen3.5-2B-LiteRT-LM` (~1.9 GB int8 dynamic; claims custom Generative API authoring; shows `Backend.GPU()` in sample Kotlin — **not independently verified here**; no published OpenCL tok/s).

Source: https://huggingface.co/paulsp94/Qwen3.5-2B-LiteRT-LM

Older issue: loading some Qwen3.5 `.litertlm` failed on Gallery / Kotlin with engine create errors (Mar 2026; model card linked then is now 404).

Source: https://github.com/google-ai-edge/LiteRT-LM/issues/1658

### Why Qwen3.5 needs more than “another Qwen3 mapping”

**Qwen3 (dense)** is a standard decoder-only transformer (`Qwen3ForCausalLM`).

**Qwen3.5** (public cards):

- Type: **Causal LM with Vision Encoder** (multimodal)  
- Language stack is a **hybrid layout**, e.g. 4B:  
  `8 × (3 × (Gated DeltaNet → FFN) → 1 × (Gated Attention → FFN))`  
- Gated DeltaNet = linear-attention / recurrent state (fixed-size conv + recurrent buffers), not pure KV-cache transformers  
- Transformers class: **`Qwen3_5ForCausalLM`**, config model type **`qwen3_5`**

Sources:  
- https://huggingface.co/Qwen/Qwen3.5-4B  
- https://huggingface.co/docs/transformers/en/model_doc/qwen3_5  
- Architecture explainers: https://huggingface.co/blog/mlabonne/qwen35  

Adding support therefore involves **more than layer-name remapping**:

1. **Authoring / reauthoring** GatedDeltaNet blocks in LiteRT Torch Generative building blocks (or patching export so state is traceable).  
2. **Hybrid cache contract**: register per-layer conv + recurrent state for `linear_attention` layers; keep standard KV only for full-attention layers.  
3. **Prefill/decode dual graphs** that continue state across chunked prefill and single-step decode (identity-pad guards for partial chunks are known pitfalls).  
4. **StableHLO/TFLite kernel pitfalls** (e.g. in-graph `torch.eye` → `STABLEHLO_IOTA` not registered — must lift identity as constant).  
5. **Runtime packaging**: litert-lm ≥0.15 `ExecutorMetadata` for non-KV state binding.  
6. Optionally drop vision tower + MTP for text-only product parity with GGUF text decode.

Documented in conversion notes of: https://huggingface.co/litert-community/Qwen3.5-0.8B  
(Repro referenced: `john-rocky/hf-to-litertlm` `qwen35_work/`).

If the model is **not** covered by `export_hf`, Google’s path is: **re-author with Generative API building blocks**, then convert — see “Re-author and Convert” on the same GenAI page.

### Published Qwen3.5 conversion guides / notebooks

- **No official Google notebook** for Qwen3.5 found.  
- **Closest primary artifact:** litert-community **Qwen3.5-0.8B** model card + linked hybrid-cache patch notes.  
- **Third-party 2B** card points to custom export tools, not a Google guide.  
- Stock Qwen3 conversion remains the official story (`export_hf` + examples).

### Practical product implication

- **If product can accept Qwen3-4B** (not 3.5): conversion is **first-class** today (`export_hf` or consume litert-community artifacts).  
- **If product is locked to Qwen3.5-2B/4B:** treat as **architecture port**, not “run the CLI.” Expect weeks of authoring/debug unless you fork/reuse community hybrid patches.

### Sources

- https://developers.google.com/edge/litert/conversion/pytorch/genai — export_hf supported architectures; CPU/GPU/NPU claim; quant defaults  
- https://github.com/google-ai-edge/litert-torch/tree/main/litert_torch/generative/examples/qwen — Qwen example paths  
- https://github.com/google-ai-edge/litert-torch/blob/main/litert_torch/generative/examples/qwen/convert_v3_to_tflite.py — Qwen3 sizes 0.6/1.7/4B  
- https://huggingface.co/collections/litert-community/qwen-family — no 3.5-2B/4B official  
- https://huggingface.co/litert-community/Qwen3.5-0.8B — hybrid conversion reality + CPU-only GPU status  
- https://huggingface.co/Qwen/Qwen3.5-4B — Gated DeltaNet hybrid + VLM architecture  
- https://huggingface.co/docs/transformers/en/model_doc/qwen3_5 — `Qwen3_5ForCausalLM`  
- https://huggingface.co/paulsp94/Qwen3.5-2B-LiteRT-LM — third-party 2B attempt  
- https://github.com/google-ai-edge/LiteRT-LM/issues/1658 — early 3.5 load failures  

---

## 2. Why CPU-only

### What actually gates GPU in AI Edge Gallery / LiteRT-LM

GPU is **not** primarily a “mixed_int4 badge” in metadata. Runtime behavior:

1. Engine is created with an explicit backend (`Backend.GPU()` vs `Backend.CPU()`). Gallery defaults accelerator config to **GPU** and maps labels → backends.  
   Source: Gallery `LlmChatModelHelper.kt` — https://github.com/google-ai-edge/gallery/blob/main/Android/src/app/src/main/java/com/google/ai/edge/gallery/ui/llmchat/LlmChatModelHelper.kt  

2. On GPU init, LiteRT **OpenCL / WebGPU / Metal** (ML Drift) must **fully delegate** the prefill/decode graph. If any op is unsupported, and “fully delegated” is required, **engine creation fails** and the UI effectively falls back to CPU-only / error.  

3. File builder supports optional **`backend_constraint`** on TFLite sections (`gpu` / `cpu` / `npu`) and `prefer_activation_type` — this can **constrain** which backends a section is intended for, but the hard gate is still **op support + full delegation**.  
   Source: https://developers.google.com/edge/litert-lm/file_builder  

4. GPU-friendly official exports use **graph optimizations / composite ops** that the LLM GPU path understands (RoPE, fused QKV, fused Gate/Up, cache composites). Example wording on dynamic int4 Qwen3-0.6B: “LiteRT-LM GPU graph optimizations, including composite ops for RoPE, fused QKV, and fused Gate/Up projections.”  
   Source: https://huggingface.co/litert-community/Qwen3-0.6B  

### Why a “mixed_int4” import might show CPU-only while catalog GPU works

**Official** `qwen3_4b_mixed_int4.litertlm` is **not** CPU-only — published **GPU OpenCL** numbers:

| Device | Prefill tok/s | Decode tok/s |
|---|---|---|
| Samsung SM-S937U1 GPU OpenCL | 357.57 | 19.14 |
| vivo V2502A GPU OpenCL | 170.66 | 12.67 |
| TECNO LJ9 GPU OpenCL | 104.37 | 10.86 |

Source: https://huggingface.co/litert-community/Qwen3-4B  

So **TorchAO mixed INT4 ≠ CPU-only by definition.** Mixed int4 recipe (blockwise INT4 g=32 on linears, INT8 embeddings, float norms/KV, StableHLO composites like `odml.runtime_bmm` / `odml.cache_update`) can be GPU-capable when produced by Google’s recipe.

**Likely causes for a third-party mixed_int4 that only offers CPU in Gallery:**

| Cause | Evidence |
|---|---|
| **Incomplete GPU graph / unsupported composite** (e.g. `STABLEHLO_COMPOSITE: odml.softmax`) → full delegation fails | https://github.com/google-ai-edge/litert-torch/issues/1136 (Qwen2.5 export via export_hf produced odml.softmax composites; official reference used plain SOFTMAX; GPU hard-failed) |
| **Wrong or incomplete section packaging** (missing proper PREFILL_DECODE, wrong backend_constraint=cpu) | file_builder model types + backend_constraint |
| **Hybrid / non-standard ops** (GatedDeltaNet state) not supported by GPU delegate | Qwen3.5-0.8B: GPU fails full delegation; CPU works |
| **Runtime version mismatch** (Gallery older than features required) | Qwen3.5-0.8B needs ≥0.15; Gallery 1.0.17 called out as too old |
| **Import UI accelerator list** may be config/heuristic — user must confirm whether GPU was offered then failed at init vs never listed | Gallery wiki import flow |

**Issue #1136 detail (load-bearing for DIY exports):** user export of Qwen2.5-1.5B with `export_hf` got only ~16% nodes delegated; runtime error: *“Hint fully delegated to single delegate is set, but the graph is not fully delegated.”* Official litert-community graph delegated 100%. Recipe flags did not fix it.  
Source: https://github.com/google-ai-edge/litert-torch/issues/1136  

**Qwen3.5-0.8B explicit GPU failure message:** same full-delegation hard fail on GPU backend.  
Source: https://huggingface.co/litert-community/Qwen3.5-0.8B  

### Quantization recipes relevant to LiteRT LLM GPU path (2026)

From official docs + model cards:

| Recipe / scheme | Notes |
|---|---|
| **`dynamic_wi8_afp32`** | Default `export_hf`: dynamic/per-channel INT8 weights, FP32 activations |
| **`weight_only_wi8_afp32` / `weight_only_wi4_afp32`** | Weight-only INT8/INT4, float activations; used in CLI codelabs and NPU/export examples |
| **`dynamic_wi4b32_afp32`** | Dynamic INT4 block-32 weights, FP32 activations; GPU-optimized Qwen3-0.6B variant |
| **TorchAO mixed INT4** | Blockwise INT4 g32 + INT8 embeds + float KV; used for many community Qwen3 cards; **can** be GPU OpenCL |
| **Gemma-4 mobile mixed 2/4/8-bit QAT** | Catalog-class scheme for Gemma 4 (not generic export_hf default) |
| **NPU a16w8 / SRQ / float** | Vendor AOT paths (MediaTek/Qualcomm/Tensor); separate from mobile GPU OpenCL path |

Sources:  
- https://developers.google.com/edge/litert/conversion/pytorch/genai  
- https://codelabs.developers.google.com/codelabs/litert-cli/101  
- https://huggingface.co/litert-community/Qwen3-0.6B  
- https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm  

**Unknown / undocumented:** a single public matrix “quant recipe × op set × Adreno/Mali GPU support.” Treat GPU as **verify-by-delegation**, not by recipe name alone.

### Sources

- https://huggingface.co/litert-community/Qwen3-4B — official mixed_int4 **has** GPU OpenCL  
- https://huggingface.co/litert-community/Qwen3-0.6B — GPU optims + mixed vs dynamic recipes  
- https://github.com/google-ai-edge/litert-torch/issues/1136 — full delegation / odml.softmax CPU fallback mechanism  
- https://huggingface.co/litert-community/Qwen3.5-0.8B — hybrid = CPU-only GPU status  
- https://developers.google.com/edge/litert-lm/file_builder — backend_constraint  
- https://github.com/google-ai-edge/gallery/blob/main/Android/src/app/src/main/java/com/google/ai/edge/gallery/ui/llmchat/LlmChatModelHelper.kt — Gallery backend selection  

---

## 3. Bundling

### Modern preferred path (2026): one-shot `export_hf` → `.litertlm`

```bash
# 1. Install litert-torch (includes export_hf)
# 2. Authenticate if gated
export HF_TOKEN=...

# 3. Convert (example: supported architecture)
litert-torch export_hf \
  --model=Qwen/Qwen3-4B \
  --output_dir=/tmp/qwen3-4b-litertlm \
  --quantization_recipe=dynamic_wi8_afp32
  # optional GPU-oriented knobs seen in issues / docs:
  # --externalize_embedder
  # --prefill_lengths=... --cache_length=...
  # --enable_gpu_dynamic_prefill / --enable_gpu_dynamic_cache (when available)

# 4. Smoke on desktop
litert-lm run /tmp/qwen3-4b-litertlm/*.litertlm --backend=gpu --prompt="..."
```

Docs state export produces a `.litertlm` “compatible for CPU and GPU inference” for supported architectures.  
Source: https://developers.google.com/edge/litert/conversion/pytorch/genai  

### Manual / advanced path: tflite (+ tokenizer) → `litert-lm-builder`

A `.litertlm` is a **container**: TFLite section(s) + tokenizer + LLM metadata + system metadata.

Install: `pip install litert-lm-builder`

**CLI shape:**

```bash
litert-lm-builder \
  system_metadata --str author "Authors" \
  llm_metadata --path path/to/llm_metadata.pb \
  sp_tokenizer --path path/to/sp.model \
  # OR: hf_tokenizer --path path/to/tokenizer.json \
  tflite_model --path path/to/model.tflite --model_type prefill_decode \
    --str_metadata model_version "1.0.1" \
  output --path model.litertlm
```

**TFLite model types (must match runtime expectations):**

- `prefill_decode` (combined; common for complete LLM bundles)  
- `prefill` / `decode` (split)  
- `embedder`  

Inspect: `litert-lm-peek --litertlm_file model.litertlm`  
Unpack/repack: `litert-lm-builder unpack ...`

Source: https://developers.google.com/edge/litert-lm/file_builder  

### Legacy MediaPipe bundling (maintenance path)

Older stack: convert to multi-signature `.tflite` → `mediapipe.tasks.python.genai.bundler` Task Bundle (`.task` / `.litertlm`).  
Docs note Torch Generative converter historically **CPU-oriented** and **≥64 GB RAM Linux** for conversion.  
MediaPipe LLM API is **maintenance-only**; migrate to LiteRT-LM.  

Source: https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference  

### What causes `TF_LITE_PREFILL_DECODE not found`

Class of failures = **bundle incomplete / wrong section typing / wrong artifact**.

Required for a complete LLM load (from file_builder + failure reports):

1. A TFLite section with model type **PREFILL_DECODE** (or separate PREFILL + DECODE covering both phases).  
2. Tokenizer section (SP or HF).  
3. LLM metadata (prompt template, stop tokens, etc.).  
4. Expected signatures / outputs for the executor (e.g. logits). Missing logits → *“Output logits not found”* / FAILED_PRECONDITION when loading non-final artifacts.  

Sources:  
- https://developers.google.com/edge/litert-lm/file_builder — `PREFILL_DECODE` section type  
- https://discuss.huggingface.co/t/functiongemma-mobile-deployment-help/172116 — wrong file / missing logits signatures  
- User context: locally prepped `gemma-4-E2B-it-gpu.litertlm` failed with `TF_LITE_PREFILL_DECODE not found` → consistent with **partial pack** (e.g. only weights, only embedder, or wrong model_type), not a complete catalog-style LLM bundle.

**Inspect checklist after any DIY build:**

```bash
litert-lm-peek --litertlm_file your.litertlm
# Expect: TFLiteModel type PREFILL_DECODE (or prefill+decode), tokenizer, llm_metadata
```

### Sources

- https://developers.google.com/edge/litert/conversion/pytorch/genai  
- https://developers.google.com/edge/litert-lm/file_builder  
- https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference  
- https://discuss.huggingface.co/t/functiongemma-mobile-deployment-help/172116  

---

## 4. Product integration (React Native Android)

### (a) MediaPipe LLM Inference API

| Topic | Status (2026) |
|---|---|
| Product posture | **Maintenance-only**; Google recommends **LiteRT-LM Android (Kotlin)** |
| Custom models | Yes: custom `.litertlm` / `.task` via conversion + path; Gallery demonstrates import of custom files |
| GPU | `preferredBackend` CPU/GPU on Android for some models; LoRA path **GPU-only**; docs historically emphasize GPU models for some features |
| Device bar | Optimized for high-end phones (**Pixel 8, Samsung S23 or later** class); emulators unreliable |
| Deps example | `com.google.mediapipe:tasks-genai:0.10.27` (docs snapshot) |

Sources:  
- https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference  
- https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android  

**Verdict for new product work:** do **not** build on MediaPipe LLM Inference; use **LiteRT-LM**.

### (b) LiteRT-LM C++ API maturity

| Surface | Status |
|---|---|
| **C++** | Documented as **Stable** — `Engine` + recommended high-level **`Conversation`** API |
| **Kotlin (Android)** | **Stable** |
| **Python / CLI** | **Stable** |
| **Swift / JS** | Early preview |
| **C API prebuilts** | Added in **v0.16.0** (shared library prebuilts for bindings without building from source) |
| Features | GPU/NPU backends, multimodal, tools/constrained decoding, MTP speculative decoding on GPU |

Sources:  
- https://developers.google.com/edge/litert-lm/overview  
- https://developers.google.com/edge/litert-lm/cpp  
- https://github.com/google-ai-edge/LiteRT-LM  

C++ is production-grade for native embedding; Kotlin is the path of least resistance on Android.

### (c) React Native wrappers

| Package | Nature | Notes |
|---|---|---|
| **`react-native-litert-lm` / `@inferrlm/react-native-litert-lm`** (hung-yueh / forks) | Community Nitro Modules (JSI) over LiteRT-LM | Android Kotlin + iOS C++; Gemma-4 oriented; **not official Google** |
| **`expo-litert-lm`** | Expo community option | RC/early |
| **`react-native-llm-mediapipe`** | Older MediaPipe-era RN wrapper | Stack is maintenance-only upstream |
| **Custom Expo native module tutorials** | e.g. FunctionGemma demos | Pattern: Expo native module → Kotlin LiteRT-LM |

Sources:  
- https://github.com/hung-yueh/react-native-litert-lm  
- https://www.npmjs.com/package/@inferrlm/react-native-litert-lm  
- https://www.youtube.com/watch?v=Py8eC8s49WE (RN + LiteRT-LM pattern, Feb 2026)  

**No first-party Google React Native SDK** found.

### Realistic integration effort (shipping RN Android)

| Workstream | Effort estimate | Notes |
|---|---|---|
| Wire official/catalog `.litertlm` (Gemma / Qwen3) via community RN lib or thin Kotlin bridge | **1–3 eng-weeks** | Model download, engine lifecycle, streaming callbacks, memory OOM discipline |
| Production hardening (background, thermal, multi-session, crash recovery) | **+2–4 weeks** | Gallery source is the reference app |
| **Qwen3.5 conversion + GPU** (architecture port) | **+4–12+ eng-weeks**, high risk | Dominates schedule; may still be CPU-only |
| Stick with **llama.rn GGUF** for Qwen3.5 product models | **Already working** | Trade: no LiteRT GPU path; known CPU tok/s |

**Recommendation:** integrate LiteRT-LM for models that already have GPU-capable official bundles; keep llama.rn for Qwen3.5 until hybrid GPU lands — or switch product weights to **Qwen3-4B litertlm** if architecture swap is acceptable.

### Sources

- https://developers.google.com/edge/litert-lm/overview  
- https://developers.google.com/edge/litert-lm/cpp  
- https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android  
- https://github.com/hung-yueh/react-native-litert-lm  
- https://github.com/google-ai-edge/gallery  

---

## 5. Mali coverage

### Does LiteRT LLM GPU run on ARM Mali?

**Yes, via OpenCL GPU path** on MediaTek devices in official cards — not Adreno-only.

Evidence:

1. LiteRT platform matrix: Android GPU = **OpenCL + OpenGL** (ML Drift).  
   Source: https://developers.google.com/edge/litert/overview  

2. **TECNO LJ9** (TECNO POVA 7 Ultra 5G) appears repeatedly with **GPU OpenCL** rows for Qwen3 models. Device uses **MediaTek Dimensity 8350 Ultimate + Mali-G615 MC6**.  

   Example (Qwen3-0.6B mixed_int4, LiteRT-LM v0.13.1):  
   - GPU OpenCL: prefill **637** tok/s, decode **33.5** tok/s  
   - CPU: prefill 231, decode 8.3  

   Sources:  
   - https://huggingface.co/litert-community/Qwen3-0.6B  
   - https://www.gsmarena.com/tecno_pova_7_ultra_5g-13976.php (Mali-G615 MC6)  

3. **Qwen3-4B mixed_int4** on TECNO LJ9 GPU OpenCL: prefill **104.4**, decode **10.9** tok/s.  
   Source: https://huggingface.co/litert-community/Qwen3-4B  

4. **vivo V2502A** (MediaTek Dimensity 9500 class / Immortalis-class SoC in product marketing) also shows GPU OpenCL rows; NPU-specialized artifacts are separate (`*.mediatek.*.litertlm`).  
   Sources: https://huggingface.co/litert-community/Qwen3-0.6B ; https://developers.googleblog.com/mediatek-npu-and-litert-powering-the-next-generation-of-on-device-ai/  

5. Community video claim of Gallery GPU on **Mali-G68** (anecdotal, not a model card): https://www.youtube.com/watch?v=bSuh6Ok5tOw  

### Caveats

- **GPU success still depends on full graph delegation** of the specific model — hybrid Qwen3.5 may fail GPU on Mali the same way it fails on Adreno/Metal today.  
- **NPU** on MediaTek is a **different** AOT path (`--aot_backend=mediatek`), not the same as OpenCL GPU.  
- Mid-range Mali G57 / older G7xx: **no systematic public tok/s table found** in official cards; LJ9 (G615) is the strongest published mid-premium Mali data point.

### Product implication

LiteRT’s OpenCL GPU path **does cover MediaTek Mali phones** for **standard** Qwen3/Gemma graphs — a major advantage over hand-rolled Adreno OpenCL kernels. **Does not automatically cover Qwen3.5 hybrid graphs.**

### Sources

- https://developers.google.com/edge/litert/overview  
- https://huggingface.co/litert-community/Qwen3-0.6B  
- https://huggingface.co/litert-community/Qwen3-4B  
- https://www.gsmarena.com/tecno_pova_7_ultra_5g-13976.php  
- https://developers.googleblog.com/mediatek-npu-and-litert-powering-the-next-generation-of-on-device-ai/  

---

## 6. Conversion logistics

### Hardware / environment

| Item | Guidance | Source |
|---|---|---|
| **OS** | Linux strongly preferred for Torch Generative conversion | MediaPipe conversion note |
| **RAM** | **≥64 GB** called out for Torch Generative LLM conversion | https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference |
| **GPU for conversion** | Not required for weight-only / AI Edge Quantizer PTQ recipes; GPU helps host-side torch speed but is secondary to **host RAM** for export/trace | GenAI export docs emphasize tooling, not a conversion GPU |
| **Disk** | Multiple× model size (bf16 weights + intermediates + .litertlm) | Common engineering practice; exact not documented |
| **2B vs 4B** | 4B needs substantially more peak RAM during export/quant than 2B; 64 GB may be tight for large context export of 4B multimodal full stack — **text-only decoder export recommended** for product | Inferred; Qwen3.5-4B is multimodal 5B-params class on HF |

### Rough wall time (order of magnitude; not officially published)

| Stage | 2B-class | 4B-class |
|---|---|---|
| Download + HF load | minutes | minutes–tens of minutes |
| Trace/export + quant (`export_hf` on supported arch) | ~30 min–few hours on workstation | ~1–several hours |
| Hybrid authoring debug (Qwen3.5) | **days–weeks** first successful CPU | same + larger memory risk |
| Device GPU validation loop | hours–days per architecture/op bug | same |

### Top known pitfalls

1. **Wrong architecture class** — treating Qwen3.5 as Qwen3 `export_hf` target.  
2. **Incomplete `.litertlm`** — missing `PREFILL_DECODE` / tokenizer / metadata → load errors.  
3. **GPU full-delegation failure** — unsupported composites (e.g. `odml.softmax`), hybrid state ops; recipe name does not guarantee GPU.  
4. **Runtime version skew** — Qwen3.5 hybrid needs **litert-lm ≥ 0.15**; Gallery APK may lag.  
5. **Chat template / stop tokens** — Qwen3.5 `<|im_end|>` vs eos mismatches; multi-turn incremental template constraints.  
6. **Multimodal bloat** — exporting full VLM when product needs text-only.  
7. **NPU vs GPU confusion** — MediaTek NPU AOT artifacts ≠ mobile OpenCL GPU path.  
8. **DIY export quality gap vs official graphs** (issue #1136 binary comparison).  
9. **Host OOM** during export (docs: increase RAM / quantize / reduce export shapes).  
10. **Thinking-mode templates** and LiteRT-LM history rendering constraints.

### Sources

- https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference — 64 GB RAM  
- https://developers.google.com/edge/litert/conversion/pytorch/genai  
- https://huggingface.co/litert-community/Qwen3.5-0.8B — hybrid pitfalls  
- https://github.com/google-ai-edge/litert-torch/issues/1136  

---

## 7. Quality

### What exists

- **No head-to-head public study** found of **LiteRT LLM int4/int8 vs llama.cpp K-quants on the same Qwen3.5-2B/4B checkpoint** (perplexity or MMLU) as of this recon.  
- Arm’s mobile quant guide measures **WikiText-2 perplexity / MMLU inside llama.cpp** for various schemes and separately measures **LiteRT-LM throughput** — useful methodology, **not** a cross-runtime quality bake-off for Qwen3.5.  
  Source: https://developer.arm.com/community/arm-community-blogs/b/ai-blog/posts/llm-quantization-for-mobile-deployment  
  Example (Gemma-3-1B, llama.cpp quality table in that post): FP16 PPL 10.79; W8_AFP16 ~10.80; W4_AFP16 ~11.06.  

- **litert-community Qwen3.5-0.8B** reports **logits-level match** of float export to HF, and **8/8 greedy word match** on a small gate; notes **int8 dynamic costs quality on harder multi-question prompts** at 0.8B scale; delta-rule/convs kept float by design.  
  Source: https://huggingface.co/litert-community/Qwen3.5-0.8B  

- Third-party Apple Silicon benches (not Google) sometimes compare LiteRT-LM vs llama.cpp quality scores on other models — **not product-authoritative for Qwen3.5 Android**.  

### Practical takeaway

Expect **dynamic INT8 LiteRT** to be quality-competitive with mid K-quants on standard transformers when the graph is correct; **do not assume** parity for **hybrid GatedDeltaNet + aggressive int4** without your own eval harness (MMLU-lite / task suite + S23 decode). For product risk, budget a **quality gate** after any DIY quant.

### Sources

- https://developer.arm.com/community/arm-community-blogs/b/ai-blog/posts/llm-quantization-for-mobile-deployment  
- https://huggingface.co/litert-community/Qwen3.5-0.8B  

---

## VERDICT

### **FEASIBLE_WITH_WORK(Qwen3.5 GPU + RN); FEASIBLE_NOW(Qwen3-4B GPU path)**

**Interpretation for product models Qwen3.5-2B/4B:**

| Goal | Verdict |
|---|---|
| Convert **Qwen3.5-2B/4B** to loadable **CPU** `.litertlm` | **FEASIBLE_WITH_WORK** — community 0.8B proves architecture; 2B third-party exists; requires hybrid authoring/patches + litert-lm ≥0.15; **not** stock `export_hf` |
| Convert **Qwen3.5-2B/4B** with **GPU** on Adreno/Mali like Gemma catalog | **BLOCKED for stock toolchain / currently unreliable** — published official hybrid (0.8B) is **CPU-only** (full GPU delegation fails); no Google GPU recipe for GatedDeltaNet LLM path documented |
| Use **LiteRT GPU** for a Qwen ~4B on S23 / MediaTek | **FEASIBLE_NOW** if product accepts **Qwen3-4B** (or smaller Qwen3) official/community bundles — GPU OpenCL numbers published including **Mali G615** device |
| Ship in **React Native Android** | **FEASIBLE_NOW** for standard `.litertlm` via LiteRT-LM Kotlin bridge or community RN wrapper; MediaPipe path is legacy |

### Recommended first command/recipe

**A. If product can swap to Qwen3-4B for LiteRT GPU (recommended technical path):**

```bash
pip install litert-torch litert-lm-builder
# Prefer consuming official artifact first:
# uvx litert-lm run --from-huggingface-repo=litert-community/Qwen3-4B \
#   qwen3_4b_mixed_int4.litertlm --backend=gpu --prompt="..."

# Or convert yourself (supported architecture):
litert-torch export_hf \
  --model=Qwen/Qwen3-4B \
  --output_dir=/tmp/qwen3-4b-litertlm \
  --quantization_recipe=dynamic_wi8_afp32
# Then validate:
litert-lm-peek --litertlm_file /tmp/qwen3-4b-litertlm/*.litertlm
litert-lm run /tmp/qwen3-4b-litertlm/*.litertlm --backend=gpu --verbose --prompt="What is the capital of France?"
# Device: import into AI Edge Gallery; confirm GPU accelerator initializes without full-delegation errors
```

**B. If product is locked to Qwen3.5-4B (hybrid):**

```bash
# Do NOT expect this to work unmodified:
# litert-torch export_hf --model=Qwen/Qwen3.5-4B ...

# Start from published hybrid reference + patches:
# 1) Study https://huggingface.co/litert-community/Qwen3.5-0.8B conversion notes
# 2) Reuse hybrid-cache export patches (john-rocky/hf-to-litertlm qwen35_work or paulsp94 export tools)
# 3) Target text-only Qwen3_5ForCausalLM (drop vision/MTP)
# 4) litert-lm ≥ 0.15; validate CPU first
# 5) GPU only after graph audit for unsupported composites / full delegation
```

### Work list if FEASIBLE_WITH_WORK (Qwen3.5 product + GPU ambition)

1. **Architecture decision:** accept **Qwen3-4B LiteRT** for GPU now, vs force Qwen3.5 hybrid port.  
2. **Spike (1 week):** load `litert-community/Qwen3-4B` mixed_int4 on S23 Gallery GPU; measure tok/s vs current llama.rn baselines.  
3. **Spike (1 week):** load `Qwen3.5-0.8B` / third-party 2B on desktop litert-lm ≥0.15 CPU; confirm Gallery APK version readiness.  
4. **Port:** author GatedDeltaNet + hybrid state export for 2B then 4B text-only; logits match vs HF.  
5. **Quant recipe matrix:** dynamic int8 first; then wi4b32 / mixed_int4 if quality holds.  
6. **GPU enablement:** graph rewrite until OpenCL full delegation (may require runtime kernel work beyond app team).  
7. **Bundle QA:** `litert-lm-peek` + Gallery import + no `PREFILL_DECODE` / logits errors.  
8. **RN integration:** Kotlin LiteRT-LM module or harden `react-native-litert-lm`; engine lifecycle + streaming.  
9. **Mali device QA** on at least one Dimensity + Mali-G6xx phone.  
10. **Quality gate:** task suite vs GGUF Q4_K_M production baseline.  

### Bottom line (brutal)

- **LiteRT GPU on S23 for “a ~2–4B Qwen” is real today for Qwen3-class official graphs**, and **Mali OpenCL is proven** on TECNO-class MediaTek phones.  
- **Your product weights are Qwen3.5**, which is a **different architecture**. Google’s `export_hf` does **not** list it; the only first-party hybrid package is **0.8B and CPU-only**.  
- **DIY GPU for Qwen3.5 is the hard part**, not React Native packaging.  
- Fastest path to GPU win: **switch to Qwen3-4B `.litertlm` (or wait for official 3.5 GPU)**. Fastest path to keep Qwen3.5 behavior: **stay on llama.rn** until hybrid GPU exists.

DONE
