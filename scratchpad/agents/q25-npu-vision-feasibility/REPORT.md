# Q25 — NPU / HTP Vision-Feasibility Desk Research

> Status: desk research complete (2026-08-22; no device access)  
> Scope: web + local-document research only; no device access or hardware measurements.

## Executive summary

The current upstream `ggml-hexagon` backend is real but still marked “In Progress/experimental.” As of the 2026-08-22 master snapshot it builds separate HTP skels for v73, v75, v79 and v81, so v73 is not excluded by the backend. Its accelerated quantized matmul path is narrow: Q4_0, Q4_1, Q8_0, IQ4_NL and MXFP4 (plus F16/F32 weights), with strict shape/repack/VTCM checks; Q4_K/Q5_K/Q6_K are not in the supported matmul switch. This makes the shortlist’s original “does Q4_0 load on v73?” test valid, but it is a backend/graph-coverage test rather than a generic NPU-capacity test.

The strongest desk-research case is compute-bound prefill or a purpose-built vision/embedding graph, not decode. VTCM is a working-set scratchpad: weights remain in unified DRAM and are fetched in chunks, so “8 MB” is not a model-size ceiling. The major unresolved risks are graph/operator coverage for a complete vision encoder, app packaging/runtime availability on retail Android, and unmeasured CPU↔HTP handover cost. No public source located in this sweep supplies a trustworthy v73/v75 sentence-embedding latency table.

## Context read first

- `scratchpad/agents/q25-crazy-proposals/REPORT.md`, entries #2 (NPU spikes), #3 (vision on HTP).
- `docs/research-adreno-vs-mali-8xx-2026-08.md`.

## 1. llama.cpp Hexagon backend today

### Finding

**v73 is supported by today’s upstream backend; v75+ is not required.** The current CMake file explicitly builds `libggml-htp-v73.so`, `v75`, `v79`, and `v81`, and the runtime selects the matching library. The Snapdragon developer documentation shows the same four artifacts. This is enough to keep the S23 (Snapdragon 8 Gen 2 / v73) in scope, subject to its phone firmware exposing the needed FastRPC/HTP runtime.

For `MUL_MAT`, `MUL_MAT_ID`, and the quantized weight path, the current source accepts:

- Quantized weights: **Q4_0, Q4_1, Q8_0, IQ4_NL, MXFP4**. The source has dedicated tiled/flat HVX kernels and repacking for these five types.
- Dense weights: **F16 and F32**, with layout/shape restrictions.
- Activations/outputs are primarily F32 (the matmul input may be F32 or F16 for ordinary `MUL_MAT`; `MUL_MAT_ID` requires F32 activation and I32 expert indices).
- **Q4_K/Q5_K/Q6_K and other K-quants are not accepted by the current `supported_mul_mat` / `supported_mul_mat_id` switches.** A model can load into a CPU buffer, but that is not evidence that its matmuls execute on HTP; unsupported nodes fall back or prevent HTP claiming the op.

The op dispatcher currently advertises support checks for binary arithmetic (`MUL`, `ADD`, `SUB`, `DIV`), matmul and indexed matmul, `ADD_ID`, norms, scale/clamp, square/sqrt, sum-rows, softmax, selected unary functions (neg/exp/sigmoid/softplus/tanh/SiLU/GELU), GLU activations, RoPE, FlashAttention, copy/cont/reshape/view/permute/transpose, repeat, argsort, SSM convolution, `IM2COL`, gated delta net, cumsum, concat/fill/diag/triangular/solve-tri/pad, and related graph ops. “Advertised” means the tensor-type/shape-specific predicate passes; it does not mean every model layout is covered. The source still has tight restrictions (for example, RoPE is F32-only and the current Q4 matmul path rejects a weight row dimension not divisible by 32, and rejects an LM head wider than 32,768 columns).

