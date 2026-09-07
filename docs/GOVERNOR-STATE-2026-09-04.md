# Kalsa governor state — 2026-09-04

Scope: read-only consolidation of the named app, measurement, and fork sources. Status labels are **MEASURED** (run number), **DECIDED** (owner call), **IMPLEMENTED** (code on disk), and **OPEN**.

Source exceptions: `/Users/marco/Projects/kalsa/src/services/LlamaService.ts` does not exist; the read source is `src/engine/LlamaService.ts`. `/Users/marco/Projects/kalsallama-wt-governor/docs/KALSA_FORK.md` does not exist; the read source is fork-root `KALSA_FORK.md`. The requested QDC reports are under `kalsa-moe-experiments/scratchpad/agents/`; no source was silently substituted.

## 1. Owner decisions

- [DECIDED] 2026-08-22: Android floor is 13+: “**Android 13+ (`minSdk 33`)**”; the Android-15 floor excluded Jelly Star. — `kalsa/docs/KALSA.md:622-624` “Android 13+ (`minSdk 33)`”
- [DECIDED] 2026-08-18: reasoning remains enabled: “**Thinking is never off and never budget 0**.” — `kalsa/docs/KALSA.md:624` “Thinking is never off”
- [DECIDED] 2026-08-18: “**Cache beats context budget**” when they conflict. — `kalsa/docs/KALSA.md:625` “Cache beats context budget”
- [DECIDED] 2026-08-23: KEXP’s speed diagnosis changed to eviction, but its quality failure keeps it off shipping tiers: “**The held experiment RESOLVED**” and “quality gate ... sufficient to keep it off”. — `kalsa/docs/KALSA.md:628` “collapse was EVICTION”
- [DECIDED] 2026-08-21: the speed floor is generation-specific: “**20 tok/s is per phone generation, not absolute**”; Jelly is testbed, not target. — `kalsa/docs/KALSA.md:635` “per phone generation”
- [DECIDED] 2026-08-22: G57 is parked: “**OWNER DECISION 22/08: PARKED on G57-class**”; reopen with G610/G615 hardware. — `kalsa-moe-experiments/docs/ALIVE.md:405` “PARKED on G57-class”
- [DECIDED] 2026-08-24: F6 is owner-confirmed for the large v73 lane: “**experts-on-NPU = v75-class-only**”; later evidence narrows, rather than erases, this to a small partial-offload v73 exception. — `kalsa-moe-experiments/docs/ALIVE.md:408` “v75-class-only”
- [DECIDED] 2026-08-14: do not reopen upstream issue work: “**Non aprire nessuna issue upstream**.” — `kalsa-moe-experiments/PLAN.md:242-251` “Non aprire nessuna issue upstream”

## 2. MEASURED evidence by axis

### GPU
- [MEASURED 7/09 — READ THIS BEFORE ANY OTHER GPU LINE] Every GPU prefill ratio below was measured with a kernel that
  computes the wrong numbers. On Adreno the batched Q4_0 GEMM does the multiply in half, and against a CPU reference the
  shipped 2.6B diverges with median KL-divergence 0.453822 / same-top 62.823%. Making the product float
  (`convert_float8(B) * (float)w` in `gemm_noshuffle_q4_0_f32.cl`) gives 0.004736 / 94.826%. The accumulator, the
  compiler math flags, the attention path and the dequantisation are all refuted by measurement, and so is the
  WebGPU/Vulkan analogy that makes f32 accumulation the obvious fix. — `docs/ALIVE.md` rows 56-57,
  `scratchpad/agents/adreno-acc-type/REPORT.md`
- [MEASURED 7/09 — cooled, randomised] The corrected kernel runs prefill at 0.659x (190.25 vs 288.62 t/s), agreeing
  within 1% with two earlier estimates. Its own pre-registered validity reading fails on a 5.71 C spread in start
  temperature, so the figure is not formally banked; the cause is our harness, which cools between bench steps but not
  before the first. Keeping the activations in f32 as well costs 0.509x and buys no fidelity. — `docs/ALIVE.md` row 59
- [INDICATIVE, NOT MEASURED CLEAN] Correctness costs about 0.65x of prefill (pp512 189.73 vs the 289.98 reference),
  taken on a heating board; the cooled randomised measurement is owed. If it holds, the in-app GPU prefill advantage on
  750/735/732 (1.78x/1.72x/1.63x) drops to roughly 1.16x/1.13x/1.07x — near parity, which turns the GPU on those tiers
  from a speed lever into a thermal-and-CPU-offload lever. On 830/V79 the margin is large enough to survive it, but GPU
  prefill fidelity has never been measured there. — `PLAN.md` "Conseguenza per il governor, da verificare"

- [MEASURED] Adreno 740/S23: for the scoped KEXP/OLMoE table, CPU wins raw speed (KEXP 17.55 vs full GPU 14.25 tok/s; hybrid 7.90); full GPU is a cool mode (−2.75 °C on KEXP), not the speed default. — `kalsa-moe-experiments/docs/ALIVE.md:84-115` “pure CPU beats full GPU”
- [MEASURED] Adreno 740 dense phase behavior: GPU decode is 0.41× CPU; GPU prefill is only about 1.1×. — `kalsa-moe-experiments/docs/ALIVE.md:140-148` “GPU decode always loses (0.41×)”
- [MEASURED] Adreno 750/SM8650: ship 2.6B GPU is pp512 284.2–291.1 and tg128 23.0–23.4 versus CPU 16.3/11.6; the current CPU-tuned comparison puts GPU decode at 0.80–0.86× CPU and confirms 2.87× GPU prefill. — `kalsa-moe-experiments/docs/ALIVE.md:435-438` “GPU ... pp512 284.2” / “decode = CPU”
- [MEASURED] Adreno 750 correctness is not uniform: `MUL_MAT_ID` is 407/407, but 20 deterministic f16/bf16-batched failures recur on the 750 stack. — `kalsa-moe-experiments/docs/ALIVE.md:435-438` “MUL_MAT_ID 407/407” / “20 FAIL”
- [MEASURED] Adreno 830/KEXP: GPU prefill 274.5 vs CPU 107.4 tok/s (2.56×); CPU decode 60.7 vs GPU 48.9 (1.24×). — `scratchpad/agents/qdc-8elite-speed-kexp/REPORT.md:47-58` “GPU for prefill ... CPU for decode”
- [MEASURED] Adreno 830/8B governor cell: G routes GPU prefill/CPU decode, with TTFT ~2.496 s and decode 13.32–13.33; commit is 0.83–0.89% of prefill. — `scratchpad/agents/qdc-8elite-governor-8b/REPORT.md:35-48` “GPUOpenCL prefill / CPU decode”
- [MEASURED] Adreno 830/8B: G passes the split rule, but all-GPU A is the best single arm (decode 28.2–28.4 vs G/C 13.3–13.9); routing must be model-specific. — `scratchpad/agents/qdc-8elite-governor-8b/REPORT.md:76-105` “A is the best single arm”
- [MEASURED] Adreno 830/VL-3B: vision encode CPU, text prefill GPU 4.0×, decode CPU 1.28×; hypothetical phase composition is 1.13× faster than the best static arm. — `scratchpad/agents/qdc-8elite-vl3b/REPORT.md:54-75` “vision encode → CPU; prefill → GPU ... decode → CPU”
- [MEASURED] Adreno 830/VL vision GPU loses because unsupported CLIP/OpenCL ops split the graph: GPU encode is 1.67× slower than CPU. — `scratchpad/agents/qdc-8elite-vl3b/REPORT.md:77-94` “GPU encode 1.67× slower”
- [MEASURED] Mali G57: f32 OpenCL `MUL_MAT` is 202/202 and q8_0 MoE `MUL_MAT_ID` is 75/75, but generic GPU is slower than CPU in all 20 green cases (maximum 0.962×); Q4 product kernels remain untuned. — `kalsa-moe-experiments/docs/ALIVE.md:405` “GPU < CPU on all 20 green cases”

### NPU / Hexagon
- [MEASURED 7/09 — decode] On the SHIPPED 2.6B, Hexagon v75, `tg128 @ d1920`: CPU 17.68, NPU with `-nkvo` 15.08, NPU
  with the KV on the DSP 13.37. Moving the KV onto the DSP makes decode WORSE, because the flash attention moves with
  it (`FLASH_ATTN` 3168 times in that arm's log, zero in the other). The mapping ceiling the device reports is
  3489660928 B = 3328 MiB, so on the shipped model the KV fits - it simply does not help. Decode stays on the CPU, and
  this is now measured on what we ship rather than inferred from OLMoE. Energy per token remains unmeasured by anyone.
  — `docs/ALIVE.md` row 58, `scratchpad/agents/npu-decode-kv/REPORT.md`

- [MEASURED] v73 dense/hybrid prefill is about 3.5× CPU, but the full experts lane dies under DSP queue pressure; no certified v73 correctness lane exists. — `kalsa-moe-experiments/docs/ALIVE.md:406-408` “3.5×” / “v73 ... UNCERTIFIED”
- [MEASURED] v73 partial experts offload survives both prefill and decode: `ngl8`/`ngl12` complete, including 128 decode tokens; full `ngl99` dies at `main.c:729` after VA allocation failure. — `scratchpad/agents/qdc-8g2-npu-mmapbudget-60/REPORT.md:16-27` “ngl 8 ... VIVE” / “mmap failed : va”
- [MEASURED] v73 death is not a simple 2 GiB cap: 2.48 GiB survives, while map/unmap churn can fail around a later 0.46–0.70 GiB mapping; vmem/mbuf knobs do not save this build. — `scratchpad/agents/qdc-8g2-npu-mmapbudget-60/REPORT.md:31-66` “VA allocation failure” / “knobs do not fix it”
- [MEASURED] Upstream master on the same v73 reference board dies even at `ngl8`, but in compute (`TLBMISS RW`, `op_binary`), so that run is method-void for the mapping-fix question. — `scratchpad/agents/qdc-8g2-npu-upstream-62/REPORT.md:11-27` “METHOD-VOID” / “TLBMISS RW”
- [MEASURED] v75 dense prefill is 3.19× CPU; experts-on-NPU is 4.82× (686 tok/s); NPU decode is 0.63×, so v75’s useful role is prefill. — `kalsa-moe-experiments/docs/ALIVE.md:406-408` “experts ... 4.82×” / “tg 0.63×”
- [MEASURED] v79/QAD exploratory cell: NPU prefill 1512.2 vs CPU 211.1 tok/s (7.2×); CPU decode 38.49 vs NPU 23.47 (1.64×). — `scratchpad/agents/qdc-8elite-npu-v79/REPORT.md:75-100` “NPU prefill = 7.2× CPU”
- [MEASURED] v79 correctness is not shipped: HTP `MUL_MAT_ID` is 0/301, and 36 INTERNAL-ERRORs remain after the judge defect was characterized. — `scratchpad/agents/qdc-8elite-npu-v79/REPORT.md:34-73` “0/301 passed” / “36 ... INTERNAL-ERROR”

### CPU, repack, mmap, eviction

- [MEASURED] On Jelly, seven-model loading puts the ceiling between 3.33 GB KEXP (loads) and 4.1 GB Gemma (lmkd); mmap-off makes weights anonymous and unreclaimable. — `kalsa/docs/HARNESS_FINDINGS.md:1641-1669` “Two of seven never load” / “weights are anonymous”
- [MEASURED] The shipped estimator was wrong in four ways: mmap assumption, 0.895 repack fraction versus measured 1.00×, unconditional 641 MiB mmproj, and missing KV/n_ctx terms. — `kalsa/docs/HARNESS_FINDINGS.md:1671-1679` “Four independent errors”
- [MEASURED] S23 mmap KEXP collapses 11.1→0.4 tok/s with 534,715 major faults; no-mmap is 6.6× faster over the plan; Jelly is 1.006×, because Jelly does not evict. — `kalsa/docs/HARNESS_FINDINGS.md:1873-1903` “6.6x faster” / “1.006x — nothing”
- [MEASURED] The two mechanisms are distinct: context-growth decay is −11% to −48%; S23 KEXP eviction collapse is −96%. — `kalsa/docs/HARNESS_FINDINGS.md:1933-1944` “SECOND mechanism” / “−96 %”
- [MEASURED] The corrected estimator reproduces two phone points within −1.4% and +1.3%, but six models still have KV estimated as zero and no rebuilt APK validation exists. — `kalsa/docs/HARNESS_FINDINGS.md:1702-1709` “reproduces the measurements” / “none ... run on a phone”

### Thermal and battery

- [MEASURED] GPU cool-mode is real on KEXP: full GPU is −19% speed but −2.75 °C peak; OLMoE is near thermal parity. — `kalsa-moe-experiments/docs/ALIVE.md:84-105` “−2.75°C” / “near-parity”
- [MEASURED] The S23 control thermal loop goes 30.8→41.5 °C and status 0→3 in four turns; the treatment stays status 0 and around 35.7 °C through six turns. — `kalsa/docs/HARNESS_FINDINGS.md:4916-4938` “heats itself out” / “without ever leaving ... 0”
- [MEASURED] Sustained 4B inference burns about 30% battery/hour; the KEXP S23 plan measured 338 mAh no-mmap versus 904 mAh mmap. — `kalsa/docs/HARNESS_FINDINGS.md:1631-1639` “~30 %/h”; `kalsa/docs/KALSA.md:628` “338 mAh instead of 904”
- [MEASURED] The only matched-work NPU energy datum is Marco-B′ at 0.86× J/token, single replica; confirmation is open. — `kalsa-moe-experiments/docs/ALIVE.md:407` “first matched-work energy J/token 0.86×”
- [OPEN] No QDC governor cell establishes production battery/energy or sustained thermal behavior; the v79 report explicitly says CPU arms exceeded 60 °C during execution despite pre-gates passing. — `kalsa-moe-experiments/scratchpad/agents/qdc-8elite-governor-crossbackend/REPORT.md:60-69` “no ... battery”; `kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79/REPORT.md:75-84` “above the 60.0 gate threshold DURING execution”

## 3. IMPLEMENTED in the app today

- [IMPLEMENTED] Backend policy is static: Android returns `{kind: "cpu-only", reason: "gpu-fit-gate-blind"}`; comments explicitly call the intended design a future per-phase governor. — `kalsa/src/engine/deviceTuning.ts:335-374` “Android → cpu-only”
- [IMPLEMENTED] The layer mapper can request 99 layers for `gpu-metal` or `gpu-opencl`, otherwise 0. — `kalsa/src/engine/deviceTuning.ts:763-787` “gpu-opencl ... return GPU_OFFLOAD_LAYERS”
- [IMPLEMENTED] The RAM gate prices CPU resident/repack memory and has no backend/GPU-driver term; its statuses are does-not-fit/tight/fits/unknown. — `kalsa/src/engine/memoryEstimate.ts:180-247` “non-evictable ... available”
- [IMPLEMENTED] Load policy precedence is streaming > bench > per-model > default; normal default is mmap=true/repack=true. — `kalsa/src/engine/loadPolicy.ts:1-21;60-77` “streaming > ... per-model > default”
- [IMPLEMENTED] Android GPU init failure retries once with `n_gpu_layers=0` and emits `KALSA_GPU_FALLBACK`; this cannot catch lmkd SIGKILL. — `kalsa/src/engine/LlamaService.ts:1429-1457` “Fall back to CPU once”
- [IMPLEMENTED] Android vision deliberately uses CPU (`use_gpu: Platform.OS === "ios"`); GPU vision is benchmark-only. — `kalsa/src/engine/LlamaService.ts:1496-1515` “use_gpu MUST stay false on Android”
- [IMPLEMENTED] Thermal hook polls `thermal_zone0` every 30 seconds, falls back to MemAvailable, and is UI-only: “Never unloads the model”. — `kalsa/src/hooks/useThermalMonitor.ts:1-5;57-69;111-132` “UI banner only”
- [IMPLEMENTED] CI/source plugin defaults to compiling llama.rn `cpp/`; explicit `KALSA_LLAMA_FROM_SOURCE=0` selects prebuilt JNI. Backend flag identity is not stated in this plugin: it only says “compile cpp/”. — `kalsa/plugins/withLlamaFromSource.js:1-20;43-55` “compile cpp/”
- [IMPLEMENTED] The app’s pinned native source is Aspis0/kalsallama main at `a0cabca6b...`. — `kalsa/native/kalsallama.pin:1-5` “commit ... a0cabca6b”
- [OPEN] Contradiction: `engineParams.ts` says production keeps “GPU offload on Android”, while `deviceTuning.ts` returns CPU-only and `LlamaService.ts` maps CPU-only to zero layers. — `kalsa/src/engine/engineParams.ts:100-113` “GPU offload on Android”; `kalsa/src/engine/LlamaService.ts:1275-1276` “cpu-only→0”
- [OPEN] The app has no on-disk phase router for prefill/decode/vision, no NPU host binding, and no production GPU fit measurement; the current hook cannot supply those decisions. — `kalsa/src/engine/deviceTuning.ts:339-341` “per-phase governor”; `kalsa/src/hooks/useThermalMonitor.ts:1-5` “UI banner only”

## 4. IMPLEMENTED in fork governor v0/v0.2

- [IMPLEMENTED] The fork contract owns two independent contexts: `n_tokens>1` is prefill, `n_tokens==1` decode, sequence 0 only; route/decode/commit failures are sticky and never silently collapse to one context. — `kalsallama-wt-governor/src/llama-ext.h:321-325` “two independent contexts”
- [IMPLEMENTED] Host inputs include generation/model kind, GPU/NPU fit, HTP trunk/experts readability, measured GPU prefill, cool eligibility/delta/scope, reload budget, cache budget, battery/temp/plugged state, idle temperature, and trend. — `kalsallama-wt-governor/src/llama-ext.h:198-230` “Inputs owned by the app/device layer”
- [IMPLEMENTED] v0.2 deliberately defers NPU selection; engines enumerate CPU/GPU/NPU/GPU_COOLMODE, with NPU marked deferred. — `kalsallama-wt-governor/src/llama-ext.h:146-159` “NPU ... Deferred”
- [IMPLEMENTED] Policy thresholds are unplugged warm 38 °C, cool 39.5 °C, critical 42 °C, kill 43 °C; it also applies a 25% low-battery floor, plugged idle validation, hysteresis, dwell, and a one-hour GPU flip budget. — `kalsallama-wt-governor/src/llama-governor-policy.cpp:8-15;42-63;116-145;214-239` “k_kill_c = 43.0f” / “k_flip_window_ms”
- [IMPLEMENTED] Current router selects v75 GPU prefill only when fit and measured; v73 GPU cool prefill is restricted to eligible MoE/non-hot-plugged cases; decode is GPU cool-mode only for v73 with fit, measured cool delta, scope, budget, and reload permission. — `kalsallama-wt-governor/src/llama-governor-policy.cpp:152-166;214-240` “GPU_COOLMODE”
- [IMPLEMENTED] Oversize prefill is chunked to 128/512/1024/2048 rows; unsupported accelerator requests CPU-fallback; invalid/critical admission aborts. — `kalsallama-wt-governor/src/llama-governor-policy.cpp:178-211` “CPUFallback” / “Chunk”
- [IMPLEMENTED] KV commit is range-based with naive/staged modes; `llama-kv-commit.h` supplies the commit API. — `kalsallama-wt-governor/src/llama-kv-commit.h:7-20` “contiguous KV range”
- [IMPLEMENTED] The governor bench accepts `--arm A|C|G`, runs 3 turns of 512 prompt + 128 generated tokens, and records TTFT/decode/prefill plus governor commit stats. — `kalsallama-wt-governor/tools/governor-bench/governor-bench.h:14-35` “3 turns” / “commit_bytes”; `governor-bench.cpp:19-20;80-92`
- [MEASURED] Fork cells establish 830 KEXP GPU-prefill/CPU-decode 2.56×/1.24× and 8B G rule pass with 0.83–0.89% commit, but 8B all-GPU is the best single arm. — `scratchpad/agents/qdc-8elite-speed-kexp/REPORT.md:49-58`; `scratchpad/agents/qdc-8elite-governor-8b/REPORT.md:84-105`
- [MEASURED] v0.2 router tests pass both golden and metrics suites and cover schema fallback, thermal exits, low battery, invalid sensors, chunking, flip budget, metrics, and wrappers. — `kalsallama-wt-governor/tests/test-governor-v02-router.cpp:30-93;171-208;242-276` “router_v02_golden=PASS”
- [OPEN] Hosting is not done: Android still resolves CPU-only, while the fork contract requires two contexts plus a host-owned capability/thermal profile. — `kalsa/src/engine/LlamaService.ts:1275-1276`; `kalsallama-wt-governor/src/llama-ext.h:321-325` “two independent contexts”
- [OPEN] The fork’s v0.2 commit gate is not trustworthy for short hybrid prefills because recurrent-state copying is ~52.7 MB and 99.65% of Qwen35 commit bytes until dirty-range commit exists. — `kalsallama-wt-governor/src/llama-ext.h:261-270` “not trustworthy for short prefills”

## 5. Closed roads — do not reopen

- [DECIDED] Universal GPU-default claims are closed: pure CPU wins scoped 740 KEXP/OLMoE, and “GPU default candidate” is retired. — `kalsa-moe-experiments/docs/ALIVE.md:96-107` “GPU default candidate is retired”
- [DECIDED] Half-offload is closed as a routing choice: it is “NEVER right” because of ping-pong; choose full GPU only for an evidenced cool-mode/fit case. — `kalsa-moe-experiments/docs/ALIVE.md:140-145` “Half-offload is NEVER right”
- [DECIDED] Vulkan on A740 K-quants is closed: it dies and has no estimable ratio. — `kalsa-moe-experiments/docs/ALIVE.md:394-396` “Vulkan runs no K-quants”
- [DECIDED] Generic Mali G57 product acceleration is parked, not a target; reopen only with G610/G615 hardware or an explicit owner call. — `kalsa-moe-experiments/docs/ALIVE.md:405` “Reopen when a G610/G615 ... is in hand”
- [DECIDED] Full/large v73 experts-on-NPU is closed for product routing; only the measured small partial-offload exception remains an open speed question. — `scratchpad/agents/qdc-8g2-npu-mmapbudget-60/REPORT.md:80-84` “≤ ~2.5 GiB, no eviction churn”
- [DECIDED] Upstream issue filing is closed for this effort by owner instruction. — `kalsa-moe-experiments/PLAN.md:247-251` “Non aprire nessuna issue upstream”

## 6. OPEN gaps, ranked by distance to goal

1. [OPEN] Host the two-context governor in llama.rn/LlamaService, expose per-phase context routing, KV commit, reload, and sticky-failure handling. — `kalsallama-wt-governor/src/llama-ext.h:321-325` “two independent contexts”; `kalsa/src/engine/LlamaService.ts:1275-1276` “cpu-only→0”
2. [OPEN] Add a real host capability probe and fit model for GPU driver memory, NPU anonymous materialization, and model/SoC/phase outcomes; current RAM gate cannot see GPU allocations. — `kalsa/docs/HARNESS_FINDINGS.md:4023-4030` “RAM fit gate is blind”
3. [OPEN] Integrate live thermal/battery/plugged/idle/trend inputs into routing and test mid-turn watchdog behavior; the current app monitor is advisory only. — `kalsa/src/hooks/useThermalMonitor.ts:1-5` “Never unloads”; `kalsallama-wt-governor/src/llama-ext.h:221-230` “successful battery poll”
4. [OPEN] Certify NPU correctness and safe load envelopes: v79 has unresolved numeric/error cells; v73 needs a stable partial/full policy split and no-churn proof. — `scratchpad/agents/qdc-8elite-npu-v79/REPORT.md:34-73` “correctness is NOT proven”; `scratchpad/agents/qdc-8g2-npu-mmapbudget-60/REPORT.md:80-92`
5. [OPEN] Build the Mali G57 tuned Q4 path and rerun the governor matrix; f32/q8_0 proof is not product Q4 performance. — `kalsa-moe-experiments/docs/ALIVE.md:405` “Mali-tuned kernels”
6. [OPEN] Expand per-device/per-model tables, including 740/750/830, VL vision, prompt lengths, and multi-turn interleaving; the 8B cell explicitly cannot transfer to 740/750 or quality. — `scratchpad/agents/qdc-8elite-governor-8b/REPORT.md:111-117` “Nothing about ... 740/750”
7. [OPEN] Establish production battery/energy and sustained thermal deltas after integration; current NPU energy is one replica and QDC gates are pre-run. — `kalsa-moe-experiments/docs/ALIVE.md:407` “single replica”; `scratchpad/agents/qdc-8elite-npu-v79/REPORT.md:79-84`

## 7. Traps

- [MEASURED] lmkd SIGKILL is not catchable by the app’s exception fallback; GPU offload can leave ~150 MiB in `/proc` while consuming 3.4 GB system memory. — `kalsa/docs/HARNESS_FINDINGS.md:4004-4030` “lmkd killed the app” / “driver/CL allocations”; `kalsa/src/engine/deviceTuning.ts:366-369` “lmkd is not an exception”
- [MEASURED] MemAvailable is contaminated by the model’s own mmapped page cache; MemFree is the reported pressure distinction, and the app’s thermal fallback still uses MemAvailable. — `kalsa/docs/HARNESS_FINDINGS.md:2171-2176`; `kalsa/src/hooks/useThermalMonitor.ts:111-132`
- [MEASURED] `use_mmap=false` is not universally faster: it is 6.6× on the evicting S23 and 1.006× on Jelly; global use makes other models less reclaimable. — `kalsa/docs/HARNESS_FINDINGS.md:1664-1669;1880-1903`
- [MEASURED] Per-turn tok/s is length-dependent; the project retires the old “bimodal” interpretation, and turn-1 versus turn-16 can choose opposite winners. — `kalsa/docs/HARNESS_FINDINGS.md:1946-1964;2000-2009`
- [MEASURED] `promptMs` can be a timer artifact: APK smoke reports ~411 s for 15 generated tokens and says it is not usable prompt performance. — `scratchpad/agents/qdc-apk-smoke-63/REPORT.md:91-96` “known timer artifact”
- [MEASURED] v79’s finite-HTP/NaN-CPU pattern is a poisoned judge, while 36 INTERNAL-ERRORs are a separate host/DSP error-swallowing class; do not call finite outputs correctness. — `scratchpad/agents/qdc-8elite-npu-v79/REPORT.md:41-73` “correctness is NOT proven”; `kalsa-moe-experiments/docs/ALIVE.md:406` “LOGS-AND-IGNORES it”
- [MEASURED] Pre-run thermal gates do not constrain the run: v79 CPU execution reached 61.5/63.0 °C after all pre-gates passed. — `scratchpad/agents/qdc-8elite-npu-v79/REPORT.md:77-84` “gate is pre-invocation”
- [IMPLEMENTED] Silent backend fallback is a measurement poison; the governor bench therefore fail-fasts A/G when no non-CPU accelerator resolves. — `kalsallama-wt-governor/tools/governor-bench.cpp:62-68;107-114` “fail-fast”
