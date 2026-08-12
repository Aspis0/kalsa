# Published LLM GPU results on Adreno 750 / 8 Gen 3 / 8 Elite

**Question we cannot measure ourselves right now:** on Adreno 750+ (Snapdragon 8 Gen 3) and Adreno 830 (8 Elite), does the llama.cpp OpenCL path beat CPU decode on 2–4B dense models?

**Our 740 baseline (S23 / 8 Gen 2, no subgroup broadcast):** OpenCL decode loses to CPU (~0.56–0.74×), output correct. Gate we care about: **Qwen3.5-2B/4B Q4_K_M, OpenCL decode ≥ 1.15× same-device CPU**.

This report is web-only. Every load-bearing claim has a URL. Adreno 740 / 750 / 830 / 840 are kept distinct. Quants are kept distinct.

---

## 0. Hardware map (do not mix these)

| Marketing SoC | GPU | Generation in llama.cpp OpenCL | Typical phones |
|---|---|---|---|
| Snapdragon 8 Gen 2 | **Adreno 740** | A7X | S23 (SM-S911), our measured device |
| Snapdragon 8 Gen 3 | **Adreno 750** | A7X | S24 US family SM-S921/S926/S928, Xiaomi 14, Lenovo Y700 2025 (sm8650p) |
| Snapdragon 8 Elite (aka 8 Gen 4) | **Adreno 830** | A8X | S25 family SM-S931/S937/S938 |
| Snapdragon 8 Elite Gen 5 | **Adreno 840** | A8X | S26-class / later flagships — **not** 750 or 830 |
| Snapdragon X / X2 (laptops) | Adreno X1-85 / **X2-90** | laptop, not phone | WoS PCs — Qualcomm's favorite bench device |

Official llama.cpp OpenCL verified list: Adreno 750, 810, 830, 840, X1-85, X2-90.
Source: https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md

---

## 1. llama.cpp OpenCL on 8 Gen 3 / 8 Elite — published decode (tg) numbers

### 1.1 Qualcomm's own blog: **no tok/s table**

Hongqiang Wang et al., *Introducing the new OpenCL GPU backend in llama.cpp for Qualcomm Adreno GPUs* (originally Dec 2024, updated Feb 2025):

- Claims the backend is “well tested and optimized for premium Adreno GPUs”.
- Tested on **Android phones with 8 Gen 1, 2, 3, and 8 Elite**, plus Snapdragon X Elite/Plus laptops.
- “Primarily based on the OpenCL 3.0 standard, with **optional features like subgroups** to achieve optimal performance.”
- **Optimized path is Q4_0.** Quote: “currently the Adreno OpenCL backend has been optimized for the weights using the **Q4_0** quantization scheme. The optimization for weights using other schemes, such as FP16 and Q6, is in progress.”
- Example launch line uses `ggml-model-qwen1.5-7b-chat-Q4_0.gguf -ngl 99`.
- **No CPU numbers. No tg/pp table at all.**

https://www.qualcomm.com/developer/blog/2024/11/introducing-new-opn-cl-gpu-backend-llama-cpp-for-qualcomm-adreno-gpu

OPENCL.md later lists Q4_K / Q5_K / Q6_K as “Support”, but that is *functional* support, not “as fast as Q4_0”. Binary kernel library (inline-asm, not OSS) is **X2-only** (X2-90/85/45) and only for MUL_MAT_ID Q4_0/Q4_1/Q4_K/MXFP4 — irrelevant to phone 750/830 dense decode.

https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md

### 1.2 IWOCL 2025 Qualcomm slide deck — MLC/TVM, **not** llama.cpp

Siva Rama Krishna Reddy B, *Opensource Deep learning Compiler Solution Updates for Qualcomm Adreno GPU*, IWOCL 2025. These are **MLC/TVM q4f16_0**, GPU-only, no CPU column:

| Model (q4f16_0, MLC) | 8 Gen 3 decode t/s | 8 Elite decode t/s | 8 Gen 3 encode 256 (t/s) | 8 Elite encode 256 (t/s) |
|---|---:|---:|---:|---:|
| DeepSeek-R1-Distill-Qwen-1.5B | 22.2 | 50 | 232 | 413 |
| gemma-2b-it | 14.77 | 33.25 | 244.7 | 293.5 |
| phi-2 | 28.9 | 30 | 137.7 | 145.4 |
| Phi-3-mini-4k-instruct | 22.6 | 24.88 | 145.5 | 156.4 |
| DeepSeek-R1-Distill-Llama-8B | 11.1 | 12.5 | 64 | 95 |
| Meta-Llama-3-8B-Instruct | 11.1 | 12.5 | 80.5 | 84.6 |
| Qwen-7B-Chat | 12.3 | 11.9 | 72.3 | 72.5 |