The backend is **direct Hexagon/FastRPC**, not a generic NNAPI delegate and not the older QNN graph path: the host library includes `dspqueue`/`rpcmem`, allocates shared buffers, and builds an IDL-generated HTP interface plus device-side skels. The official Android build recipe requires Android NDK plus **Hexagon SDK Community Edition 6.6 or later**; the backend CMake requires `HEXAGON_SDK_ROOT` and `HEXAGON_TOOLS_ROOT`, generates the IDL stub/skel, and builds the four versioned HTP shared libraries. The HTP-side runtime/driver components on the retail phone remain Qualcomm/vendor software. The repo is open source, but the SDK and phone runtime are Qualcomm-controlled; this is a distribution/deployment dependency, not a claim that the HTP execution stack is fully open or freely redistributable. The signing requirement documented for Windows is not the Android recipe, but it reinforces that the skel/runtime boundary is platform-controlled.

### Version/date/source notes

- Upstream `llama.cpp` Snapdragon README and `ggml-hexagon/CMakeLists.txt`, master snapshot checked **2026-08-22**: Android NDK + Hexagon SDK Community Edition 6.6+, v73/v75/v79/v81 skels.
- Upstream `ggml-hexagon.cpp`, master snapshot checked **2026-08-22**: supported-type switches, op predicates, and fallback/claim behavior.
- Upstream Snapdragon developer documentation, master snapshot checked **2026-08-22**: host `libggml-hexagon` versus HTP `libggml-htp-vNN`, unified buffers, VTCM use.
- `llama.cpp` issue **#18075** (late 2025) is useful historical context that GET/SET_ROWS/FlashAttention support was incomplete; current master has restricted predicates for these, so the gate must use the exact tested revision, not the old issue’s status.
- `llama.cpp` issue **#26094**, 2026: v73 and v75 Q4_0 benchmark table shows HTP can execute prompt processing, while batched shapes can fall back because the current quantized matmul predicate rejects `n_seqs != 1`.

### Practical answer for Kalsa

Keep the v73 quant-load gate, but make it a **revision-pinned Q4_0/IQ4_NL graph-claim test**: verify model load, `GGML_SCHED_DEBUG=2`/verbose assignment, correct output, and no CPU fallback for the intended prefill subgraph. Do not use Q4_K_M as the HTP acceptance test; current source does not claim it.

## 2. HTP prefill performance for 1–4B models

### Finding

There is credible evidence that HTP prefill can be dramatically faster than CPU prefill for small models, but the evidence is not interchangeable:

1. `ggml-hexagon` numbers are the closest match to Kalsa, but current public reports are still early, revision-sensitive, and show shape-triggered CPU fallback.
2. The ASPLOS 2025 `mllm-NPU` result is a strong upper-bound/reference for a QNN/INT8 co-designed graph, not a drop-in llama.cpp result.
3. Qualcomm AI Hub exposes useful per-model profiles, but the current Qwen3-1.7B page has no supported mobile profile; do not turn the local proposal’s “690 tok/s” figure into a current S23/Xiaomi promise without a matching job record.

### Public measurements

