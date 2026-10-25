# Apple Neural Engine access for Kalsa (iPhone, LFM2.5 2.6B / Qwen 3.5 4B)

Research date: 2026-10-08. Scope: read-only web research. Nothing in the repo or on devices was touched.

Legend: **VERIFIED** = I opened the page and quote it. **REPORTED** = taken from search snippets or secondary sources, not opened. **UNKNOWN** = not found.

---

## 1. Direct route: private AppleNeuralEngine.framework

**What the projects did (macOS only)**

- maderix/ANE. VERIFIED from https://github.com/maderix/ANE: "A proof of concept for ANE training via `_ANEClient` and `_ANECompiler` private APIs". "Requires macOS 15+ on Apple Silicon (tested on M4)." "utilization is low (~5-9% of peak)". The page mentions no iOS, entitlements, SIP, or `_ANEModel`/`aned`.
- Orion, arXiv 2603.06728 (https://arxiv.org/abs/2603.06728). VERIFIED: "bypassing CoreML entirely via Apple's private _ANEClient and _ANECompiler APIs"; tested on M4 Max, macOS version not stated. No iOS mention.
- Substack write-up by maderix (https://maderix.substack.com/p/inside-the-m4-apple-neural-engine), REPORTED via search: 40+ private classes in AppleNeuralEngine.framework, including `_ANEClient`, `_ANEModel`, `_ANERequest`, found by class dumping and method swizzling. The M4 Mac is the test platform.
- ANEForge docs (https://aneforge.readthedocs.io/en/latest/) VERIFIED: "a CoreML-free Python frontend for the Apple Neural Engine", runs "from an ordinary user process", "with no CoreML and no special entitlement". iOS is not mentioned. Supported platforms are "M1-M5" Macs.
- ANEForge glossary (https://aneforge.readthedocs.io/en/latest/glossary/) VERIFIED: e5rt is "Espresso's runtime C API family"; "ANEForge reaches the ANE through the `e5rt` path, which requires no entitlement". Path A is "The canonical unentitled ANE dispatch surface." Path B is "Blocked for third parties without `com.apple.aned.private.allow`." Nothing about iOS or the App Store.
- ANE guide (https://ane-guide.readthedocs.io/) VERIFIED: "The engine is reachable directly, below Core ML and from an ordinary user process." It also says: "this work is meant for measurement, research, and on-device experimentation, not for shipping software." It does not discuss iOS, SIP, or boot-args.
- tinygrad. The official `extra/accel/ane` path returned 404 on master, and the repo root page has no ANE mention. VERIFIED: the directory is not there. REPORTED: the ANE section lived in the README in older versions. The ane-guide credits tinygrad with "recovered the HWX program format and the AppleH11ANEInterface IOKit path."
- tinygrad ANE README in a fork (https://github.com/wyh122/tinygrad/blob/master/README.md) VERIFIED as a fork, not the official repo. Heading: "ANE Support?! (broken)". Quotes: "Requires your Python to be signed with `ane/lib/sign_python.sh`", "`com.apple.ane.iokit-user-access` entitlement", `sudo nvram boot-args="amfi_get_out_of_my_way=1 ipc_control_port_options=0"`, "run `csrutil enable --without-kext --without-nvram` in recovery mode", and "Warning: do not rely on the ANE port. It segfaults sometimes." This is the only source I found for the `com.apple.ane.iokit-user-access` key. It describes a Mac setup that disables AMFI and changes SIP-related settings. It says nothing about iOS.

**iOS and non-jailbroken devices**

- UNKNOWN. I found no source showing a non-jailbroken iPhone running private `_ANEClient` or e5rt code. Every project above is macOS-only. The only iPhone ANE work I found uses Core ML (section 3).
- Entitlement: `com.apple.ane.iokit-user-access` is REPORTED only through the fork README. Whether a third-party App Store app can get it: UNKNOWN. It is a restricted entitlement, so it would normally need an Apple grant. Treat that as an inference, not a verified fact.

**App Store rule**

- VERIFIED: Guideline 2.5.1 (https://developer.apple.com/app-store/review/guidelines/): "Apps may only use public APIs and must run on the currently shipping OS." The text does not use the words "private API". Guideline 2.5.2: "Apps should be self-contained in their bundles, and may not ... download, install, or execute code which introduces or changes features or functionality of the app".
- Consequence (my reading): an App Store app calling `_ANEClient`, e5rt, or AppleNeuralEngine.framework breaks 2.5.1. The guideline does not name these symbols, so the enforcement detail is an inference.

**Verdict on the direct route:** for an App Store iPhone app it is effectively barred by 2.5.1, and it is fragile (the sources say so). On Macs it is feasible but research-grade. On a non-jailbroken iPhone it is unverified, and I found no evidence it works.

---

## 2. Public routes

**Core ML**

- Compute units: REPORTED. The Apple page at https://developer.apple.com/documentation/coreml/mlcomputeunits had only its title in the fetch, and computeUnits had an empty body. Coremltools docs list `CPU_AND_NE` as "Use both the CPU and ANE, but not the GPU." Source: https://apple.github.io/coremltools/docs-guides/source/load-and-convert-model.html (REPORTED via search). Setting `config.computeUnits = .cpuAndNeuralEngine` is standard Swift, but I did not verify it against Apple's page.
- Stateful KV (MLState): REPORTED. WWDC24 session 10161 summary (https://wwdcnotes.com/documentation/wwdc24-10161-deploy-machine-learning-and-ai-models-ondevice-with-core-ml/, a community summary, not Apple's text): "Core ML can now manage the KV cache using states, leading to faster prediction times." It also quotes "Utilizes Apple silicon's CPU, GPU, and Neural Engine via MPS Graph and BNNS Graph". The Mistral 7B figure (~8 s to ~5 s, M3 Max) is from that summary. The "iOS 18+" minimum is REPORTED. One search source said 19.1; that conflicts and is unverified.
- ANE placement is not guaranteed. Apple's public docs do not promise it. The dou.ua article (below) says the author checked ANE placement in practice, and a developer blog (REPORTED) says CoreML can silently fall back to GPU.

**MPSGraph / BNNS Graph**

- VERIFIED: https://developer.apple.com/documentation/accelerate/bnns-library.md: "The BNNSGraph API provides the means to build CPU based neural networks from the mlmodelc file that Xcode compiles from an ML package." It is CPU only, per Apple's text.
- MPSGraph targeting the ANE: UNKNOWN. I found no Apple statement that MPSGraph dispatches to the ANE. The WWDC24 summary quote above mentions it only in passing.

**Foundation Models**

- VERIFIED (newsroom): Foundation Models is a Swift API over the on-device model and Private Cloud Compute. Core ML/ANE are not mentioned in the Foundation Models sentences.
- Per WWDC26 session 324 (below), Foundation Models can plug in a Core AI Language model via `CoreAILanguageModel`. So Foundation Models is a front end, not an ANE route by itself.

**Core AI (new at WWDC 2026)**

- VERIFIED: Apple newsroom (https://www.apple.com/newsroom/2026/06/apple-aids-app-development-with-new-intelligence-frameworks-and-advanced-tools/): "Core AI is a brand-new framework designed to be the best way to run models on device." "Core AI provides an architecture optimized for the unified memory and Neural Engine of Apple silicon..." The newsroom does not mention Core ML. Its OS wording is "Developer betas for iOS 27 ... are available."
- VERIFIED: WWDC26 session 324 (https://developer.apple.com/videos/play/wwdc2026/324/): "It provides blazing fast inference across the CPU, GPU, and Neural Engine." "Core AI is available on all Apple Silicon to help you build cutting edge AI experiences on all Apple platforms." "with no server and no cost per token." The page gives no minimum iOS version and does not say Core ML is replaced.
- VERIFIED: WWDC26 session 326 (https://developer.apple.com/videos/play/wwdc2026/326/): an iOS example app. "I am interested that it targets iOS 27.0 and macOS 27.0". It says "The first load of a large model triggers specialization, which can be slow." Models ship via Background Assets. `xcrun coreai-build compile MyModel.aimodel --platform iOS` does ahead-of-time compilation.
- VERIFIED: apple/coreai-models (https://github.com/apple/coreai-models): "macOS and iOS 27.0+", "Xcode 27.0+", BSD-3-Clause. It has a `models/` catalog and export recipes. LFM and Liquid are not named on the page.
- VERIFIED: apple/coreai-torch (https://github.com/apple/coreai-torch): BSD 3-Clause, converts PyTorch to Core AI IR, `pip install coreai-torch`. No ANE or compute-unit text on the page.
- Compute-unit control in Core AI: UNKNOWN. A third-party blog names `SpecializationOptions` (REPORTED, unverified). I did not find Apple's API for pinning ANE vs GPU.
- Status as of 2026-10-08: UNKNOWN whether iOS 27 is out on production devices, and whether iPhone 15 Pro (A17 Pro) is supported. The sources only say "beta" (June 2026).

**Any newer public ANE API**: Core AI is the only one I found. Its ANE behaviour is described only in general terms ("across the CPU, GPU, and Neural Engine").

---

## 3. ANEMLL and other converters

**ANEMLL** (https://github.com/Anemll/Anemll)

- VERIFIED: "ANEMLL (pronounced like "animal") is an open-source project focused on accelerating the porting of..." MIT License. Version "0.3.5 Beta Release". Conversion command: `./anemll/utils/convert_model.sh --model <path> --output <dir>`. "The first time the model loads, macOS will take some time to place it on the device."
- VERIFIED supported architectures: Qwen 3 (0.6B, 1.7B, 8B); Meta LLaMA 3.1/3.2 (1B, 8B); Gemma 3 (270M, 1B, 4B QAT). **LFM / Liquid: not on the page.** Qwen 3.5 4B: not on the page (only Qwen 3).
- VERIFIED iOS: "Fully rebuilt iOS/macOS/visionOS reference app with voice input". "M1/A14 limitation: Constrained to 512-context monolithic models due to ANE non-uniform state shape restrictions". "Minimum 16GB RAM" appears as a requirement. The page gives no tok/s numbers and no conversion time.
- REPORTED (secondary blogs): context about 2K–4K, Gemma 3 up to 4K.

**Published iPhone number (the best precedent)**

- VERIFIED from dou.ua (https://dou.ua/goto/8sgV, Ukrainian): tests on "одному iPhone 16 Pro" (iOS 27.0). Model: MamayLM-Gemma-3-4B-IT, 4-bit LUT for layers and 6-bit for the output layer. Pipeline: "MamayLM (HF) → конвертер Gemma 3 з ANEMLL → Core ML INT4 → Swift-застосунок → ANE". Context 1024, 4 chunks, single KV cache, static prefill. Decode: "16–18 токенів за секунду" on iPhone. The same article reports MLX on GPU at about 21–22 tok/s. The compile on the device: "2,5–4 хвилини" from scratch, about 24 s with cached parts. The conversion time is not stated. The author is one person, one device, one model. Treat it as a single data point.

**LFM2 on ANE**

- UNKNOWN for ANE. The only LFM2.5 Core AI bundles I found are community conversions by visible-cx (https://huggingface.co/visible-cx/LFM2.5-2.6B-CoreAI). VERIFIED from that page:
  - Load platform: "Apple silicon Macs running Core AI on macOS." The page does not mention iOS or iPhone.
  - Measured on "a 16 GB Apple silicon Mac (M2 Pro, macOS 27 beta)": guided decode "38.1–40.0 tok/s", 15k needle decode "32.2 tok/s", Max RSS "6.71 GB".
  - "Minimum practical machine memory: 16 GB, at any declared context including 16384."
  - Quantization "int8 block-32 symmetric weight quantization", two entry points (decode and chunked prefill), contexts 4096/8192/16384 (`--max-ctx` changes the manifest value only).
  - License "LFM Open License v1.0".
  - Thinking-model note: the chat template must close the reasoning block in the generation prompt.
  - Built with `export_lfm2_multifunction.py`, flags `int8hu --head-sym --chunk 64`, on apple/coreai-models b1cb71b, coreai-torch 0.4.1, coreai-core 1.0.0b2, coreai-opt 0.2.1, torch 2.9.0 (REPORTED from the page's own text, not checked against the repo).
  - Nothing on the page says the model runs on the ANE. The phrase "gpu-pipelined" in its folder names suggests a GPU path. Placement: UNKNOWN.
- The 16 GB Mac minimum matters for an iPhone 15 Pro (8 GB RAM). Nothing I found shows a 2.6B model fitting in 8 GB with a usable context.

**Liquid AI LEAP SDK**

- VERIFIED (https://docs.liquid.ai/deployment/on-device/sdk/overview): "It was a Kotlin Multiplatform wrapper around llama.cpp" and "new projects should use llama.cpp directly." LEAP is frozen: "they are frozen at their last release and are not updated for new LFM checkpoints." The page does not mention Metal, Core ML, ANE, or NPU.
- So LEAP does not give an ANE route. Its iOS path is llama.cpp (GGUF). REPORTED from a search snippet: iOS SDK requires iOS 17.0+.

---

## 4. llama.cpp / ggml Core ML or ANE attempts

- The blog claim "llama.cpp issue #3898 has been open since April 2024" is **REFUTED**. VERIFIED: https://github.com/ggml-org/llama.cpp/issues/3898 is a merged PR, "metal : fix build errors and rope kernel sig after #2268", merged Nov 2, 2023. It has nothing to do with Core ML or ANE. The blog also says that #3898 is an Ollama tracker issue, which I did not check.
- llama.cpp discussion #4167 (https://github.com/ggml-org/llama.cpp/discussions/4167) VERIFIED: "Performance of llama.cpp on Apple Silicon M-series". Its opening post does not mention Core ML or ANE. Its tables list Metal. It is a benchmark thread, not a backend attempt.
- I did not find a llama.cpp Core ML/ANE PR or issue that was actually opened. UNKNOWN whether one exists. The reason it stalled is not documented in anything I found. The likely reasons, which I could not confirm: no public ANE API (the only route is Core ML's black box, per the book below), and static-shape requirements.
- MLX: REPORTED via search, MLX maintainer: "At the moment we don't have plans to support ANE in MLX given it is a closed source API." (https://upd.dev/ml-explore/mlx/issues/18, not opened.)
- whisper.cpp precedent. VERIFIED from https://github.com/ggml-org/whisper.cpp: "On Apple Silicon devices, the Encoder inference can be executed on the Apple Neural Engine (ANE) via Core ML." "This can result in significant speed-up - more than x3 faster compared with CPU-only execution." "The first run on a device is slow, since the ANE service compiles the Core ML model to some device-specific format." Only the encoder, not the LLM decode.
- ExecuTorch has an ANE-oriented static Llama path with Core ML export (REPORTED). It is a separate runtime.

---

## 5. KV handoff between Core ML and ggml/Metal

- No project found that moves a KV cache from a Core ML (ANE) model to ggml/Metal, or the reverse. UNKNOWN whether one exists.
- Related facts (REPORTED from search): MLState is the public Core ML mechanism for a cache that lives inside the runtime. A community write-up warns that a multifunction prefill/decode package sharing one state is hard to make reliable and crashes often. Another notes that each Swift-to-Core-ML shard boundary adds orchestration cost.
- Design note (my reasoning, not sourced): a handoff needs identical layout (dtype, head order, sequence-major vs layer-major) on both sides, and one copy at the prefill→decode boundary, not per token. This is not needed for a whole-model Core AI or Core ML route. It only matters for a split design, which I would not start with.

---

## Minimal Lab: LFM2.5 2.6B on iPhone 15 Pro via public APIs

Goal: find out whether the model's layers run on the ANE and how fast it decodes, not whether it ships.

Steps:

1. Confirm the target OS: iOS 27 status on 2026-10-08, and whether iPhone 15 Pro (A17 Pro, 8 GB RAM) is supported. UNKNOWN. If it is not, this Lab can only run on a newer iPhone.
2. Get a bundle. Options: (a) run `apple/coreai-models` export recipes for LFM2.5 2.6B on macOS 27 with coreai-torch, or (b) test the visible-cx bundle first, which exists and is measured on Mac only. Start with (b) because it avoids a conversion.
3. Build a minimal Swift app that loads the `.aimodel` (Core AI) or a `.mlpackage` (Core ML with `computeUnits = .cpuAndNeuralEngine`). Keep the first version to one prompt.
4. Measure on the device, not the Mac: first-load specialization time (sources: 2.5–4 min for Gemma 4B on iPhone 16 Pro), decode tok/s at 1k and 4k context, peak memory, and thermal state after 5 minutes.
5. Check ANE residency with Xcode's Core ML performance report or the Core AI Instruments template. Do not trust a faster number until residency is confirmed (the GPU-fallback risk).
6. Compare against the current llama.cpp Metal baseline on the same phone and prompt. Only a 1.5× or better gain justifies the extra work (per the owner's catalog bar in memory).

Risks:

- LFM2 hybrid (conv + attention) ops may not map to ANE. The ANE-side evidence is for dense transformers (Llama, Qwen, Gemma). LFM2 on ANE: UNKNOWN.
- ANE static shapes: 512-context monolithic limit on older chips (ANEMLL, REPORTED for M1/A14). The iPhone 16 Pro precedent used 1024 ctx. Context on an iPhone 15 Pro is unknown.
- Memory: 2.6B at int8 on an 8 GB phone, with the model and KV together. The visible-cx minimum is 16 GB on Mac. Unknown fit.
- Thinking template: LFM2.5 2.6B needs the reasoning block closed in the generation prompt, or it runs out of budget.
- iOS 27 and Core AI are beta-era APIs: they may change. The coreai-models repo calls itself a model catalog with export recipes; its stability is unknown.
- Distribution: Core AI or Core ML models can ship in the app or by Background Assets (session 326). Model size and download policy are product calls.
- Ahead-of-time compile (`coreai-build`) may be needed to cut load time.

---

## Sources

- https://github.com/maderix/ANE (VERIFIED)
- https://arxiv.org/abs/2603.06728 (VERIFIED)
- https://maderix.substack.com/p/inside-the-m4-apple-neural-engine (REPORTED)
- https://aneforge.readthedocs.io/en/latest/ (VERIFIED)
- https://aneforge.readthedocs.io/en/latest/glossary/ (VERIFIED)
- https://ane-guide.readthedocs.io/ (VERIFIED)
- https://github.com/wyh122/tinygrad/blob/master/README.md (VERIFIED, fork)
- https://github.com/tinygrad/tinygrad (VERIFIED: no ANE on the root page)
- https://developer.apple.com/app-store/review/guidelines/ (VERIFIED)
- https://developer.apple.com/documentation/accelerate/bnns-library.md (VERIFIED)
- https://developer.apple.com/documentation/accelerate/bnnsgraph.md (VERIFIED: availability only)
- https://wwdcnotes.com/documentation/wwdc24-10161-deploy-machine-learning-and-ai-models-ondevice-with-core-ml/ (VERIFIED as a community summary)
- https://www.apple.com/newsroom/2026/06/apple-aids-app-development-with-new-intelligence-frameworks-and-advanced-tools/ (VERIFIED)
- https://developer.apple.com/videos/play/wwdc2026/324/ (VERIFIED)
- https://developer.apple.com/videos/play/wwdc2026/326/ (VERIFIED)
- https://github.com/apple/coreai-models (VERIFIED)
- https://github.com/apple/coreai-torch (VERIFIED)
- https://huggingface.co/visible-cx/LFM2.5-2.6B-CoreAI (VERIFIED)
- https://github.com/Anemll/Anemll (VERIFIED)
- https://dou.ua/goto/8sgV (VERIFIED, Ukrainian original)
- https://docs.liquid.ai/deployment/on-device/sdk/overview (VERIFIED)
- https://github.com/ggml-org/llama.cpp/issues/3898 (VERIFIED: a merged PR, not the claimed issue)
- https://github.com/ggml-org/llama.cpp/discussions/4167 (VERIFIED)
- https://github.com/ggml-org/whisper.cpp (VERIFIED)
- https://alvaro-videla.com/ane-book/00-why-ane.html (VERIFIED)
- https://developer.apple.com/documentation/coreml/mlcomputeunits and .../mlmodelconfiguration/computeunits (fetched, empty bodies)
- https://upd.dev/ml-explore/mlx/issues/18 (REPORTED)
- https://apple.github.io/coremltools/docs-guides/source/load-and-convert-model.html (REPORTED)
