# Google mobile-GPU LLM kernels: what is actually open source and reusable?

**Date:** 2026-08-12
**Scope:** web-only recon of primary sources (GitHub repos, LICENSE files, official docs, papers).
**Goal:** judge whether the kernels behind LiteRT-LM’s ~26.8 tok/s Gemma E2B decode on Adreno 740 can be ported into a llama.cpp-fork `ggml-opencl` backend, legally and technically.

---

## VERDICT

**TECHNIQUES_ONLY**

The LLM-class GPU engine (ML Drift) that delivers the measured speed is **not published as source**. LiteRT-LM and LiteRT ship it as **prebuilt blobs** (`.so` / `.dylib` / `.dll` / AAR). Google’s own docs and a LiteRT-LM maintainer say so in those words.

What *is* open and Apache-2.0 is the **classic TFLite GPU delegate** (CNN/FC shader codegen). That is a real ancestor of ML Drift, not the LLM kernel stack. A third party already wrapped it as a LiteRT accelerator and found it covers **22/2068 ops** on Gemma 4 (no `FULLY_CONNECTED` v14, no `STABLEHLO_COMPOSITE`).

Realistically reusable for a `ggml-opencl` port:

| Class | Reusable? | Form |
|---|---|---|
| ML Drift LLM kernels (OpenCL / WebGPU / Metal) | **No** | Closed prebuilts only |
| Classic TFLite GPU shaders (`fully_connected`, `conv_generic`, PHWC4, INT8 texture weights) | **Yes, Apache-2.0** | Wrong op set / wrong quant for Gemma LLM |
| Paper techniques (layouts, stage-aware prefill/decode, KV-as-conv, q8 / 8/4/4) | **Yes** | Reimplement from paper; no drop-in shaders |
| Decompiling the `.so` | **Not a clean legal path** | Object-form Apache-2.0 does not grant source; reverse engineering is a separate legal question we do not recommend |