| Source / model | Device and HTP generation | Quantization / runtime | Prompt or batch condition | Reported prefill result | What it proves for Kalsa |
|---|---|---|---|---|---|
| [`llama.cpp` discussion #23314](https://github.com/ggml-org/llama.cpp/discussions/23314), Qwen3.5 4B | Snapdragon device not identified in the post; **v73/v75 cannot be assigned** | Q4_0, build commit `748c76f` / discussion snapshot in 2026 | `pp128` | CPU 74.58 tok/s; OpenCL 105.12; HTP 71.21; mixed OpenCL+HTP 73.79 | A real llama.cpp HTP path can claim prompt work, but this report is not a phone-specific v73/v75 baseline and is not faster in this configuration. |
| [`llama.cpp` issue #26094](https://github.com/ggml-org/llama.cpp/issues/26094), Qwen3.5 2B | Snapdragon **v73** and **v75** | Q4_0; 2026 issue benchmark | `npl1`, `pp512` | v73: **461.43 tok/s**; v75: **419.93 tok/s** | Best current apples-to-apples evidence that both generations can execute Q4_0 prompt work. The issue also records quantized `MUL_MAT` rejecting `nseq != 1`, causing CPU fallback for batched shapes; the clean `npl1` result is the relevant gate baseline. |
| Same issue #26094 | v73 / v75 | Q4_0 | `npl2`, `pp112` | v73 112.44; v75 110.16 tok/s | Throughput drops sharply when the graph shape changes; HTP support is not equivalent to “all prefill batching is accelerated.” |
| [`mllm-NPU` ASPLOS 2025 paper](https://xumengwei.github.io/files/ASPLOS25-NPU.pdf), Qwen1.5-1.8B and other 2–7B models | Redmi K60 Pro / Snapdragon 8 Gen 2 (**v73**); Redmi K70 Pro / Snapdragon 8 Gen 3 (**v75**); Android 13 | QNN-based implementation with INT8 linear layers and co-designed scheduling; CPU decode | prompt lengths 64/256/1024 | Abstract: **>1,000 tok/s prefill** for Qwen1.5-1.8B; at prompt 1024, reported speedup over llama.cpp CPU is **21.3–41.3× on v73** and **18.17–38.4× on v75**, depending on model/device | Strong feasibility evidence for purpose-built compute spikes. It is not evidence that current upstream `ggml-hexagon` will deliver >1,000 tok/s: it uses QNN, INT8 linear kernels, shared buffers, and algorithm/hardware co-design. |

The issue #26094 `npl1 / pp512` numbers are the most defensible current llama.cpp reference: approximately **461 tok/s on v73 and 420 tok/s on v75** for a 2B Q4_0 graph, with a warning that other sequence shapes can fall back. The paper’s much larger speedups are plausible for a dedicated QNN graph, but the paper’s exact per-model/per-device tok/s values are presented mainly in figures; only the abstract’s “>1,000 tok/s” and the text’s speedup ranges are transcribed here.

The local Q25 shortlist entry cites an AI Hub-style “690 tok/s prefill” result. This web pass did not find a current Qualcomm AI Hub job URL that identifies that exact number, model, prompt length, HTP generation, and precision together. Treat it as an unverified lead until the original job/profile is recovered.

### Version/date/source notes

- `llama.cpp` discussion #23314 is a 2026 discussion and identifies the tested commit (`748c76f`); it does not identify the phone generation in the quoted benchmark.
- `llama.cpp` issue #26094 is a 2026 v73/v75 benchmark report and is tied to the current backend’s Q4_0 shape behavior, not a generic QNN benchmark.
- `mllm-NPU` is an ASPLOS 2025 paper (conference dates March 30–April 3, 2025); its implementation is built on MLLM + Qualcomm QNN and should be treated as independent research evidence.

### Practical answer for Kalsa

Measure a **single-sequence, fixed-prompt prefill** first. Report tok/s and wall time separately for v73 and v75, then repeat with the intended MoE/embedding shape. A headline number from `pp512/npl1` is not enough: the backend’s current `nseq != 1` limitation can silently move work back to CPU.

## 3. Vision encoders on HTP

### Models and measured profiles

| Model / source | Size and input | Precision/profile | Public latency | Relevance to S23 / Xiaomi 14 |
|---|---|---|---|---|
| [OpenAI CLIP ViT-B/16 — AI Hub model card](https://aihub.qualcomm.com/models/openai_clip) | 150M parameters; 224×224; float size 571 MB; text context 77 | AI Hub lists phone/8 Gen 2/8 Gen 3 compatibility, but the current card says **not supported** for current Mobile profiles | [QCS8550 proxy, ONNX Runtime job](https://aihub.qualcomm.com/jobs/jp0ryjwep): **15.7 ms**, NPU; [QCS8550 TFLite job](https://aihub.qualcomm.com/jobs/jgklx76w5): **15.3 ms**, NPU; [SA8775P TFLite/QNN job](https://aihub.qualcomm.com/jobs/jpv1ewzkp): **20.9 ms**, NPU | Confirms CLIP is compilable through QNN-backed runtimes, but these are proxy/automotive targets, not S23/Xiaomi measurements. |
| [OWL-ViT — AI Hub model card](https://aihub.qualcomm.com/mobile/models/owl_vit) | CLIP ViT-B/32; 153M parameters; 768×768; float size 613 MB | Card lists phone-class devices/chipsets but currently says no supported Mobile profile | No trustworthy current v73/v75 latency found | Candidate architecture, not an executable Kalsa target yet; higher 768² input makes working-set/bandwidth risk worse. |
| [ViT ImageNet — AI Hub model card](https://aihub.qualcomm.com/models/vit) | 86.6M parameters; 224×224; float 330 MB; w8a16 86.2 MB; w8a8 83.2 MB | Card lists S23 and Snapdragon 8 Gen 2/3 but currently says not supported | [SA8295P QNN profile](https://aihub.qualcomm.com/jobs/j5wd8zxjg): **13.0 ms**, NPU, 1–310 MB peak; not v73/v75 | The cleanest generic ViT-class reference; profile is automotive/SA8295P, so use only as order-of-magnitude evidence. |
| [MobileViT — AI Hub compute card](https://aihub.qualcomm.com/compute/models/mobile_vit) | 5.57M parameters; 224×224; float 21.4 MB; w8a16 6.56 MB | ONNX Runtime, NPU; current compute profile is Snapdragon X2 Elite, not phone v73/v75 | **1.83 ms** on X2 Elite | A useful small-encoder sizing reference and a plausible fallback architecture, but not a retail-phone result. |
| [VideoMAE — AI Hub model card](https://aihub.qualcomm.com/models/video_mae) | 87.7M parameters; ViT backbone; 224×224 | NPU profile on Q-8750-like device | About **3.54 s** for the video workload; not a single-image v73/v75 profile | Shows that “ViT exists on HTP” does not imply a low-latency single-image encoder; workload definition matters. |
| [Gemma 4 E2B/E4B model cards](https://aihub.qualcomm.com/models/gemma_4_e2b_it) | Multimodal model with a SigLIP-style ViT vision encoder; effective 2B/4B model | w4a16; current cards require newer QAIRT/QNN and target 8 Elite/Gen 5/X families | No v73/v75 standalone vision-encoder latency | Evidence that Qualcomm’s current supported multimodal path is moving toward newer HTP generations; not a v73/v75 extraction target. |

AI Hub’s public catalog is therefore evidence of **availability of model recipes and compiled profiles**, not evidence that every listed phone has a ready-to-run profile. The cards frequently list a device/chipset as compatible while the current profile banner says “Not supported”; that distinction is material for a third-party app.

The linked CLIP jobs identify concrete toolchain versions: the QCS8550 ONNX profile uses ONNX Runtime 1.24.1 / QAIRT 2.42 (AI Hub profile dated 2026-02-26); the QCS8550 TFLite profile uses TFLite 2.17 / QAIRT 2.43 (AI Hub profile dated 2026-03-09); and the SA8775P profile uses LiteRT 1.4.2 with QNN TFLite delegate / QAIRT 2.43 (AI Hub profile dated 2026-03-29). These versioned profiles are primary evidence that the graph compiles and runs on those targets, but none is an S23/v73 or Xiaomi 14/v75 result.

### Can a third-party Android app run it?

**Technically yes, operationally conditional.** Google’s public [LiteRT Qualcomm HTP instructions](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/doc/HTP_INSTRUCTIONS.md) document both AOT and JIT paths and the QNN HTP delegate packaging: `libQnnSystem.so`, `libQnnHtp.so`, the architecture-specific stub/skel, LiteRT, and dispatch libraries. The [Qualcomm LiteRT integration](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/README.md) is an ordinary Android integration route; the public instructions do not specify a special Android entitlement.

The qualification is important:

- The app must ship or obtain compatible closed QNN/QAIRT libraries and the correct HTP stub/skel for the target SoC/firmware, subject to Qualcomm redistribution/licensing terms.
- The model must be compiled for the actual target architecture. A June 2026 [LiteRT issue #8037](https://github.com/google-ai-edge/LiteRT/issues/8037) reports the public AOT compiler ignoring `--soc_model=SM8550` and emitting v79, which is a direct warning for S23/v73.
- Retail firmware must expose the required HTP service/FastRPC protection domain. A successful AI Hub profile is not proof that arbitrary sideloaded apps can use the same service.
- NNAPI itself does not require a special entitlement, but [Android deprecated NNAPI in Android 15](https://developer.android.com/ndk/guides/neuralnetworks/migration-guide), and a generic NNAPI call does not guarantee HTP execution; it may select another accelerator or CPU.

For Kalsa, a QNN/LiteRT proof should be a separate app-packaging gate from the llama.cpp backend gate. “No special entitlement documented” is not the same as “portable across retail S23/Xiaomi 14 firmware.”

## 4. The 8 MB VTCM constraint

### Finding

The 8 MB figure is a **working-set/scratchpad budget, not a hard model-size limit**. Upstream’s Hexagon developer documentation says Snapdragon uses unified memory and that VTCM is used for intermediate data, dynamically quantized tensors, and temporary chunks of weights fetched by DMA. The current matmul planner computes a per-op VTCM layout and rejects an op only when that operation’s required scratchpad exceeds the available budget. The weight tensor itself can reside in a much larger ordinary shared/DRAM-backed buffer; the source explicitly streams tiled weight rows into VTCM.

This is favorable for a 1–4B prefill or encoder graph, but it does not make the model “fit in 8 MB.” The cost becomes DMA/DRAM traffic and reuse. A complete vision encoder can still fail because one intermediate, fused matmul, or operator-specific layout exceeds the per-op VTCM budget, or because the graph has unsupported ops—not because its total weights exceed 8 MB.

### QNN/Qualcomm interpretation

The public llama.cpp backend documentation is the clearest directly applicable source for this implementation. Qualcomm’s public [AI Hub/QNN option documentation](https://workbench.aihub.qualcomm.com/docs/hub/api.html) treats VTCM as a configurable amount to “reserve and utilize” (`qnn_htp_vtcm_size` / `default_graph_htp_vtcm_size`); it says an unset graph option uses the device/default amount and that a requested amount is clipped to what the device has. The same page describes graph optimization and precision options, not a requirement that the complete serialized model or all weights be resident in VTCM. Qualcomm’s [QNN weight-sharing note](https://docs.qualcomm.com/doc/KBA-250306025001/KBA-250306025001_REV_1_QNN_Weight_Sharing_Feature.pdf) separately discusses persistent context binaries, memory limits, and sharing weights across graphs—another indication that weights are managed as larger runtime resources rather than equated with the VTCM scratchpad.

The implementation evidence is stronger for Kalsa: `ggml-hexagon` allocates shared buffers with `rpcmem`, maps them through FastRPC, and the HTP kernels DMA only temporary tiles. Therefore a claim that “the 8 MB VTCM makes a >8 MB encoder impossible” is false; the correct question is whether its per-op working sets, context/DRAM footprint, and weight-streaming bandwidth are acceptable. QNN’s public options do not provide a universal promise that a large graph’s weights will stream with no extra cost; that remains backend/compiler/model dependent.

### Version/date/source notes

- Upstream Snapdragon developer documentation, master snapshot checked **2026-08-22**: VTCM is for intermediates/temporary weight chunks; unified memory backs the larger buffers.
- Upstream `ggml-hexagon.cpp` and `htp/matmul-ops.c`, master snapshot checked **2026-08-22**: VTCM layout checks and DMA tile prefetch.
- Qualcomm AI Hub/QNN option documentation, checked **2026-08-22**: `qnn_htp_vtcm_size` is a reserve/use option and defaults are device/compiler controlled; it is not documented as a whole-model capacity limit.
- Qualcomm QNN weight-sharing note, document revision shown in the public PDF and checked **2026-08-22**: persistent context binaries and weight-sharing/memory-limit configuration are separate from VTCM allocation.
- The report’s “8 MB” value is carried from the local Q25 proposal context; no public Qualcomm page found in this sweep states it as a whole-model capacity limit.

## 5. CPU ↔ HTP interop cost

### Finding

The public evidence supports a **sub-millisecond invocation order of magnitude**, but not a current S23/Xiaomi 14 measurement. An older Qualcomm Hexagon DSP User Guide gives an idealized FastRPC round-trip overhead of roughly **200–300 µs**, while warning that CPU/DSP clocks, scheduling, DSP work, cacheability, and buffer allocation change the result. It is useful as a lower-level reference, not as a 2026 retail-phone SLA.

The zero-copy path is real. Android’s [AOSP FastRPC `remote.h`](https://android.googlesource.com/platform/external/fastrpc/+/refs/heads/android13-d2-release/inc/remote.h) exposes ION/dma-buf-backed memory registration (`remote_register_buf` and DMA handles), coherent/non-coherent attributes, and persistent mappings. The Linux [FastRPC driver](https://github.com/torvalds/linux/blob/master/drivers/misc/fastrpc.c) likewise models shared `dma_buf` mappings. Current `ggml-hexagon` uses `rpcmem_alloc2`, file descriptors, FastRPC mapping and delayed/pinned shared buffers; this avoids copying every tensor between CPU and HTP, but it does not remove invocation, synchronization, cache, or graph-finalization costs.

Two consequences matter for the shortlist:

- Measure one **graph handover** (CPU-produced input → HTP prefill/encoder → CPU-consumed output), including setup and synchronization. Do not multiply an old 200–300 µs RPC estimate by the number of neural-network layers: current llama.cpp batches graph operations through its DSP queue.
- A one-shot tiny classifier can lose to CPU if it pays graph setup and synchronization. A prefill spike with enough arithmetic intensity can amortize that cost; an embedding call may or may not, depending on batch size and whether the QNN graph remains resident.

A 2026 Linux FastRPC discussion describes polling shared memory to avoid CPU wakeup/scheduling overhead, but does not provide a phone latency number. The desk research found no public v73/v75 per-call benchmark that includes a retail S23 or Xiaomi 14, so the shortlist must retain an empirical handover gate.

### Version/date/source notes

- Qualcomm Hexagon DSP User Guide, legacy SDK-era document: 200–300 µs is an idealized round-trip reference, not a current device measurement.
- AOSP Android 13 FastRPC header: shared-buffer/ION and DMA registration API; source snapshot is Android 13 branch.
- `ggml-hexagon` master checked 2026-08-22: `rpcmem`/FastRPC mappings and batched DSP queue.
- Linux FastRPC polling discussion posted in 2026: qualitative reduction of wakeup/scheduling overhead, no absolute latency.

## 6. Embeddings on HTP

### Finding

The strongest public sentence-embedding candidate is [Qualcomm AI Hub’s MiniLM-v2 card](https://aihub.qualcomm.com/models/minilm_v2): **all-MiniLM-L6-v2**, 22.7M parameters, 384-dimensional output, maximum 128 tokens, float size 86.7 MB. Qualcomm’s [model recipe](https://github.com/qualcomm/ai-hub-models/blob/main/src/qai_hub_models/models/minilm_v2/README.md) supports export to TFLite, ONNX and AI Engine Direct and documents w8a8 quantization.

Public QNN-backed AI Hub jobs show the graph can be executed on HTP:

| Job | Target / runtime | Input | Latency |
|---|---|---|---:|
| [MiniLM-v2 job `jprwx4jv5`](https://aihub.qualcomm.com/jobs/jprwx4jv5) | Samsung Galaxy S25 / Snapdragon 8 Elite for Galaxy; ONNX Runtime 1.27.1; QAIRT 2.45 | token IDs + mask, `[1,128]` | **0.839 ms**, NPU |
| [MiniLM-v2 job `jgllwevlg`](https://aihub.qualcomm.com/jobs/jgllwevlg) | SA8295P; LiteRT 1.4.5; QNN TFLite delegate; QAIRT 2.45 | `[1,128]` | **2.36 ms**, NPU |
| [MiniLM-v2 job `jpey64d05`](https://aihub.qualcomm.com/jobs/jpey64d05) | QCS8550 proxy; LiteRT/QNN; QAIRT 2.45 | `[1,128]` | **1.13 ms**, NPU |
| [MiniLM-v2 job `jpv721jzp`](https://aihub.qualcomm.com/jobs/jpv721jzp) | Snapdragon 7 Gen 4 QRD; QNN-backed profile | `[1,128]` | **1.69 ms**, NPU |

None of the located jobs is an S23/v73 or Xiaomi 14/v75 result. The model card also currently reports no active Mobile profile despite listing phone-class compatibility. Therefore MiniLM is a **strong candidate for the next QNN/HTP experiment**, not a measured Kalsa result. The 0.8–2.4 ms figures are an order-of-magnitude reference from newer/other targets, and the job pages do not establish that every profile used the same w8a8 precision; do not label them as v73/v75 quantized numbers.

The desk research found no additional public sentence-embedding job with a clean v73/v75 target and comparable latency. This is a narrower evidence gap than vision: the model exists and is small enough, but target-specific compilation and app access remain unverified.

## Final gate decision

| Shortlist gate | Desk-research refinement | Decision |
|---|---|---|
| v73 quant-load test | Upstream master explicitly builds v73 and claims Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4, not K-quants. Use a revision-pinned Q4_0 or IQ4_NL graph, then require scheduler evidence that the intended nodes are on HTP. Add an architecture check because LiteRT/QNN AOT tooling has a reported v73→v79 selection bug. | **GO, narrowed to S23/v73 and current `ggml-hexagon`; no-go for assuming Q4_K_M.** |
| HTP prefill measurement | Start with single-sequence Q4_0 `pp512` (the public llama.cpp reference is ~461 tok/s v73 / ~420 tok/s v75 on a 2B model), then test the real prompt shape. Repeat on Xiaomi/v75. Treat mllm-NPU’s >1,000 tok/s as a QNN/INT8 upper-bound reference, not an expected llama.cpp number. | **GO as the decisive performance gate; v73 and v75 must be measured separately.** |
| CPU ↔ HTP handover cost | Public legacy guidance is ~200–300 µs idealized FastRPC round trip; shared ION/dma-buf/rpcmem can avoid tensor copies, but setup, mapping, synchronization and graph residency are unmeasured on both retail phones. Measure end-to-end CPU→HTP→CPU with warm and cold graph cases. | **GO, but it remains an empirical blocker for tiny spikes/classifiers.** |

### Overall recommendation

**GO for a two-track prototype:** (A) current upstream `ggml-hexagon` Q4_0 prefill on v73/v75, and (B) a standalone MiniLM/ViT QNN or LiteRT-QNN graph. **NO-GO for shipping a generic “NPU expert” abstraction yet.** The backend’s supported quant set, graph-shape fallback, app/runtime packaging, and handover cost are too specific. Vision and embeddings should be treated as separate compiled graphs with explicit target/runtime manifests; they are not evidence that arbitrary MoE expert tensors or Q4_K_M can move to HTP.

## Source register

- `llama.cpp` Snapdragon backend README, current master checked 2026-08-22: [README](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/snapdragon/README.md); [developer guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/snapdragon/developer.md).
- `llama.cpp` current HTP implementation, master checked 2026-08-22: [`ggml-hexagon.cpp`](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/ggml/src/ggml-hexagon/ggml-hexagon.cpp); [CMake](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/ggml/src/ggml-hexagon/CMakeLists.txt); [matmul kernels](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/ggml/src/ggml-hexagon/htp/matmul-ops.c).
- `llama.cpp` issue [#26094](https://github.com/ggml-org/llama.cpp/issues/26094), 2026, v73/v75 Q4_0 benchmark and `nseq` fallback; issue [#24963](https://github.com/ggml-org/llama.cpp/issues/24963), 2026, v73 warning/4B graph behavior; discussion [#23314](https://github.com/ggml-org/llama.cpp/discussions/23314), 2026, Qwen3.5 4B HTP prompt benchmark; discussion [#21702](https://github.com/ggml-org/llama.cpp/discussions/21702), April 2026, HTP decode comparison and Q4_K limitation.
- X. Meng et al., [“Fast On-device LLM Inference with NPUs”](https://xumengwei.github.io/files/ASPLOS25-NPU.pdf), ASPLOS 2025 (March 30–April 3, 2025); paper summary [Hugging Face Papers](https://huggingface.co/papers/2407.05858).
- Qualcomm AI Hub model cards/jobs, pages checked 2026-08-22: [OpenAI CLIP](https://aihub.qualcomm.com/models/openai_clip), [OWL-ViT](https://aihub.qualcomm.com/mobile/models/owl_vit), [ViT](https://aihub.qualcomm.com/models/vit), [MobileViT](https://aihub.qualcomm.com/compute/models/mobile_vit), [VideoMAE](https://aihub.qualcomm.com/models/video_mae), [MiniLM-v2](https://aihub.qualcomm.com/models/minilm_v2), [Qwen3-1.7B](https://aihub.qualcomm.com/compute/models/qwen3_1_7b), [AI Hub job index](https://aihub.qualcomm.com/jobs).
- Qualcomm AI Hub/QNN [runtime-option documentation](https://workbench.aihub.qualcomm.com/docs/hub/api.html), checked 2026-08-22, for VTCM reserve/use and graph precision; Qualcomm [QNN weight-sharing note](https://docs.qualcomm.com/doc/KBA-250306025001/KBA-250306025001_REV_1_QNN_Weight_Sharing_Feature.pdf), checked 2026-08-22, for persistent context and memory-limit configuration.
- Google AI Edge [LiteRT Qualcomm HTP instructions](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/doc/HTP_INSTRUCTIONS.md) and [Qualcomm integration README](https://github.com/google-ai-edge/LiteRT/blob/main/litert/vendors/qualcomm/README.md), current pages checked 2026-08-22; LiteRT issue [#8037](https://github.com/google-ai-edge/LiteRT/issues/8037), June 2026, reported SM8550/v79 AOT selection issue.
- Android [NNAPI migration guide](https://developer.android.com/ndk/guides/neuralnetworks/migration-guide), last updated March 6, 2026; AOSP [FastRPC remote API](https://android.googlesource.com/platform/external/fastrpc/+/refs/heads/android13-d2-release/inc/remote.h); Linux [FastRPC driver](https://github.com/torvalds/linux/blob/master/drivers/misc/fastrpc.c).
- Qualcomm, *Hexagon DSP User Guide* (legacy SDK-era PDF; public mirror [PDF](https://usermanual.wiki/Document/80VB419108HexagonDSPUserGuide.845180635.pdf)), idealized 200–300 µs FastRPC round-trip reference; not a v73/v75 retail-phone measurement.
