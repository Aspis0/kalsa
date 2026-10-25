# iOS Governor research (2026-10-08)

Research only. No repo edits, no builds, no devices touched.
Labels: VERIFIED = source opened and quoted. REPORTED = secondhand, URL given. unknown = not found.
Raw agent notes: /tmp/ios-governor-research-raw.md

## Summary

- iOS already runs Metal-only (VERIFIED). The Android Governor does not run on iOS at all.
- No ANE or Core ML path exists in the llama.cpp fork or the kalsa app (VERIFIED).
- No llama.cpp ANE backend or merged PR was found (REPORTED). whisper.cpp has an open ANE decoder PR #3848 (REPORTED).
- No measured iPhone numbers for 1-4B prefill on ANE were found (unknown).
- The one strong-looking iPhone datapoint for ANE is sustained decode retention, from a summarised bench page (REPORTED, see B2).
- The Core ML to llama.cpp KV handoff: no source found. Cost unknown.

## PART A: local (VERIFIED)

### A1. The Android Governor rule

`src/engine/governorInputs.ts:336-341`:
```
const androidOk = npu?.android ?? false;
const visionOk = !npu?.hasMmproj;
const arch = npu?.htpArch ?? null;
const kindOk = modelKind(modelEntry) !== "MoE";
const fitOk = npuLane.fit === "Fit";
const autoOk = androidOk && visionOk && arch !== null && arch >= 73 && kindOk && fitOk;
```

`governorInputs.ts:350`:
```
const enabled = force || GPU_PREFILL_CORRECT[generation] || laneEnabled;
```

- `governorInputs.ts:86`: `type Generation = "V73" | "V75" | "V79" | "V81" | "Unknown";`
- `governorInputs.ts:138-140`: SoC regexes map Qualcomm SoCs to V73/V75/V79.
- `governorInputs.ts:153`: `return "Unknown";` There is no Apple SoC pattern. Apple SoCs fall to Unknown.
- `governorInputs.ts:102`: `Unknown: false,`

Rule: the Governor is on if forced, or the SoC is GPU-qualified, or the Android HTP lane qualifies (arch >= v73, non-MoE, no mmproj, RAM fit). Prefill goes to HTP0 and decode to CPU or Adreno GPU. Inference, not checked: `buildGovernorParams` is Android-gated, so iOS never reaches it.

### A2. iOS backend

- `src/engine/deviceTuning.ts:374-375`:
```
if (isApplePlatform(profile, platformHint)) {
  return { kind: "gpu-metal", reason: "apple" };
```
- `src/engine/deviceTuning.ts:361`: ` * Android → cpu-only. Apple → metal. Emulator → no-accel.`
- `src/engine/LlamaService.ts:2657-2659`: "Not iOS: the governor never loads there and its normal backend is Metal, so with the governor ON by default this would silently drop every iOS load to CPU."
- `src/engine/kvCacheProfile.ts:48-49`: "On iOS: q8_0/q8_0 whatever came in ... Measured on an M1 Max Mac under Metal, not on an iPhone."

### A3. Native build

- The vendor fork is `/Users/marco/Projects/llama.rn-kalsa`. `/Users/marco/Projects/kalsa/ios` and `node_modules/kalsa.rn` do not exist.
- `llama.rn-kalsa/llama-rn.podspec:5`: `... -DGGML_USE_CPU -DGGML_USE_ACCELERATE -DGGML_USE_BLAS ... -DGGML_USE_CPU_REPACK ...`
- `llama-rn.podspec:10`: `base_compiler_flags += " -DGGML_USE_METAL -DGGML_METAL_EMBED_LIBRARY=1 ..."`
- `llama.rn-kalsa/ios/CMakeLists.txt:16,20`: `-DGGML_USE_ACCELERATE`, `-DGGML_METAL_EMBED_LIBRARY=1`
- `llama.rn-kalsa/vendor/llama.cpp/ggml/CMakeLists.txt:96`: `set(GGML_METAL_DEFAULT ON)`
- `kalsa/plugins/withLlamaIosSourceBuild.js:4-6`: the fork ships no iOS xcframework in git; the podspec builds from source.
- No ggml Core ML or ANE backend in the vendored tree (VERIFIED by grep; only unrelated hits).
- I did not build. Whether iOS builds clean today: unknown.
- `kalsa/src/voice/whisperRn.ts:51`: `useCoreMLIos?: boolean;` This is whisper.rn, not the LLM stack.

## PART B: web (REPORTED)

### B1. ANE for prefill from a third-party app

- Core ML MLState (iOS 18+) holds a stateful KV cache. Practitioner reports only: https://alvaro-videla.com/ane-book/05-stateful-kv-cache.html , https://dev.to/software_mvp-factory/wiring-apples-neural-engine-to-core-mls-stateful-models-24m1
- Apple Developer Forums: multi-token prefill left some cache entries unchanged. No confirmed fix found. https://developer.apple.com/forums/thread/783612
- Qwen2.5-3B Core ML stateful, fixed 2048 ctx, targets ANE. Author warns of silent fallback to GPU or CPU when ANE specialisation fails. https://huggingface.co/darkmaniac7/TokForge-Qwen2.5-3B-CoreML-ANE-INT8
- ANEMLL: open-source HF to ANE pipeline (Llama 3.x, Qwen 2.5/3, Gemma 3). No iPhone speed numbers found. https://insiderllm.com/guides/apple-neural-engine-llm-inference/
- Apple Foundation Models (iOS 26): about 3B on-device model, 4K context, not fine-tunable. Not a custom-model route. https://www.natashatherobot.com/p/apple-foundation-models?open=false , https://antongubarenko.substack.com/p/ios-26-foundation-model-framework-f6d
- whisper.cpp Core ML encoder on ANE (more than 3x vs CPU), GGML decoder. Search snippet, not opened. https://github.com/ggml-org/whisper.cpp
- llama.cpp ANE or Core ML backend: no merged or open PR found. whisper.cpp PR #3848 "metal: apple ane decoder" is open. https://app.semanticdiff.com/gh/ggml-org/whisper.cpp/pull/3848/overview
- Private ANE APIs: not researched (unknown here). The App Store ban is background knowledge, not verified in this session.