Notes:

- **Not llama.cpp. Not Q4_0/Q4_K. No CPU.**
- 8 Elite vs 8 Gen 3 decode is ~1.1× on 7–8B and ~2.25× on 1.5–2B (DeepSeek-1.5B 22.2 → 50; gemma-2b 14.77 → 33.25). Prefill/encode jumps more than decode on the small models.
- Useful only as “Qualcomm-tuned OpenCL *can* produce those absolute GPU rates on these SoCs under MLC”.

https://www.iwocl.org/wp-content/uploads/iwocl-2025-siva-rama-krishna-reddy-b-deep-learning.pdf

### 1.3 Qualcomm PRs with real llama.cpp OpenCL tg tables

Qualcomm (lhez / wanghqc) publishes llama-bench tables, but almost always on **X2-90 (laptop)** or **Adreno 840 (8 Elite Gen 5)** — not 750.

**PR #24160 (merged, Jun 2026) — X2-90 laptop, Q4_K_M, OpenCL, `-fa 0`.** This is the closest published Qwen3.5 / Q4_K_M OpenCL decode table. After the get_rows/cpy/q6_K gemv fix (explicitly motivated by Qwen3.5):

| Model | quant | device | pp512 | tg128 |
|---|---|---|---:|---:|
| Qwen3.5 4B | **Q4_K_M** | X2-90 OpenCL | 349 | **23.35** |
| Qwen3.5 9B | Q4_K_M | X2-90 OpenCL | 200 | 14.44 |
| Qwen3 4B | Q4_K_M | X2-90 OpenCL | 377 | 26.03 |
| Qwen3 8B | Q4_K_M | X2-90 OpenCL | 217 | 15.99 |
| Llama-3.2 3B | Q4_K_M | X2-90 OpenCL | 505 | 33.12 |

No CPU column. X2-90 is a laptop GPU with far more bandwidth than phone 750/830.

https://github.com/ggml-org/llama.cpp/pull/24160

**PR #14635 (open) — Adreno 830, Llama-3.2-1B F16 (not Q4):**

| | pp512 | tg128 |
|---|---:|---:|
| master | 168.17 | 22.61 |
| this PR | 193.79 | 22.67 |

GPU-only, F16 1B. Decode barely moves (GEMV-bound). No CPU.

https://github.com/ggml-org/llama.cpp/pull/14635

**PR #26477 (draft, Aug 2026) — Adreno 840 (A8X, *not* 750/830), Qwen3-4B Q4_K_M:**

- Upstream OpenCL: **tg128 = 14.45 t/s**
- With tiled lm_head / multi-row f16 GEMV / q4_K GLU fusion: **16.91 t/s (+17%)**
- Explicit gate: **“The A7X regresses on the tiled layout and is excluded.”** A7X = 740 **and** 750.

https://github.com/ggml-org/llama.cpp/pull/26477

**PR #26430 (draft) — flash-attn decode, X2-90 / X1-85 / Adreno 840:**

- Qwen3-4B Q4_K_M FA gains: X2-90 +4.8%, X1-85 +18%, **Adreno 840 +61%**.
- “On the Adreno 840, GQA=4 at head_dim 128 previously ran *slower* with flash attention than without. FA-on now beats FA-off by 9–13%.”
- **“The Adreno 740 and 850 cannot reach these kernels: the A7X declines every mixed and quantized FA combination (`clBuildProgram` SIGSEGV).”** 750 is A7X. Treat FA-on as unavailable / unsafe on 750.

https://github.com/ggml-org/llama.cpp/pull/26430

**PR #26437 (draft) — driver-thread pinning, A6X/A7X only:**

| device | tg (before → after) |
|---|---|
| Adreno 642L | 7.63 → 16.73 (+119%) |
| **Adreno 740** | **6.23 → 6.71 (+7.7%)** |
| Adreno 840 / 850 | inert by construction |

Model not named. 740 decode stays ~6.7 t/s after the pin. 840/850 already keep driver threads off little cores.

https://github.com/ggml-org/llama.cpp/pull/26437

**Official Snapdragon README Hexagon (NPU) example, not OpenCL:** Llama-3.2-1B-Instruct-Q4_0 on HTP: `tg64 = 51.54 ± 1.13`. Hexagon, unknown phone. Irrelevant to the OpenCL gate except as an upper bound for “what Qualcomm quotes when they want a big number”.