**Best entry point for a kernel port:**
[arXiv:2505.00232](https://arxiv.org/abs/2505.00232) *Scaling On-Device GPU Inference for Large Generative Models* (ML Drift, CC BY 4.0), read together with the open ancestor kernels at
[`tflite/delegates/gpu/common/tasks/fully_connected.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/tflite/delegates/gpu/common/tasks/fully_connected.cc)
and
[`tflite/delegates/gpu/common/tasks/conv_generic.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/tflite/delegates/gpu/common/tasks/conv_generic.cc).

Do **not** start from LiteRT-LM `runtime/` or `prebuilt/` expecting shader sources. They are not there.

---

## 1. LiteRT-LM repo: orchestration is open, GPU LLM kernels are blobs

**Repo:** https://github.com/google-ai-edge/LiteRT-LM
**License of the published tree:** [Apache-2.0](https://github.com/google-ai-edge/LiteRT-LM/blob/main/LICENSE)

### 1.1 What the open tree actually contains

The public repo is the **LLM orchestration layer** (tokenizer, conversation, compiled-model executor, C/Kotlin/Swift/JS/Python APIs). The GPU engine is pulled in as prebuilts.

Evidence:

- Top-level layout has `runtime/` (open C++ executor) and `prebuilt/` (binaries). No `*.cl`, `*.metal`, `*.wgsl` kernel sources. A GitHub filename search for `*.cl` in `google-ai-edge/LiteRT-LM` returns **0 files** ([search](https://github.com/search?q=repo%3Agoogle-ai-edge%2FLiteRT-LM+filename%3A*.cl&type=code)).
- `runtime/executor/` is CompiledModel plumbing (`llm_litert_compiled_model_executor.cc`, MTP drafter, NPU executor). It **calls** LiteRT GPU; it does not implement shaders.
- `prebuilt/android_arm64/` on `main` ships, among others:
  - `libLiteRtGpuAccelerator.so`
  - `libLiteRtOpenClAccelerator.so`
  - `libLiteRtWebGpuAccelerator.so`
  - `libLiteRtTopKOpenClSampler.so`
  - `libLiteRtTopKWebGpuSampler.so`
  - `libwebgpu_dawn.so`
  - `libGemmaModelConstraintProvider.so`

  Listing: https://github.com/google-ai-edge/LiteRT-LM/tree/main/prebuilt/android_arm64

The `prebuilt/android_arm64/BUILD` file is Apache-2.0 and just `exports_files` the blobs ([raw](https://raw.githubusercontent.com/google-ai-edge/LiteRT-LM/main/prebuilt/android_arm64/BUILD)). There is no companion kernel tree.

Internal paths leak from crash logs and issues, none of which exist in the public tree:

- `third_party/odml/litert/ml_drift/delegate/gpu_backend_opencl_litert.cc` ([#2114](https://github.com/google-ai-edge/LiteRT-LM/issues/2114))
- `third_party/odml/infra/genai/inference/ml_drift/llm` ([#2150](https://github.com/google-ai-edge/LiteRT-LM/issues/2150))
- `third_party/ml_drift/webgpu/environment.cc` ([#1109](https://github.com/google-ai-edge/LiteRT-LM/issues/1109))
- `third_party/ml_drift/metal/environment.h`, `inference_context.h` (comment on [#1050](https://github.com/google-ai-edge/LiteRT-LM/issues/1050#issuecomment-4258021748))

A user on #1050 also reported that `top_k_metal_sampler.mm` (when it exists internally) includes **15+ headers from `third_party/ml_drift/`**, and the public `default_static_gpu_samplers` BUILD target has empty deps.

### 1.2 Google has said the GPU engine is not open source

Official C++ SDK docs, last updated 2026-07-07:

> “If you need GPU Acceleration, you need GPU Accelerator. **Since it's not open sourced yet**, you need to download prebuilts.”

https://developers.google.com/edge/litert/next/cpp_sdk#prebuilt-gpu-accelerators

Official GPU guide, last updated 2026-05-28:

> “**The new LiteRT GPU Accelerator isn't open sourced yet.** But prebuilts are available.”

https://developers.google.com/edge/litert/next/gpu

LiteRT-LM contributor **protobird-git**, 2025-12-03, on the explicit “build GPU plugins from source” request:

> “Building gpu accelerator from the source: users can't do that because **key part of gpu acceleration is not open-sourced yet**. We are working on it open-sourced early next year.”

https://github.com/google-ai-edge/LiteRT-LM/issues/1050#issuecomment-3608318553

Same person, 2026-04-07 (after the promised window):

> “unfortunately, the plan has been delayed. Hope this can be open sourced this year. Not confirmed at all though.”

https://github.com/google-ai-edge/LiteRT-LM/issues/1050#issuecomment-4196133654

As of this recon (2026-08-12) the source is still closed. The public Bazel rule confirms it: `litert_gpu_accelerator_deps()` returns `[]`; only `litert_gpu_accelerator_prebuilts()` is populated.

https://raw.githubusercontent.com/google-ai-edge/LiteRT/main/litert/build_common/special_rule.bzl

Copybara-stripped internal targets named in issues:

- `//litert/runtime/accelerators/gpu:ml_drift_cl_gl_accelerator`
- `//litert/runtime/accelerators/gpu:ml_drift_vulkan_accelerator`
- `//litert/runtime/accelerators/gpu:ml_drift_cl_accelerator_so`

([LiteRT #5721](https://github.com/google-ai-edge/LiteRT/issues/5721), [LiteRT-LM #1050](https://github.com/google-ai-edge/LiteRT-LM/issues/1050))

### 1.3 The closed-source claim is also made from the field

[LiteRT-LM #1881](https://github.com/google-ai-edge/LiteRT-LM/issues/1881) (2026-04): “The closed-source `libLiteRtWebGpuAccelerator.so` (ML Drift) generates FP16 WGSL shaders…” The reporter wrapped the **classic** TFLite GPU delegate as a LiteRt plugin; OpenCL loaded, but the old delegate “only supports 22/2068 ops — it lacks support for `FULLY_CONNECTED` v14 and `STABLEHLO_COMPOSITE` ops used by Gemma 4 models.”

That is the cleanest public experiment showing **LLM path ≠ classic GPU delegate**.

### 1.4 License of the blobs

The containing repo is Apache-2.0. The BUILD files that export the `.so` files carry Apache-2.0 headers. That licenses **distribution of the object form as shipped**, not the missing source.

Apache-2.0 §1 defines “Object” form as compiled object code. You may use/redistribute those binaries under Apache-2.0 conditions. You do **not** receive the “Source” form of ML Drift (the preferred form for modification). Decompiling shaders out of `libLiteRtOpenClAccelerator.so` and pasting them into ggml-opencl is **not** a clean Apache-2.0 reuse of published source. Treat the blobs as a runtime you can *link*, not a kernel library you can *port*.

---

## 2. Classic TFLite GPU delegate: Apache-2.0, current, and a different path

### 2.1 Still fully open, still Apache-2.0

The classic GPU delegate lives in both:

- LiteRT (canonical successor): https://github.com/google-ai-edge/LiteRT/tree/main/tflite/delegates/gpu
- TensorFlow (still mirrored): https://github.com/tensorflow/tensorflow/tree/master/tensorflow/lite/delegates/gpu

Repo license: [Apache-2.0](https://github.com/google-ai-edge/LiteRT/blob/main/LICENSE). Kernel files keep the 2019 TensorFlow Authors header, Apache-2.0.

Structure (LiteRT `main`):

| Path | What it is |
|---|---|
| `tflite/delegates/gpu/cl/` | OpenCL runtime (context, program cache, tensor, interop) |
| `tflite/delegates/gpu/cl/kernels/` | Almost all **tests**, plus a layout `converter` |
| `tflite/delegates/gpu/common/tasks/` | **The actual shader templates** (C++ string codegen) |
| `tflite/delegates/gpu/gl/` | OpenGL ES compute |
| `tflite/delegates/gpu/metal/` | Metal |

README supported ops are classical CNN/RNN ops (`CONV_2D`, `FULLY_CONNECTED v1`, `LSTM v2` basic, softmax, pooling, …). No attention, no RoPE, no RMSNorm-as-LLM-op, no KV cache.

https://github.com/google-ai-edge/LiteRT/blob/main/tflite/delegates/gpu/README.md

Paper for this stack: Lee et al., *On-Device Neural Net Inference with Mobile GPUs*, arXiv:1907.01989 (2019). Publicly “integrated into the open-source project TensorFlow Lite.”
https://arxiv.org/abs/1907.01989

### 2.2 What the open kernels actually look like (Adreno-relevant)

[`fully_connected.cc`](https://github.com/google-ai-edge/LiteRT/blob/main/tflite/delegates/gpu/common/tasks/fully_connected.cc) is representative:

- Runtime shader codegen from C++ string templates (`GetFullyConnectedKernelCode`).
- Adreno work-group specialization (`int3(32,4,1)` on Adreno 4xx+; 16×4 on Adreno 3xx).
- Weights as **buffer or 2D texture**. `UseBufferForWeights()` is true for Adreno.
- INT8 path: `RearrangeFCWeightsToOIO4I4`, stored as `TEXTURE_2D` UINT8, dequant `w * q0 + q1` (per-tensor scale + zero-point, **not** GGUF K-quants).
- Reduction is **workgroup local memory + `LOCAL_MEM_BARRIER` / `SIMD_LOCAL_MEM_BARRIER`**, not a subgroup reduction. This matches the “subgroup-free” style people attribute to this lineage.
- 4-channel SIMD (`FLT4` / PHWC4-style slices). README: “On GPU, tensor data is sliced into 4-channels.”

`conv_generic.cc`, `conv_weights_converter.cc`, `mean_stddev_normalization.cc` are the other high-value files in the same folder.

### 2.3 Does the LLM path reuse these kernels?

**No, not as the production LLM engine.** Three independent signals:

1. Official May 2025 blog positions ML Drift as “**our latest version of GPU acceleration**” and plots it **against** “previous versions of our TFLite GPU delegate,” faster on CNN **and Transformer** models.
   https://developers.googleblog.com/litert-maximum-performance-simplified/
2. ML Drift paper §3: “ML Drift **extends** the basic architecture of a well-established GPU-accelerated ML inference engine” citing Lee et al. 2019. Extension, not “we ship those files.”
   https://arxiv.org/html/2505.00232v1
3. Empirical: wrapping `tflite/delegates/gpu` as a LiteRt accelerator cannot run Gemma 4 (22/2068 ops).
   https://github.com/google-ai-edge/LiteRT-LM/issues/1881

LiteRT #5721’s reporter assumed the open `tflite/delegates/gpu/cl/kernels/` were “the” GPU kernels and only the thin LiteRT wrapper was missing. That is true **for classical TFLite graphs**. It is false for the Gemma/LiteRT-LM GPU path, which is ML Drift behind `libLiteRtClGlAccelerator.so` / `libLiteRtGpuAccelerator.so`.

The two stacks share architecture (shader templates, 4-wide layouts, texture/buffer weights, Adreno specialization). They do **not** share the published LLM shader sources.

---

## 3. ML Drift: paper exists, sources do not

### 3.1 The paper

**Tang, Sarokin, Ignasheva, Jensen, Chen, Lee, Kulik, Grundmann.**
*Scaling On-Device GPU Inference for Large Generative Models.*
arXiv:2505.00232v1, 1 May 2025. License on arXiv HTML: **CC BY 4.0**.

- HTML: https://arxiv.org/html/2505.00232v1
- PDF: https://arxiv.org/pdf/2505.00232
- abs: https://arxiv.org/abs/2505.00232

No accompanying code repo is cited. The paper is a techniques document, not a software release.

### 3.2 Techniques the paper actually specifies (usable for a port)

These are the load-bearing claims, all from §3–§4 of the paper:

1. **Tensor virtualization + coordinate translation.** Logical tensor axes (BHWC / BHWDC) are decoupled from physical GPU objects (buffer, image buffer, 2D/3D texture, texture array). `args.src.Read(b,x,y,s)` is rewritten at shader-codegen time. PHWC4 lineage, 4-channel slices, zero-pad channels not divisible by 4.

2. **Weight layouts.** Conv/FC weights start as OHWI / OHWDI, then a permutation of `(G, S_O, O_4, HWD, S_I, I_4)`. “Up to a 20% speedup in matrix multiplication” vs a naive layout. This is the paper’s stated primary performance driver.

3. **Device specialization.** Runtime shader generators for OpenCL, Metal, WebGPU. Adaptive kernel selection, vendor extensions (`cl_arm_matrix_multiply`), syntax translation, **offline-chosen per-device storage type**.

4. **Stage-aware LLM.** Prefill vs decode use the same resident weights but different kernels:
   - Prefill (compute-bound, long sequence): dedicated quant kernel (FP act → int8) then int8 matmul against pre-quantized weights; **convolution** kernels.
   - Decode (memory-bound, one token): fuse activation quant **into** the op kernel; **fully-connected** kernels.

5. **KV cache as convolution weights.** After a fused RoPE + QKV layout kernel:
   - Q: `(B,1,S,h_q·d_h)` → `(B·h_kv, S·h_q/h_kv, d_h)`
   - K cache: OHWI with `O = cache_size`, `I = d_h` (so conv computes `Q K^T`)
   - V cache: OHWI with `O = d_h`, `I = cache_size`

6. **Quant formats (not GGUF).**
   - **q8:** per-channel int8 on all weights.
   - **8/4/4:** mixed per-channel; int8 on attention, int4 on embedding + FFN.
   - Activations: FP16 except NVIDIA OpenCL (FP32, “driver limitations”).
   - Paper explicitly contrasts this with GGUF q4 group quant used by llama.cpp / MLC.

7. **Operator fusion.** Auto-fuse elementwise / residual / RMSNorm. Manual fused RoPE+QKV layout.

8. **Flash attention and speculative decoding were OFF** in the paper’s LLM benchmark. Context 1280 (1024 prefill + 256 gen).

Adreno 740 numbers from Table 2 of the paper (not our measurement): Gemma 2B-class and Llama 3.x rows; e.g. Adreno 740 decode **12.7 tok/s** on one Llama 3.1 8B-q8 configuration (OOM on some devices), and much higher prefill. Our 26.8 tok/s on Gemma E2B is in the same ballpark as the paper’s Gemma-class Adreno 740/750 decode column.

### 3.3 Are any ML Drift sources published anywhere?

**No public source tree found.** Searched:

- LiteRT-LM, LiteRT, MediaPipe, TensorFlow
- arXiv 2505.00232 (no code artifact)
- Official docs (explicitly “not open sourced yet”)
- Maintainer comments (explicitly “users can't [build from source]”)
- LiteRT.js / WebGPU path: still “powered by ML Drift” as a native/WASM blob, not published WGSL
  https://developers.googleblog.com/litertjs-googles-high-performance-web-ai-inference/

Google-internal name in BUILD/copybara: `ml_drift_*`. Google-internal include root: `third_party/ml_drift/` and `third_party/odml/litert/ml_drift/`.

A 2026-04-16 comment on #1050 is the most concrete source-map we have: Metal sampler depends on `third_party/ml_drift/metal/environment.h` and `inference_context.h` plus ~13 more ml_drift headers, none of which are in the public repo.

---

## 4. MediaPipe LLM GPU: same closed engine, now maintenance-only

Official LLM Inference guide (updated 2026-06-12):

> “The MediaPipe LLM Inference API (Android, iOS, and Web) is now in **maintenance-only mode**. New features and optimizations will be focused on **LiteRT-LM**.”

https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference

GPU on MediaPipe was never open:

- Google collaborator **schmidt-sebastian**, 2024-04-19:
  > “For now, our **open source code only allows us to run CPU models, while the Maven package include GPU support**.”
  https://github.com/google-ai-edge/mediapipe/issues/5305#issuecomment-2066973206
- Same story 2024-07: “Our C API for the LLM inference task does not support GPU. Currently, the only way to use GPU is through our Maven package.”
  https://github.com/google-ai-edge/mediapipe/issues/5535
- Still true 2026-02: iOS GenAI framework cannot be built from source because `llm_inference_engine_ios.{h,cc}` “are referenced in the BUILD files but do not exist in any branch or tag.”
  https://github.com/google-ai-edge/mediapipe/issues/6234

The Maven `com.google.mediapipe:tasks-genai` AAR is the historical GPU blob. The current GPU blob is LiteRT-LM `prebuilt/` / Maven `io.github.google-ai-edge:litert-gpu`. Same lineage (ML Drift), same closedness.

LoRA on MediaPipe LLM is documented as **GPU-only** (`backend='gpu'` required in the converter). That GPU path is the closed one.

---

## 5. Practical port assessment for ggml-opencl

### 5.1 (a) Verbatim kernel code — not for the LLM engine

**Cannot.** There is no published OpenCL/Metal/WGSL source for the kernels that produce 26.8 tok/s.

What you *can* copy under Apache-2.0, with attribution:

- `tflite/delegates/gpu/common/tasks/fully_connected.cc` (and `.h`)
- `conv_generic.cc`, `conv_weights_converter.cc`, `conv_constants.cc`
- `mean_stddev_normalization.cc` (reduction / norm)
- OpenCL runtime helpers in `tflite/delegates/gpu/cl/` (`cl_kernel`, `tensor`, `program_cache`, Adreno device info)
- Dual tree: `tensorflow/lite/delegates/gpu/...` (same code, Apache-2.0)

These are useful as **reference implementations of PHWC4 / OIO4I4 / texture-or-buffer weights / Adreno WG sizes / local-memory reductions**. They will not run a Gemma graph and they will not eat GGUF K-quants.

**Adaptation cost if you tried to use them anyway:**

1. **Quant.** Their INT8 is per-tensor (or, in ML Drift paper, per-channel) affine `scale/zero`. ggml K-quants (Q4_K, Q5_K, Q6_K, IQ…) are **grouped super-block** formats with scales/mins per 16/32 and a super-block scale. You would need either:
   - a one-time offline rewrite GGUF → per-channel int4/int8 + the paper’s `(G,S_O,O_4,…)` layout, or
   - new kernels that dequant K-quants in-register (what ggml-opencl already does, slowly).
   The paper’s speed comes in large part from **not** doing the second thing.

2. **Layout.** ggml is typically `[ne0, ne1, …]` row-major tiles. Their activations are 4-sliced BHWC-like; weights are OHWI-derived 4×4 tiles, often in a **texture**. Porting means a conversion pass at model load (acceptable) plus every kernel written against `Read(b,x,y,s)` semantics.

3. **Matmul-as-conv + KV-as-weights.** Decode GEMV is an FC kernel; prefill GEMM is a conv kernel; K/V caches are stored *as those conv weights*. ggml-opencl’s KV cache is a normal tensor. Replicating their decode speed means changing KV layout, not just the matmul inner loop.

4. **Codegen vs static kernels.** Their stack generates shaders at init from templates. ggml-opencl is mostly static `.cl` with `#define`s. You can either adopt codegen or freeze a few specialized templates (Adreno 7xx decode FC, Adreno 7xx prefill conv, fused RMSNorm, fused RoPE+QKV).

5. **Op coverage.** Classic delegate has no GQA attention, no RoPE, no SiLU-GLU FFN fusion of the kind Gemma uses. Those live only in closed ML Drift.

### 5.2 (b) Techniques from papers/docs — this is the real path

Legally clean: CC BY 4.0 paper + Apache-2.0 ancestor kernels. Implement independently in ggml-opencl.

Highest-ROI techniques, in likely order:

1. **Weight layout + storage type for Adreno decode GEMV.** 4-wide tiles, texture vs buffer (classic code says **buffer on Adreno** for FC; paper says they search this per device). 20% from layout alone per the paper.
2. **Fused decode kernel:** dequant (or, better, convert weights offline to their q8 / 8/4/4) + GEMV + bias, no extra memory round-trip.
3. **Stage split:** different kernel for prefill (conv-style, compute-bound) vs decode (FC-style, BW-bound).
4. **KV layout matching the QK/V conv.** This is a larger ggml surgery.
5. **Workgroup-local reductions** (already the classic-delegate style; avoid relying on subgroups on Adreno).
6. **Fused RMSNorm + residual, fused RoPE + QKV permute.**

Expect a **reimplementation**, not a transplant. Budget: weeks for (1)+(2) on Q4_K→custom-int4 conversion of FFN/attn weights; months if you also redo KV-as-conv.

### 5.3 (c) Nothing beyond ideas?

Too pessimistic. The paper is unusually concrete on layouts and quant. The 2019 stack is working, compilable reference code for the 4-wide texture/buffer style. What you will **not** get is their tuned Gemma attention/FFN shaders or the per-device kernel picker.

### 5.4 Linking the blob instead of porting

Apache-2.0 object-form reuse of `libLiteRtOpenClAccelerator.so` inside an Android app is a product choice (run LiteRT-LM *beside* llama.cpp), not a ggml-opencl port. ABI is fragile (see #1050, #2211: versioned symbols, `DT_NEEDED` on `libLiteRt.so`). You also inherit their model format (`.litertlm` / converted TFLite), not GGUF.

---

## 6. Prior art: nobody has ported ML Drift kernels into llama.cpp

Searches run:

- `"ML Drift" (llama.cpp OR ggml OR ggml-opencl)`
- `"ml_drift" port llama.cpp`
- `"LiteRtGpuAccelerator" llama.cpp`
- `tflite gpu delegate llama.cpp`

**No repository, PR, or write-up of a kernel port was found.**

What exists:

- The ML Drift paper **benchmarks against** llama.cpp / ollama / MLC / MLX. It does not contribute code to them.
- llama.cpp’s own OpenCL backend is independent (CLBlast-era + custom ggml kernels; docs: https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md).
- LiteRT-LM #1881 is the closest engineering artifact: someone wrapped **classic** TFLite GPU as a LiteRt plugin and hit the op-coverage wall. That is a LiteRT integration, not a ggml port.
- #1050 / Meos Labs: Rust bindings around the **C API + prebuilts**, not a kernel extraction.

If a port existed it would be a large, greppable patch. It does not.

---

## Source index (load-bearing URLs)

| Claim | URL |
|---|---|
| LiteRT-LM Apache-2.0 | https://github.com/google-ai-edge/LiteRT-LM/blob/main/LICENSE |
| LiteRT-LM Android GPU blobs | https://github.com/google-ai-edge/LiteRT-LM/tree/main/prebuilt/android_arm64 |
| No `*.cl` in LiteRT-LM | https://github.com/search?q=repo%3Agoogle-ai-edge%2FLiteRT-LM+filename%3A*.cl&type=code |
| “GPU Accelerator isn't open sourced yet” | https://developers.google.com/edge/litert/next/gpu |
| “Since it's not open sourced yet, download prebuilts” | https://developers.google.com/edge/litert/next/cpp_sdk |
| `litert_gpu_accelerator_deps() = []` | https://raw.githubusercontent.com/google-ai-edge/LiteRT/main/litert/build_common/special_rule.bzl |
| Maintainer: cannot build GPU from source | https://github.com/google-ai-edge/LiteRT-LM/issues/1050#issuecomment-3608318553 |
| Maintainer: OSS delayed past 2026-04 | https://github.com/google-ai-edge/LiteRT-LM/issues/1050#issuecomment-4196133654 |
| Internal `ml_drift_*` targets | https://github.com/google-ai-edge/LiteRT/issues/5721 |
| Closed WebGPU `.so`; classic delegate ≠ Gemma | https://github.com/google-ai-edge/LiteRT-LM/issues/1881 |
| `third_party/ml_drift` include leak | https://github.com/google-ai-edge/LiteRT-LM/issues/1050#issuecomment-4258021748 |
| Classic GPU delegate (LiteRT) | https://github.com/google-ai-edge/LiteRT/tree/main/tflite/delegates/gpu |
| Classic GPU delegate (TensorFlow) | https://github.com/tensorflow/tensorflow/tree/master/tensorflow/lite/delegates/gpu |
| Open FC kernel (Apache-2.0) | https://github.com/google-ai-edge/LiteRT/blob/main/tflite/delegates/gpu/common/tasks/fully_connected.cc |
| LiteRT Apache-2.0 | https://github.com/google-ai-edge/LiteRT/blob/main/LICENSE |
| 2019 TFLite GPU paper | https://arxiv.org/abs/1907.01989 |
| ML Drift paper (CC BY 4.0) | https://arxiv.org/abs/2505.00232 |
| ML Drift extends 2019 engine | https://arxiv.org/html/2505.00232v1 |
| ML Drift vs classic TFLite GPU (blog) | https://developers.googleblog.com/litert-maximum-performance-simplified/ |
| MediaPipe LLM → LiteRT-LM, maintenance | https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference |
| MediaPipe OSS = CPU only | https://github.com/google-ai-edge/mediapipe/issues/5305#issuecomment-2066973206 |
| llama.cpp OpenCL backend (unrelated) | https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md |

---

## Bottom line for the fork

The 5× gap (5 tok/s ggml-opencl vs 26.8 tok/s LiteRT-LM on Adreno 740) is almost certainly **ML Drift**, not LiteRT-LM’s open executor. You cannot copy those kernels. You can:

1. Reimplement the paper’s layouts + stage split + fused decode GEMV, using the Apache-2.0 2019 kernels as a style reference.
2. Convert GGUF K-quants offline into their per-channel int4/int8 + 4-wide weight tiles (largest single technical cost).
3. Optionally ship LiteRT-LM **as a second engine** via the published `.so` (product, not a port).

Do not plan a “drop their `.cl` into ggml-opencl” milestone. That file does not exist in public.

**Single best entry point:** https://arxiv.org/pdf/2505.00232 plus https://github.com/google-ai-edge/LiteRT/blob/main/tflite/delegates/gpu/common/tasks/fully_connected.cc

DONE
