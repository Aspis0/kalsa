# MediaTek APU (NPU) for on-device LLMs — prior-art scan for Kalsa

Date: 2026-09-27. Scope: web research (no NDA material). Question: can a third-party
Android app use the MediaTek APU for LLM inference, especially our GGUF/llama.cpp stack
(LFM2 hybrid, prefill-offload style like our ggml-hexagon work on Snapdragon)?

## 1. MediaTek's own LLM stack

- **NeuroPilot** is MediaTek's SDK portal (tools + runtime for the APU): https://neuropilot.mediatek.com/
  Public docs portal exists; the **NeuroPilot Express SDK is publicly downloadable**
  (ExecuTorch's MediaTek backend fetches it from the public portal:
  https://github.com/pytorch/executorch/tree/main/backends/mediatek).
  The **full toolchain / GenAI SDK is OEM/NDA-gated** per secondary reports (tiered
  Basic/Full/Premium): https://cyberraiden.wordpress.com/2026/08/04/mediatek-dimensity-9400e-explained/ — UNVERIFIED.
- **GenAI announcements**: Llama 2 on-device demo at MWC 2024
  https://www.mediatek.com/tek-talk-blogs/mediatek-demonstrating-on-device-generative-ai-using-llama-2-llm-at-mwc-2024 ;
  Llama 3 on Dimensity via NeuroPilot (Apr 2024)
  https://www.mediatek.com/tek-talk-blogs/mediatek-brings-meta-llama-3-generative-ai-llm-support-to-dimensity-platforms ;
  Llama 3.2: https://www.mediatek.com/tek-talk-blogs/mediatek-dimensity-supports-meta-llama-3.2
- **Dimensity 9300+ press release** (APU 790): supports 1B/7B/13B LLMs "scalable up to
  33B"; 7B at **22 tok/s** with "NeuroPilot Speculative Decode Acceleration"; partner
  model list: Yi-Nano, Qwen, Baichuan, ERNIE-3.5-SE, Gemini Nano, Llama 2/3; names
  "ExecuTorch Delegation" and LoRA Fusion:
  https://www.mediatek.com/press-room/mediatek-boosts-flagship-smartphone-performance-with-dimensity-9300-soc
- **APU generations**: APU 790 (D9300/9300+); **NPU 890** (D9400/9400+, 8th gen; on-device
  LoRA training of 1B models, diffusion-transformer video):
  https://www.mediatek.com/tek-talk-blogs/top-11-features-of-the-dimensity-9400
- **Helio G99 (Jelly Star)**: has an old camera-class APU (550-generation, per
  https://www.cpu-monkey.com/en/cpu-mediatek-helio-g99 — UNVERIFIED generation). It is
  absent from every LLM/GenAI support list below; no LLM path exists for it.
- **Chips with an LLM-usable APU**: Google's LiteRT+NeuroPilot page lists Dimensity
  7300, 8300, 9000, 9200, 9300, 9400, 9500 (MT6878/MT6897/MT6983/MT6985/MT6989/MT6991/MT6990):
  https://developers.google.com/edge/litert/next/mediatek . ExecuTorch's backend: only
  **D9300 and D9400** (repo file `executorch/backends/mediatek/`, README in same dir).
- **Formats/quantization**: weight-only W4A16/W8A16/W16A16 for LLM on DLA (Genio forum
  thread on compiling Llama 3.2 1B: https://genio-community.mediatek.com — thread "How to
  Compile Llama 3.2 1B FP LM Head to DLA on Genio 720"); LiteRT-LM models are 4-bit
  per-channel `.litertlm` (SoC-matched files). **GGUF is not supported anywhere in the
  MediaTek stack.**
- **Prefill vs decode**: MediaTek's demos run the whole transformer on the APU; we found
  **no official doc describing an APU-prefill/CPU-decode hybrid** (absence of evidence).
  Research consensus: NPU excels at compute-bound prefill; decode is memory-bound
  (arXiv 2407.05858 below; MNN-AECS, arXiv Jun 2025 — URL not captured, UNVERIFIED).
- **Reported tok/s**: Llama 2 7B ~20 tok/s on D9300 at launch
  (https://counterpointresearch.com/en/insights/mediatek-strengthens-premium-push-with-gen-ai-capabilities);
  22 tok/s 7B on D9300+ (MediaTek PR above); BlueLM-V-3B **24.4 tok/s** on D9300
  (vivo X100, 4-bit weights, MLC-based deployment): https://arxiv.org/abs/2411.10640
- **Licence/availability**: LiteRT+NeuroPilot and ExecuTorch routes are usable by
  third-party apps; the first-party GenAI SDK is OEM-facing (NDA — UNVERIFIED). The
  LiteRT-LM NPU flow is currently an adb/CLI workflow, not yet an app SDK:
  https://developers.google.com/edge/litert/next/litert_lm_npu

## 2. Android-level routes

- **NNAPI is deprecated in Android 15**; migration guide:
  https://developer.android.com/ndk/guides/neuralnetworks/migration
  Successor for vendor NPUs = vendor delegates/compiled-model APIs, not a Google API.
- **LiteRT (ex-TFLite) + MediaTek NeuroPilot**: `CompiledModel` API with AOT or
  on-device compilation; SoC list in section 1:
  https://developers.google.com/edge/litert/next/mediatek . LLM on NPU today =
  **Gemma3-1B only**, on MT6989 (D9300) and MT6991 (D9400), built via Bazel incl.
  MediaTek dispatch libs (`litert/vendors/mediatek/dispatch` in the litert repo):
  https://developers.google.com/edge/litert/next/litert_lm_npu . Maturity: early
  ("LiteRT Next"), CLI-first; plausible for a Play app once app-facing, but requires
  per-SoC model artifacts.
- **MediaTek Neuron delegate** (TFLite-era, closed-source, device-shipped): listed among
  acceleration options in academic work (CVPR "Learned Smartphone ISP",
  https://openaccess.thecvf.com). Third-party redistribution terms UNVERIFIED.
- **ExecuTorch MediaTek backend**: exists in-tree, `executorch/backends/mediatek/`
  (https://github.com/pytorch/executorch/tree/main/backends/mediatek). Needs the public
  NeuroPilot Express SDK (libneuronusdk_adapter.mtk.so, mtk_converter 8.13.0,
  mtk_neuron 8.2.23 wheels). Only D9300/D9400; version-pinned; early maturity but
  officially sanctioned (MediaTek PR names "ExecuTorch Delegation").
- **ONNX Runtime**: no MediaTek execution provider; NNAPI EP is deprecated with NNAPI;
  Qualcomm precedent: SNPE EP deprecated → QNN EP (issue #19386:
  https://github.com/microsoft/onnxruntime/issues/19386). No viable MediaTek route.

## 3. llama.cpp / ggml

- **No MediaTek APU backend exists** in ggml-org/llama.cpp. GitHub issue search for
  "MediaTek" returns only Vulkan/CPU fixes, no APU request with active work:
  - #28637 — Vulkan: subgroup-16 warp-tile mis-tiling gives wrong results (Dimensity 9500), open
  - #21763 — performance collapse on MediaTek ARMv9 when threads > big-core count
  - #13918 — Vulkan build on Termux/D9300; #25245 — Vulkan CEIL_DIV 32-bit overflow
  (https://github.com/search?q=repo%3Aggml-org%2Fllama.cpp+MediaTek&type=issues)
- The only phone-NPU backend is **ggml-hexagon** (Qualcomm) — `ggml/src/ggml-hexagon/`
  in https://github.com/ggml-org/llama.cpp — our Snapdragon path; no `ggml-apu` equivalent.
- **Mali GPU on Dimensity**: Vulkan backend is the working route (prefill gains,
  decode ~memory-bandwidth-bound): discussion #10879
  https://github.com/ggml-org/llama.cpp/discussions/10879 . But Mali Vulkan is fragile
  (issue #28637 above; MLC reports "GPU not detected in Dimensity phones" in
  https://github.com/mlc-ai/mlc-llm). arXiv 2505.00232 states llama.cpp did not support
  Mali GPUs at time of writing: https://arxiv.org/html/2505.00232v1 . The 2025
  ggml-opencl revamp (docs/backend/OPENCL.md) targets Adreno; Mali improvements
  mentioned but PR number not captured — UNVERIFIED. MLC has explicit OpenCL-on-Mali
  support: https://github.com/mlc-ai/mlc-llm .

## 4. Papers / projects on mobile-NPU LLM inference

- **MLLM-NPU** (arXiv 2407.05858): ~1000 tok/s prefill by offloading prefill to the NPU;
  platform = Snapdragon 8 Gen 3 / Hexagon, not MediaTek: https://arxiv.org/abs/2407.05858
- **llm.npu** ("Fast On-device LLM Inference with NPUs", Mengwei Xu et al., ASPLOS 2025):
  NPU-prefill/CPU-decode scheduling around vendor-NPU shape limits; Hexagon target;
  direct arXiv URL not captured — UNVERIFIED (same group as MLLM-NPU).
- **PowerInfer-2** (arXiv 2406.06282): first 47B on a smartphone, 11.68 tok/s decode via
  CPU+GPU+NPU polymorphic execution (Snapdragon): https://arxiv.org/abs/2406.06282
- **BlueLM-V-3B** (arXiv 2411.10640): 24.4 tok/s on Dimensity 9300, 4-bit, MLC deployment:
  https://arxiv.org/abs/2411.10640
- **MNN** (https://github.com/alibaba/MNN): CPU/GPU (Vulkan/OpenCL) strong; its NPU
  backend targets Huawei-class NPUs; no MediaTek APU backend found.
- **MLC LLM** (https://github.com/mlc-ai/mlc-llm): Vulkan + OpenCL-on-Mali; the only
  third-party framework with a *published* MediaTek-APU LLM result (BlueLM-V-3B above).

## 5. Hybrid / recurrent models (LFM2, Mamba) on the APU

- **No support found**: LiteRT-LM NPU ships Gemma3-1B only
  (https://developers.google.com/edge/litert/next/litert_lm_npu); ExecuTorch MediaTek
  examples and NeuroPilot GenAI lists are transformer LLMs. APU compiler stacks are
  graph/GEMM-oriented; selective scans have sequential dependencies that map poorly to
  NPU pipelines (arXiv "Heterogeneous Operator-level Mapping for Efficient Edge
  Inference", https://arxiv.org — exact ID UNVERIFIED).
- **Precedent that it is possible**: **rwkv-mobile** ships RWKV v6/v7 (recurrent) on
  **MediaTek NeuroPilot 7 (Dimensity 9300)** and NeuroPilot 9 (D9500) via Neuron
  Adapter/uSDK, as dlopen-able .so runtimes — a custom vendor-SDK port, not a generic
  runtime: https://github.com/MollySophia/rwkv-mobile

## What this means for Kalsa

1. **A realistic third-party APU path exists, but only on Dimensity 9300/9400/9500-class
   flagships** (LiteRT's list also admits D7300/8300/9000/9200), via two sanctioned
   routes: LiteRT(+LiteRT-LM) with MediaTek dispatch, or ExecuTorch's `backends/mediatek`.
   Both require leaving GGUF entirely — vendor formats (.litertlm / ExecuTorch pte +
   mtk_neuron conversion), per-SoC artifacts, and the (public) NeuroPilot Express SDK.
   The first-party GenAI SDK route is OEM/NDA territory (UNVERIFIED but consistent).
2. **Integration cost is high** — comparable to or above our ggml-hexagon effort: no
   ggml APU backend exists to build on, the Neuron graph API is version-bound per chip,
   and our LFM2 shortconv+attention hybrid has no vendor operators (attention itself is
   the newer capability on these stacks). The rwkv-mobile project proves recurrent ops
   can be hand-ported to the Neuron SDK, but that is per-model engineering, not a
   runtime we can reuse for LFM2 GGUF.
3. **The Helio G99 (Jelly Star) is a dead end for APU use** — its old APU has no LLM/GenAI
   stack, and MediaTek's own supported-SoC lists start at Dimensity 7300. For MediaTek
   phones our near-term posture stays: CPU decode + Mali-G57/G7xx Vulkan/OpenCL prefill
   (as on our fork), watching LiteRT-LM NPU (today Gemma3-1B) and rwkv-mobile's Neuron
   ports; pursue an NDA conversation only if a specific D9300/9400 flagship SKU justifies
   the porting effort.