https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/snapdragon/README.md

### 1.4 Wild llama.cpp OpenCL numbers on **Adreno 750** and **830**

**Lenovo Y700 2025, sm8650p, Adreno 750, Android 16** (chrockjyy, Feb 2026), llama.cpp OpenCL with Adreno kernels:

- **Qwen3-7B Q4_0, all layers on GPU: avg 6.2 t/s, peak 7.8 t/s**, GPU occupancy >95%, RAM not the limit.
- Same user in #17456: “pure CPU after optimization can also reach this level.”
- So on 750, 7B Q4_0 OpenCL decode **≈ CPU, not >1.15×**.

https://github.com/ggml-org/llama.cpp/discussions/16606
https://github.com/ggml-org/llama.cpp/discussions/17456

**Adreno 830, MiniCPM4-0.5B Q4_K_M** (issue #16217, Sep 2025):

```
ggml_opencl: device: 'QUALCOMM Adreno(TM) 830'
ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0800.46 Compiler E031.47.18.36
ggml_opencl: vector subgroup broadcast support: true
...
graph splits = 170
Generation speed: 7.3377 tokens/s
```

User claims CPU-only is **99.85 t/s** on the same 0.5B model. That 7.3 vs 99 is **not** a fair GPU-vs-CPU: 170 graph splits means most of the Q4_K/Q6_K graph is bouncing through the CPU. Commenter: “The OpenCL backend only supports a few formats (q4_0, f16 and fp32, and somewhat mxfp4, q6_k and q8_0). I would try q4_0.”

https://github.com/ggml-org/llama.cpp/issues/16217

**Adreno 750 + Hexagon mixed, Qwen3-4B Q4_0** (issue #16854, Oct 2025) — **not** OpenCL-only:

- Driver: `OpenCL 3.0 QUALCOMM … Compiler E031.45.02.16`
- `vector subgroup broadcast support: false`
- Offload mixed GPUOpenCL + HTP0, `graph splits = 216`
- Decode **10.07 t/s** (835 eval tokens). Cannot be used as a clean OpenCL number.

https://github.com/ggml-org/llama.cpp/issues/16854

**Discussion #22791** is titled “Snapdragon 8 Gen 3” but the only table posted is **S23 / Adreno 740 / 8 Gen 2**. Author *claims* “same overall pattern across multiple devices including 8 Gen 3” without posting the 8 Gen 3 table. Treat that claim as anecdotal. The 740 table (Llama-3.2-3B Q4_K_M / Qwen3.5-2B Q4_K_M) matches our own measurement class.

https://github.com/ggml-org/llama.cpp/discussions/22791

### 1.5 What is *missing*

There is **no** Qualcomm or third-party llama.cpp OpenCL table that reports, on the same 8 Gen 3 phone:

```
model  quant  CPU tg   OpenCL tg
```

for Llama-3.2-1B/3B or Qwen 2–4B. That table is exactly the measurement we cannot take right now.

---

## 2. GPU vs CPU on the same 8 Gen 3 device — does the 740 result flip?

### 2.1 llama.cpp OpenCL: no clean flip published

| Source | Device | Model / quant | GPU tg | CPU tg | GPU/CPU | Notes |
|---|---|---|---:|---:|---:|---|
| #22791 (numbers) | **740 / S23** | Llama-3.2-3B **Q4_K_M** | 5.86 | 9.78 | **0.60×** | no subgroup broadcast |
| #22791 (numbers) | **740 / S23** | Qwen3.5-2B **Q4_K_M** | 10.77 | 14.63 | **0.74×** | GDN; OpenCL *wins prefill* 42.8 vs 25.6 |
| #16606 / #17456 | **750 / Y700** | Qwen3-7B **Q4_0** | 6.2 (avg) | “optimized CPU can match” | **~1.0×** | all layers GPU, 95%+ busy |
| #16217 | **830** | MiniCPM4-0.5B **Q4_K_M** | 7.34 | 99.85 (claimed) | unusable | 170 graph splits |
| Siddhesh #16606 | unspecified Adreno | unspecified | ~11 | ~11 | ~1.0× | author later: “OpenCL is worst” |

The only apples-to-apples **llama.cpp** GPU-vs-CPU tables on a Snapdragon phone are the 740 ones. On 750, the only same-device statement is “Q4_0 7B GPU ≈ optimized CPU”. That is a **non-flip** at 7B on the *optimized* quant.

### 2.2 LiteRT / ML Drift on S24 Ultra (Adreno 750) — this *does* flip at ~4B

LiteRT GPU is **not** llama.cpp. It is Google's OpenCL / ML Drift stack with INT8 (or INT4) weights and float activations, XNNPACK CPU at 4 threads. Still the best published same-device GPU-vs-CPU on 750.

**Samsung S24 Ultra = Adreno 750 / 8 Gen 3.**

Phi-4-mini-instruct (~3.8B), dynamic_int8, ctx 4096:

| Backend | Prefill | Decode |
|---|---:|---:|
| CPU | 66.53 | **7.28** |
| GPU OpenCL | 314.01 | **10.39** |

**GPU/CPU decode = 1.43×.** Prefill 4.7×.

https://huggingface.co/litert-community/Phi-4-mini-instruct

DeepSeek-R1-Distill-Qwen-1.5B, dynamic_int8, ctx 4096, same S24 Ultra:

| Backend | Prefill | Decode |
|---|---:|---:|
| CPU | 166.50 | **26.35** |
| GPU OpenCL | 927.54 | **26.98** |

**GPU/CPU decode = 1.02×** (tie). Prefill 5.6×.

https://huggingface.co/litert-community/DeepSeek-R1-Distill-Qwen-1.5B

Gemma3-1B-IT, S24 Ultra (card text; Gemma-gated so README via search index):

- GPU dynamic_int4 QAT, ctx 2048: **56 tok/s** decode, 2585 prefill
- GPU dynamic_int8, ctx 1280/4096: **24 tok/s** decode
- CPU rows exist on the card but were not fully extracted here (gated repo).

https://huggingface.co/litert-community/Gemma3-1B-IT

Pattern on **750 + a well-tuned GPU stack**: prefill always GPU. Decode is a **tie at 1.5B** and **+43% at ~3.8B**. GPU starts to win as the working set leaves the CPU cache.

### 2.3 LiteRT on 8 Elite (Adreno 830) — decode does **not** automatically win

Qwen2.5-1.5B-Instruct, **Samsung S25 Ultra (Adreno 830)**, dynamic_int8, ctx 1280:

| Backend | Prefill | Decode |
|---|---:|---:|
| CPU | 297.58 | **34.25** |
| GPU | 1667.75 | **30.88** |

**GPU/CPU decode = 0.90×.** CPU wins decode on a 1.5B model even on 830. Prefill is 5.6× GPU.

https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct

Qwen3-4B mixed-INT4, **SM-S937U1 (S25+, Adreno 830)**, GPU OpenCL only (no CPU row): decode **19.14 t/s**, prefill 357.57.

https://huggingface.co/litert-community/Qwen3-4B

Gemma 4 E2B, S26 Ultra (Adreno 840-class, *not* 750/830): CPU decode 47, GPU 52 (1.11×). Google blog quotes 52 tok/s GPU without MTP.

https://developers.google.com/edge/litert-lm/overview
https://developers.googleblog.com/blazing-fast-on-device-genai-with-litert-lm/

### 2.4 So does 740's “GPU loses decode” flip on 750/830?

- **llama.cpp OpenCL, Q4_0, 7B, 750:** no. GPU ≈ CPU.
- **llama.cpp OpenCL, Q4_K_M, 2–3B, 740:** no. GPU 0.60–0.74×. 750 still missing the subgroup feature that Qualcomm says is needed for the fast kernels (next section).
- **LiteRT INT8, 1.5B, 750:** tie. **3.8B, 750:** yes, 1.43×. **1.5B, 830:** CPU still wins.
- **MLC q4f16_0:** Qualcomm quotes 22 t/s (1.5B) / 15 t/s (2B) on 8 Gen 3 GPU, 50 / 33 on 8 Elite GPU — no CPU, so no flip proof.

Honest summary: the flip is **stack- and size-dependent**, not a free SoC upgrade. A specialized INT8 GPU compiler beats CPU at ~4B on 750. llama.cpp OpenCL Q4_0 on 750 has not been shown to beat CPU. llama.cpp OpenCL Q4_K_M has not been shown to beat CPU on *any* phone.

---

## 3. Driver features: subgroup broadcast / cl_qcom / flash-attn

### 3.1 What llama.cpp actually checks

The OpenCL backend prints `vector subgroup broadcast support: true|false`. Qualcomm's blog says subgroups are an **optional** OpenCL 3.0 feature used “to achieve optimal performance.” Our 740 fails `sub_group_shuffle_xor` / broadcast and takes the degraded GEMV path.

### 3.2 Adreno 740 (8 Gen 2) — false

S23 SM-S911B, driver build 0676.73: `vector subgroup broadcast support: false`. All 29 layers on GPU, still slower than CPU.

https://github.com/ggml-org/llama.cpp/discussions/22791

Turnip/CLVK on 740 additionally: `device does not support subgroups (cl_khr_subgroups or cl_intel_subgroups)`.

https://github.com/ggml-org/llama.cpp/discussions/17456

### 3.3 Adreno 750 (8 Gen 3) — **also false on shipping phone drivers**

Multiple independent 750 logs, official QUALCOMM ICD (not Turnip):

| Source | Device | Driver / compiler | `vector subgroup broadcast` |
|---|---|---|---|
| #16854 | 8 Gen 3 phone, Hexagon v75 | `Compiler E031.45.02.16` | **false** |
| #12911 / #13000 / #17351 / #11332 search hits | Adreno 750 | various | **false** |

https://github.com/ggml-org/llama.cpp/issues/16854

This is the most important 750-specific fact in the whole recon. **750 is on the official “verified” list and still does not expose the subgroup-broadcast feature the fast Adreno kernels and the flash-attn cluster path want.** Same class of driver defect as 740. Compiler E031.45 is *newer* than 740's E031.41 (PR #26476) and still reports broadcast=false.

PR #26476 (q6_K old-compiler workaround): defect tracks **compiler**, not GPU generation. E031.41 (740) broken; E031.45 (Adreno 619) fixed for that specific q6_K codegen bug; E031.50 (840) fine. 750's E031.45.02.16 is in the “fixed for q6_K codegen” band but that is a *different* issue from subgroup broadcast.

https://github.com/ggml-org/llama.cpp/pull/26476

### 3.4 Adreno 830 (8 Elite) — **true**

Issue #16217: Adreno 830, `build: 0800.46 Compiler E031.47.18.36`, **`vector subgroup broadcast support: true`**.

PR #26331: Adreno 830, `OpenCL 3.0 QUALCOMM build 0800.71, Compiler E031.47.18.49` (diffusion SDPA; confirms 0800.x / E031.47 line on 830).

https://github.com/ggml-org/llama.cpp/issues/16217
https://github.com/ggml-org/llama.cpp/pull/26331

### 3.5 Flash-attn / `sub_group_shuffle_xor` on A7X

PR #26430, Qualcomm: **A7X declines every mixed and quantized FLASH_ATTN_EXT combination** (`clBuildProgram` SIGSEGV). 740 confirmed. 750 is A7X — expect the same decline. 830 is A8X and should compile the FA kernels (840 does). OPENCL.md known issue: “Flash attention does not always improve performance.”

### 3.6 cl_qcom / integer-dot / on-chip memory

Qualcomm blog “Future Work”: Adreno extensions (integer dot product, on-chip global memory) are **not yet** in the OSS backend; “Qualcomm team is working on bringing more Adreno specific features.” Binary kernel library (inline asm) is X2-only. Phone 750/830 run the open OpenCL-C Adreno kernels.

No public driver-release note of the form “8 Gen 3 Android 16 adds cl_khr_subgroups broadcast.” The empirical logs say the opposite.

### 3.7 Driver cheat-sheet

| GPU | Typical compiler | subgroup broadcast | FA mixed/quant | Fast Q4_0 GEMV | Notes |
|---|---|---|---|---|---|
| 740 | E031.41 / build 0676.73 | **false** | declined (SIGSEGV) | degraded | our measured 0.56–0.74× |
| 750 | E031.45.02.16 | **false** | declined (A7X) | degraded | official “Support”, same missing feature |
| 830 | E031.47 / build 0800.46–0800.71 | **true** | expected yes | full kernels | first phone gen with the feature |
| 840 | E031.50 | true (implied) | yes | full + extra opts | A7X opts explicitly excluded |

---

## 4. LiteRT / ML Drift published numbers on Adreno 750 / 830

Cards that actually name S24 / S25 / SM-S93x. Quant is LiteRT dynamic_int8 or mixed INT4, **not** GGUF Q4_K_M.

### 4.1 S24 Ultra (Adreno 750 / 8 Gen 3)

| Model | Quant | Ctx | CPU decode | GPU decode | GPU/CPU | CPU prefill | GPU prefill | URL |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Phi-4-mini (~3.8B) | dyn int8 | 4096 | **7.28** | **10.39** | **1.43×** | 66.5 | 314 | https://huggingface.co/litert-community/Phi-4-mini-instruct |
| DeepSeek-R1-Qwen-1.5B | dyn int8 | 4096 | **26.35** | **26.98** | **1.02×** | 166.5 | 927.5 | https://huggingface.co/litert-community/DeepSeek-R1-Distill-Qwen-1.5B |
| Gemma3-1B-IT | dyn int4 QAT | 2048 | (gated) | **56** | — | — | 2585 | https://huggingface.co/litert-community/Gemma3-1B-IT |
| Gemma3-1B-IT | dyn int8 | 1280 | (gated) | **24** | — | — | 1191 | same |
| Gemma2-2B-IT | dyn int8 | 1280 | **10.03** | (GPU row not fully extracted; gated) | — | 134 | — | https://huggingface.co/litert-community/Gemma2-2B-IT |

No SM-S921 / SM-S926 / Xiaomi 14 rows showed up on the cards searched. S24 Ultra (SM-S928, US = 8 Gen 3 / 750) is the device Google actually benches.

### 4.2 S25 / S25+ / S25 Ultra (Adreno 830 / 8 Elite)

| Model | Device | Quant | CPU decode | GPU decode | GPU/CPU | GPU prefill | URL |
|---|---|---|---:|---:|---:|---:|---|
| Qwen2.5-1.5B | S25 Ultra | dyn int8 ctx1280 | **34.25** | **30.88** | **0.90×** | 1668 | https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct |
| Qwen2.5-1.5B | S25 Ultra | dyn int8 ctx4096 | 26.06 | 27.30 | 1.05× | 933 | same |
| Qwen3-4B | SM-S937U1 (S25+) | mixed INT4 | — | **19.14** | — | 358 | https://huggingface.co/litert-community/Qwen3-4B |

No SM-S931 / SM-S938 CPU+GPU pair for a 2–4B model was found beyond the 1.5B S25 Ultra table.

### 4.3 What LiteRT does *not* tell us

- Not GGUF, not Q4_K_M, not llama.cpp kernels.
- CPU is XNNPACK 4-thread, not llama.cpp 6-thread i8mm/smmla.
- Still the only public 750 same-device GPU-vs-CPU decode tables in the 1–4B band.

---

## 5. Hybrid / Gated-DeltaNet on a mobile GPU

Did anyone beat us to **correct E2E GDN/hybrid on a phone GPU with numbers**?

### 5.1 Qualcomm llama.cpp OpenCL — laptop only, no phone numbers

PR #24160: Qualcomm ran **Qwen3.5-4B and Qwen3.5-9B Q4_K_M** on OpenCL. Device is **X2-90 laptop**, not Adreno 750/830. After their get_rows/cpy/q6_K gemv fix: Qwen3.5-4B tg128 = 23.35. No CPU. No claim of “first on mobile”.

https://github.com/ggml-org/llama.cpp/pull/24160

### 5.2 LiteRT Qwen3.5-0.8B — first GDN in LiteRT, **CPU-only**

litert-community/Qwen3.5-0.8B (Aug 2026): “to our knowledge this is … the first gated-delta-net hybrid served by the released LiteRT-LM runtime.” Requires litert-lm ≥ 0.15.

- Mac M4 Max CPU: 46.6 tok/s decode.
- iPhone 17 Pro CPU: 33.4 tok/s.
- **Android Gallery: not yet** (bundled runtime < 0.15).
- **GPU backend fails:** “Asking `litert-lm benchmark` for the GPU backend fails at engine creation with `Hint fully delegated to single delegate is set, but the graph is not fully delegated`.” “current GPU delegates reject the graph, so this release is **CPU-only**.”

https://huggingface.co/litert-community/Qwen3.5-0.8B

### 5.3 MLC Android Qwen3.5-4B — claimed first Android GPU compile, **no tok/s**

clemNova/Qwen3.5-4B-q4f16_0-MLC-Android: “First-ever native compilation of Qwen 3.5 for Android GPU (OpenCL/Vulkan) via MLC-LLM.” Tested on **S24 Ultra / 8 Gen 3**. Honest about being unusable for production:

- TVM vectorize pass crashes on hybrid SBlock; they monkey-patch it off → “GPU computes massive operations sequentially.”
- No metaschedule Adreno tune.
- “generation speed is heavily throttled.” No number.

https://huggingface.co/clemNova/Qwen3.5-4B-q4f16_0-MLC-Android

### 5.4 Other backends

- llama.cpp Vulkan: “Adds Vulkan support for gated delta net with Sv=16” (b9670, Jun 2026) — desktop/Android Vulkan, no Adreno-750 table found.
- llama.cpp SYCL: GDN on Intel GPUs (b9289).
- Issue #15940 (Qwen3-Next): feature request, no mobile GPU numbers.

No published “Qwen3.5 / Qwen3-Next on Adreno 750/830, OpenCL or otherwise, decode = X t/s, CPU = Y t/s, output matches HF.” The 740 numbers in #22791 (Qwen3.5-2B Q4_K_M, OpenCL 10.77 vs CPU 14.63, *correct* path after the Q6_K dispatch fix) are still the only phone-GPU GDN table we know of.

**We did not miss a published correct E2E GDN-on-mobile-GPU number.** Closest misses: Qualcomm X2-90 (laptop), LiteRT 0.8B (CPU only), MLC S24 Ultra (runs, no number, throttled).

---

## 6. Synthesis — prediction for **our** 750 gate

Gate: llama.cpp-fork OpenCL, Qwen3.5-2B/4B **Q4_K_M**, decode ≥ **1.15×** same-device CPU, on **Adreno 750**.

### 6.1 Verdict: **LIKELY_FAIL**

Not “impossible”. Not “toss-up”. The published evidence that actually applies to *this* stack on *this* GPU points under 1.0×, and the one hardware feature that would change the kernel path is **still missing on 750**.

### 6.2 The two or three numbers that drive it

1. **750 still has `vector subgroup broadcast support: false`** (8 Gen 3 phone, compiler E031.45.02.16). Same missing feature as our 740. Qualcomm themselves say subgroups are what make the Adreno kernels fast. Fast FA is separately declined on all A7X.  
   https://github.com/ggml-org/llama.cpp/issues/16854  
   https://www.qualcomm.com/developer/blog/2024/11/introducing-new-opn-cl-gpu-backend-llama-cpp-for-qualcomm-adreno-gpu

2. **Our 740 Q4_K_M decode is 0.60× (Llama-3.2-3B) and 0.74× (Qwen3.5-2B).** 750 GPU is not a new architecture (still A7X). 8 Gen 3 CPU is *also* faster (X4 vs X3). Scaling 0.74× by a generous +25–40% GPU-only uplift lands at **0.93–1.04×**, still under 1.15×. The only wild llama.cpp 750 number (Y700, Qwen3-7B **Q4_0**, 6.2 t/s) is described as matching optimized CPU.  
   https://github.com/ggml-org/llama.cpp/discussions/22791  
   https://github.com/ggml-org/llama.cpp/discussions/16606

3. **Q4_K_M is not the optimized OpenCL path.** Qualcomm: optimized for Q4_0; K-quants are “Support”. On 830, Q4_K_M MiniCPM 0.5B exploded into 170 graph splits and 7 t/s. A7X is explicitly **excluded** from the 2026 tiled K-quant decode opts (PR #26477) because it regresses. Qwen3.5 additionally stressed get_rows/cpy (fixed on X2-90 in #24160; not shown on 750).  
   https://github.com/ggml-org/llama.cpp/issues/16217  
   https://github.com/ggml-org/llama.cpp/pull/26477

### 6.3 Main uncertainty

**K-quant vs Q4_0 kernel efficiency**, plus whether any 750 unit ever ships a driver that flips broadcast to true.

- If we re-quantized the gate models to **Q4_0** *and* a 750 driver grew broadcast, LiteRT's 1.43× at 3.8B says a *good* GPU stack can clear 1.15× at 4B. That is a different binary and a different quant than the gate.
- If we stay on **Q4_K_M** with today's 750 drivers, the optimized Adreno GEMV (shuffle/broadcast) never turns on, FA stays off, and A7X K-quant extras are gated off. Then we are running the same degraded path as 740 on a slightly faster GPU *and* a faster CPU. That does not clear 1.15×.

Secondary uncertainty: Qwen3.5 GDN extra ops. On 740, OpenCL already *wins prefill* (1.67×) and loses decode (0.74×). Prefill-friendly. Decode is still the gate.

### 6.4 What would flip this to TOSS_UP / LIKELY_PASS

- A 750 log with `vector subgroup broadcast support: true` and a Q4_K_M (or at least Q4_0) 2–4B `llama-bench` GPU-vs-CPU table ≥ 1.15×.
- Or Qualcomm posting the table they never posted in the 2024/2025 blog.

Until one of those exists, treating 750 as “740 + 20%” with the **same kernel disable** is the honest model.

### 6.5 830 (8 Elite) is a different bet — not this gate

830 **does** have subgroup broadcast. LiteRT Qwen3-4B is 19 t/s GPU on S25+. llama.cpp Qwen3-4B Q4_K_M is 14.5–17 t/s on the *next* A8X (840). 8 Elite CPU on 1.5B is 34 t/s (LiteRT); on 3–4B it will be lower. 830 OpenCL Q4_0 2–4B vs CPU is the first place I would actually call **TOSS_UP**. It is not the 750 gate.

---

## 7. Source index

| # | What | URL |
|---|---|---|
| 1 | Qualcomm llama.cpp OpenCL blog (Q4_0, no numbers) | https://www.qualcomm.com/developer/blog/2024/11/introducing-new-opn-cl-gpu-backend-llama-cpp-for-qualcomm-adreno-gpu |
| 2 | llama.cpp OPENCL.md (verified 750/830, dtype list) | https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md |
| 3 | IWOCL 2025 MLC q4f16_0 8 Gen 3 / 8 Elite table | https://www.iwocl.org/wp-content/uploads/iwocl-2025-siva-rama-krishna-reddy-b-deep-learning.pdf |
| 4 | PR 24160 Qwen3.5 Q4_K_M on X2-90 | https://github.com/ggml-org/llama.cpp/pull/24160 |
| 5 | PR 14635 Llama-1B F16 on Adreno 830 | https://github.com/ggml-org/llama.cpp/pull/14635 |
| 6 | PR 26477 Qwen3-4B Q4_K_M on Adreno 840; A7X excluded | https://github.com/ggml-org/llama.cpp/pull/26477 |
| 7 | PR 26430 FA; A7X declines mixed/quant FA | https://github.com/ggml-org/llama.cpp/pull/26430 |
| 8 | PR 26437 740 tg 6.23→6.71 | https://github.com/ggml-org/llama.cpp/pull/26437 |
| 9 | PR 26476 q6_K compiler gate | https://github.com/ggml-org/llama.cpp/pull/26476 |
| 10 | #16217 Adreno 830 broadcast=true, Q4_K_M 170 splits | https://github.com/ggml-org/llama.cpp/issues/16217 |
| 11 | #16854 Adreno 750 broadcast=false, E031.45.02.16 | https://github.com/ggml-org/llama.cpp/issues/16854 |
| 12 | #16606 Y700 750 Qwen3-7B Q4_0 6.2 t/s | https://github.com/ggml-org/llama.cpp/discussions/16606 |
| 13 | #17456 same 750, CPU can match | https://github.com/ggml-org/llama.cpp/discussions/17456 |
| 14 | #22791 740 Q4_K_M CPU vs OpenCL table | https://github.com/ggml-org/llama.cpp/discussions/22791 |
| 15 | Snapdragon README Hexagon 1B Q4_0 tg 51.5 | https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/snapdragon/README.md |
| 16 | LiteRT Phi-4-mini S24 Ultra CPU/GPU | https://huggingface.co/litert-community/Phi-4-mini-instruct |
| 17 | LiteRT DeepSeek-1.5B S24 Ultra CPU/GPU | https://huggingface.co/litert-community/DeepSeek-R1-Distill-Qwen-1.5B |
| 18 | LiteRT Qwen2.5-1.5B S25 Ultra CPU/GPU | https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct |
| 19 | LiteRT Qwen3-4B SM-S937U1 GPU | https://huggingface.co/litert-community/Qwen3-4B |
| 20 | LiteRT Gemma3-1B S24 Ultra GPU | https://huggingface.co/litert-community/Gemma3-1B-IT |
| 21 | LiteRT Qwen3.5-0.8B GDN, GPU rejected | https://huggingface.co/litert-community/Qwen3.5-0.8B |
| 22 | MLC Qwen3.5-4B Android, S24 Ultra, no t/s | https://huggingface.co/clemNova/Qwen3.5-4B-q4f16_0-MLC-Android |
| 23 | LiteRT-LM overview (S26 / S25 rows) | https://developers.google.com/edge/litert-lm/overview |
| 24 | 8 Gen 3 CPU vs Hexagon paper (not GPU) | https://arxiv.org/html/2605.27435v1 |
| 25 | MLC vs Mali, Adreno 750 decode 1.6× Mali-G720 (not vs CPU) | https://arxiv.org/html/2410.03613v1 |

---

## VERDICT: LIKELY_FAIL

DONE