### B2. Measured numbers

Main source: https://github.com/john-rocky/apple-silicon-llm-bench (iPhone 17 Pro, A19 Pro class). Read through a summariser, so recheck the page before quoting any figure.

- Qwen3-0.6B decode, short chat: Core AI ANE 4-bit 116.9 tok/s warm; Core AI GPU INT4 193.3 cold; MLX GPU Q4 178.8 warm; LiteRT-LM GPU 122.1 warm. (0.6B, not 1-4B.)
- Gemma 4 E2B decode, sustained 600 s: CoreML/ANE 33 to 22 (67% kept); MLX/GPU 48 to 18 (38%); LiteRT-LM/GPU 56 to 27 (48%).
- Gemma 4 E2B llama.cpp Q4_K_M: 38.8 tok/s. Backend (Metal or CPU) unknown.
- Qwen 3.5 2B Debug, iOS 26.4.2: MLX-Swift 61.2, llama.cpp 39.1, CoreML/ANE 27.9 (decode).
- Prefill on iPhone: ANE prefill unknown. GPU prefill for Qwen3-0.6B is a macOS artifact, not comparable.
- ANE load: warm static load 0.045 s; first-load ANE compile described as "high"; numeric compile time unknown.
- ANE RAM: Core AI static ANE Qwen3-0.6B peak 1,158 MB. llama.cpp RAM for the same model: unknown.
- ANE context limit: no numeric source. insiderllm says "typically caps at 512-2048 tokens, some 4096" (secondhand, weak).

Other sources (weaker):
- insiderllm, M4 Mac (not iPhone): ANEMLL Llama 3.2 1B 47-62 tok/s decode; MLX GPU 1B about 204. The article is internally inconsistent on 8B. Treat as weak.
- Ertas AI blog, iPhone 16 Pro, 1B Q4_K_M 40-50 tok/s decode. Vendor blog, method unclear. https://www.ertas.ai/blog/llm-run-on-iphone-benchmarks
- llamadart issue #671: the Metal decode timer measures GPU submission only and reads about 10x high on iPhone 16 Pro. Use wall-clock. https://github.com/leehack/llamadart/issues/671

Not found: a clean A17 Pro / A18 / A19 table for CPU vs Metal decode and prefill in llama.cpp (unknown).

### B3. Unified memory, decode backend, thermal, overlap

- CPU vs Metal decode on iPhone in llama.cpp, with thermal curves: not found (unknown).
- Sustained decode: llama.cpp keeps 54% of burst speed under sustained load (Gemma, per the bench page; REPORTED). Cactus 57%.
- Energy: the ANE path draws about half the GPU package power at full decode, measured on a Mac, not an iPhone (REPORTED).
- Overlapping prefill and decode on the phone: no source (unknown).

### B4. Core ML to llama.cpp KV handoff

- No source found (unknown).
- Inference, not verified: MLState is opaque to ggml. A handoff would need an MLMultiArray readout to host memory, then a copy into a ggml buffer at each switch. The cost scales with KV bytes (context times KV bytes per token). No measured number.
- The Android Governor handoff works because both sides use ggml buffers. That does not carry over to Core ML.

## Verdict

### Alpha and beta: a Metal-first iOS governor

- Today iOS is Metal for everything (A2). That is already the default and it is correct for the alpha.
- A realistic next step is a measured picker, the same idea as the Android Governor: at the first Turn, time Metal and CPU for decode (and prefill), and keep the faster. It needs no new runtime.
- Blocker: there is no iPhone data showing CPU beats Metal for decode in llama.cpp. Decide on measurement, not on the unified-memory argument. Wall-clock timing only (llamadart #671).
- Keep the Governor's SoC table Android-only until an iOS measurement says otherwise. A17/A18/A19 would all be Unknown today.

### Lab: ANE prefill via Core ML, Metal decode, KV handoff

- Not realistic as a product. No llama.cpp ANE backend exists. The KV handoff has no source and a copy cost that is unmeasured.
- The one real argument for ANE is sustained decode retention (Gemma E2B: 67% vs 38% on GPU, REPORTED). That is a thermal argument, and the sustained number is the one to re-measure ourselves.
- A minimal Lab, if the owner wants one: measure sustained decode on Metal vs CPU on a real iPhone (wall-clock, 600 s, the kalsa model). That answers the thermal question before any ANE work. A Core ML prototype would only follow if that shows a gap worth closing.

## Hostile flags

- Bench numbers come through a summariser. Recheck the page before quoting any figure to the owner.
- Most ANE rows are 0.6B, not 1-4B. The 1-4B coverage is sparse.
- A19 Pro (iPhone 17 Pro) is not A17 or A18. No M-series numbers are used except the weak insiderllm row.
- The unknowns are real gaps. Do not fill them with guesses.
