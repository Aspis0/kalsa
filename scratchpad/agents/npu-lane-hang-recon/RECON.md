# NPU lane hang reconstruction

## Q1. Fit accounting

**Trace.** The incident line is emitted by `LlamaService.initEngine` from `buildGovernorPlanLog`; that function prices both fields by calling `lanePrice` with `repack=true/false` ([app `src/engine/LlamaService.ts:2434-2451`](/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2434)). The corresponding source says:

> `required_mib_with_repack: roundMiB(withRepack?.requiredMiB ?? 0),` ([app `src/engine/governorInputs.ts:231`](/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:231))

> `required_mib_without_repack: roundMiB(withoutRepack?.requiredMiB ?? 0),` ([app `src/engine/governorInputs.ts:232`](/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:232))

For the lane the formula is `800 + 1.05×offloadedBytes + 2×computeMiB + 2×kvMiB`, plus `weightsMiB` when repack is on. The app test records the incident-shaped arithmetic explicitly:

> `800 + 1.05·W + 2×compute@256 + 2×KV = 2998.06 MiB for LFM 2.6B at` ([app `src/engine/governorInputs.test.ts:221`](/Users/marco/Projects/kalsa/src/engine/governorInputs.test.ts:221))

> `ctx 8192. Pricing the repack copy back in at 1.0×W (4518.12 MiB)` ([app `src/engine/governorInputs.test.ts:222`](/Users/marco/Projects/kalsa/src/engine/governorInputs.test.ts:222))

The “2×” occurs because `estimateMemory.nonEvictableMiB` already contains compute + KV, and `lanePrice` adds `priced.computeMiB + priced.kvMiB` again. That is a deliberate conservative double charge in this estimator, not two independent actual allocations per context.

The lane decision adds another 219 MiB (`NPU_PREFILL_EXTRA_MIB`) when comparing to available RAM, but `buildGovernorPlanLog` calls `lanePrice` without that extra. Therefore **the printed requirements are 219 MiB below the lane's actual fit threshold**. This omission is in the diagnostics; the `gpu_fit` decision does apply it. The source labels it:

> `The HTP prefill copy costs +219 MiB over the OpenCL one` ([app `src/engine/governorInputs.ts:20-24`](/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:20))

At 8,192 context, the incident numbers mean the base/repack-free printed requirement is 2,998.06 MiB; the fit comparison is about 3,217.06 MiB with the HTP delta; repack-on adds 1,520.06 MiB, producing the printed 4,518.12 MiB. The 1,520.06 MiB is the GGUF file size (1,593,894,944 bytes), and the 1.05× weight term is about 1,596 MiB ([app `src/engine/ModelRegistry.ts:272-293`](/Users/marco/Projects/kalsa/src/engine/ModelRegistry.ts:272)).

**Runtime allocations and fit coverage (lane on, shipped 8,192 context):**

| Allocation | Runtime shape | Fit coverage |
|---|---|---|
| CPU decode weights | Decode model opens/maps the GGUF. With `mmap=true`, this is file-backed and the two model mappings can share page-cache pages. | No separate `+W` term for mapped CPU weights in the formula. `800 MiB` is a fixed reserve, not an explicit mapped-weight measurement. `MemAvailable` is intended to account for reclaimable file cache. |
| HTP prefill weights | HTP backend allocates RPCMEM-backed buffers and copies tensor data into them; it is a real device-visible copy, not just a map of the GGUF. Nearly all layers are assigned to the prefill device (`n_gpu_layers=99`). LFM's tensor-map weight payload is 1,585,647,616 bytes = about 1,512 MiB; buffer guard/alignment and any non-weight tensors change the final total. | Indirectly covered by `1.05×offloadedBytes` (about 1,596 MiB), an estimate, not a runtime buffer-size query. HTP adds another 219 MiB in the fit decision for its measured prefill footprint; this is omitted from the logged `required_mib_*` values. |
| CPU `CPU_REPACK` weights | Only the decode model has CPU-placed weights that acquire CPU repack traits. At the logged available RAM the chosen no-repack configuration disables that copy. Repack-on would add about 1×W (1,520 MiB). | Yes, the `with_repack` printed field adds 1×W; the no-repack field and selected config do not. |
| KV caches | Two independent contexts/caches: prefill HTP-resident (rpcmem when device KV is selected), decode CPU-resident; same effective cache types so KV commit can copy rows. | Yes, estimated KV is counted twice (conservatively, due to the duplicated formula term). |
| Compute buffers | Two contexts reserve compute buffers. Native logging observed `HTP0 compute buffer 129 MiB`; CPU decode has its own buffer. | Yes, estimated compute is counted twice. The per-backend actual sizes can differ from the estimator's common estimate. |
| mlock request | Model mmap attempts include a 223,281,152-byte region (about 212.9 MiB); the incident says this request failed twice. | No explicit mlock term. Failed `mlock` does not mean the mapping was not created; it means pages were not successfully pinned. |
| HTP session/fence/runtime buffers | HTP session owns queue/fence and runtime allocations in addition to model weights and compute. | No itemized term; only the generic 800 MiB reserve and fit headroom can cover some of this. |

The binding source confirms both the HTP copy and repack distinction:

> `auto sbuf = new ggml_hexagon_shared_buffer(sess, size, false);` ([pinned binding vendor `ggml-hexagon.cpp:2328`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:2328))

> `memcpy((char *) tensor->data + offset, data, size);` ([pinned binding vendor `ggml-hexagon.cpp:2019`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:2019))

> `if (!load_options.decode_repack) {` ([binding `cpp/rn-llama.cpp:237-238`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:237))

> `decode_params.no_extra_bufts = true;` ([binding `cpp/rn-llama.cpp:238`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:238))

**Available memory timing.** The plan uses `deviceProfile.availableMemoryBytes` ([app `src/engine/LlamaService.ts:2439-2445`](/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2439)); this is the cached device profile, not the monitor's uncached sample. The plan is logged before `disposeEngineLocked()`:

> `await disposeEngineLocked();` ([app `src/engine/LlamaService.ts:2463`](/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2463))

So the value is sampled/cached before the old context is released. It can reflect the previous model's memory pressure; it is not a fresh post-release budget. The loaded model's HTP copy is expected to cost about 1,512 MiB of tensor payload, with the estimator pricing 1,596 MiB. The fit has no explicit mlock charge (212.9 MiB requested) and the 219 MiB HTP delta is present in the fit but absent from the printed requirement. **Accounting gap:** at least 212.9 MiB of unitemized pinning pressure; against the estimator's roughly 84 MiB weight-price cushion, that is about 129 MiB net before extra HTP/session overhead or memory left resident from earlier switches. Exact peak undercount cannot be recovered from the incident log alone.

## Q2. Watchdogs and cancellation

- **Engine liveness:** the 8 s contact probe (`ENGINE_CONTACT_PROBE_TIMEOUT_MS`) is a send-path ping, not a timer attached to `loadPrompt`. A probe timeout can mark the engine lost, but does not cancel the native call. RSS is telemetry only. ([app `src/engine/engineLiveness.ts:17-28, 68-82`](/Users/marco/Projects/kalsa/src/engine/engineLiveness.ts:17))
- **Stall watchdog:** `export const GENERATION_STALL_GAP_MS = 45_000;` ([app `src/engine/stallWatchdog.ts:15`](/Users/marco/Projects/kalsa/src/engine/stallWatchdog.ts:15)). It checks every 2 s and starts only after a generated token: `startStallWatchdog();` ([app `src/engine/LlamaService.ts:5142`](/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:5142)). It cannot see a prefill that has not yielded one.
- **Prefill deadline:** 180 s minimum, size/rate-derived. The ordinary path arms it only *after* `await trackCompletion(engine.completion(...))` settles (`LlamaService.ts:5095-5162`); native `completion` itself runs `loadPrompt`, so it is not armed during the initial hung prefill. The incident report says the prefill watchdog did not fire, consistent with this ordering. Thermal retry arms before retry, but that is a different path. Source lines: `export const MIN_PREFILL_DEADLINE_MS = 180_000;` ([app `src/engine/prefillDeadline.ts:2`](/Users/marco/Projects/kalsa/src/engine/prefillDeadline.ts:2)); `armPrefillDeadline();` ([app `src/engine/LlamaService.ts:5162`](/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:5162)).
- **Admission:** the app has pre-load RAM/load gates, but no wall-clock admission timeout around governor load or `loadPrompt`. Engine governor admission is evaluated at the start of `llama_decode` and per planned chunk; it is a policy gate, not a timer. A blocked `llama_decode`/allocation never reaches the next admission check. ([engine `src/llama-governor-runtime.cpp:72-95,129-169`](/Users/marco/Projects/kalsallama/src/llama-governor-runtime.cpp:72))
- **Thermal:** app refreshes platform thermal status with a 1 s timeout before completion; the 10 s poll / 10 min bound is only the app's cooling-and-retry loop after native returns a thermal pause. It cannot bound an in-flight native call. Engine thermal admission also only checks at prefill admissions/chunk boundaries. ([app `src/engine/platformThermalStatus.ts:101-119`](/Users/marco/Projects/kalsa/src/engine/platformThermalStatus.ts:101); [`thermalResume.ts:68-71,153-180`](/Users/marco/Projects/kalsa/src/engine/thermalResume.ts:68))
- **Binding:** no timeout wraps native `loadPrompt`/completion; the JSI completion task calls into the completion loop synchronously. Route chunks are recorded after a successful native `llama_decode` and exposed as stats after the fact, not streamed to JS as progress. Thus a call stuck before/during its first `llama_decode` has neither progress nor a route callback to feed a progress watchdog. ([engine `src/llama-governor.cpp:340-378`](/Users/marco/Projects/kalsallama/src/llama-governor.cpp:340); [binding `cpp/rn-completion.cpp:470`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-completion.cpp:470))

App abort calls `stopCompletion()` when the captured engine is still current ([app `src/engine/LlamaService.ts:4322-4329`](/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:4322)). The binding stop path sets `is_interrupted`; its completion loop checks `while (ctx->completion->has_next_token && !ctx->completion->is_interrupted) {` ([binding `cpp/jsi/RNLlamaJSI.cpp:1345`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:1345)). This is observed between iterations; it does not preempt a synchronous allocator, `mlock`, page-fault/swap wait, or backend call. Dispose waits up to its 60 s safety window for stop/job settlement; with active native work it marks the context hung and refuses release to avoid use-after-free ([app `src/engine/LlamaService.ts:2982-3033`](/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2982)). Therefore neither `stopCompletion()` nor context release is a reliable way to break this incident's stuck native call.

## Q3. Model-switch memory

The normal release path drops the app context and invokes native `release()`. Binding source: `governor.reset();` ([binding `cpp/rn-llama.cpp:1052`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:1052)). Load teardown resets the governor, both model initializers, and primary initializer before replacing the model ([binding `cpp/rn-llama.cpp:1048-1057`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:1048)). The engine governor destructor frees both contexts ([engine `src/llama-governor.cpp:86-89`](/Users/marco/Projects/kalsallama/src/llama-governor.cpp:86)); binding cleanup resets both model initializers as well ([binding `cpp/rn-llama.cpp:241-247`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:241)). That should release model mmaps, mlock bookkeeping, KV/compute buffers, and HTP RPCMEM model buffers owned by those contexts.

Not everything is process-scoped to the model: the Hexagon device context lazily owns a session (`sess`) ([pinned binding vendor `ggml-hexagon.cpp:563-580`](/Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:563)), so session/driver/fence state can survive a model switch while backend registration remains alive. If disposal times out with active native work, the app deliberately leaves the native context allocated and refuses a new init; in that case all old model resources can survive until process restart. That is an explicit leak-on-hang safety path, not normal successful release ([app `src/engine/LlamaService.ts:3018-3033`](/Users/marco/Projects/kalsa/src/engine/LlamaService.ts:3018)).

## Q4. Ranked hypotheses and cheapest split experiments

Incident evidence: `FIRST attempt: native loadPrompt prompt_n=3145 n_common=0 began at 09:51:27 and NEVER returned (>9 min; not one further app log line; no error; stall/prefill watchdogs never fired; CPU spinning ~128 % with 0 % iowait ... ZERO fastrpc/HTP dispatch lines` ([lab `scratchpad/agents/s23-expo57-smoke/REPORT.md:157`](/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-expo57-smoke/REPORT.md:157)).

1. **Memory pressure / allocation or page residency pathology during fresh HTP+CPU dual-model initialization or first prefill.** Strongly consistent with 123 MiB free, 2.1 GiB swap, failed mlock, and success after force-stop; the high CPU could be allocator/repack work, reclaim, or a retry loop. **Experiment:** desk-run arithmetic against the exact LFM registry + logged `MemAvailable`, then one S23 same-process switch sequence with uncached `/proc/meminfo` and `/proc/self/status` snapshots immediately before plan, after old release, after load, and during a hang. If available RAM rises only after disposal or `VmSwap`/major faults change during the stall, that proves stale admission/pressure is in the causal path; stable RAM and no faults weakens it.
2. **HTP RPCMEM allocation/mapping/session or lazy tensor mapping stalls before DSP dispatch.** HTP owns RPCMEM buffers and lazily maps input tensors into FastRPC; zero dispatch fits a pre-dispatch failure/stall. **Experiment:** one S23 A/B on the same prompt and memory state: lane on vs lane off, capture native verbose HTP allocate/map lines and `/proc/meminfo`. If only HTP-on hangs before first dispatch, the HTP allocation/mapping path is implicated; if both hang at the same stage, HTP is not necessary.
3. **CPU busy loop / allocator lock / synchronization deadlock in the binding or engine before the first chunk.** 128% CPU and no dispatch indicate runnable native work, though pure swap thrash is less consistent with 0% iowait. **Experiment:** desk-run `ndk-stack`/`simpleperf` instructions for the exact APK, or collect one S23 `debuggerd`/`simpleperf` sample while stuck. Repeated samples on allocator/lock/retry frames prove a loop or lock path; samples moving through model copy/repack prove slow work; a blocked futex/driver frame proves waiting instead.
4. **Previous-model resources survive or release is incomplete across switches.** Normal release frees context-owned state, but backend sessions persist; a timed-out active native call intentionally leaves the entire context allocated. **Experiment:** desk-run lifecycle tracing to confirm release order, then one S23 switch with process RSS, `VmSwap`, system `Mlocked`, and HTP allocation/free logs around each release. A missing free/unmap or monotonically retained RSS/locked memory across successful switches proves residue; flat values after each release weakens this hypothesis.

## could not verify

- The raw incident log does not identify the exact native stack frame, allocator, or HTP operation at the hang point; zero dispatch only places the hang before dispatch.
- I did not find an incident-time snapshot proving which prior model's allocations remained after its switch, or the exact time/age of `deviceProfile.availableMemoryBytes` relative to each prior load.
- The 129 MiB net estimate uses the fit's 1.05× model allowance versus registry tensor bytes and the reported mlock request; exact peak memory also depends on HTP buffer alignment, mapped page residency, and backend/session scratch.

## Orchestrator verification (1d714246, 2026-10-02) - two corrections, read on app main 0b7c5e71

1. **Q2 is WRONG about the prefill deadline.** `armPrefillDeadline()` runs at `LlamaService.ts:5162`, BEFORE the
   round is invoked at `:5172` (`await resumeWhileCooling(coolingRound(round, runCompletionRound))`); `:5095` only
   DEFINES the closure. The deadline was armed. It did not fire in the observed window because it is
   `max(180 s, 5 x promptTokens / EMA)` (`prefillDeadline.ts:41`) and the EMA's sample in that process was the
   memory-starved prewarm (`LlamaService.ts:1413` feeds it: 1660 tok / 75.3 s = 22 tok/s) -> ~605-715 s for a
   2650-3145-token estimate, longer than the ~7-9 min the harness waited. Unproven but consistent.
2. **Q1 misses the main accounting bug.** `availableMemoryBytes` comes from `getCachedDeviceProfile()`
   (`LlamaService.ts:2290`), a PROCESS-LIFETIME cache (`deviceProfile.ts:682-707`, built once at `:653`). After
   several model switches in one process the governor still priced the lane against the app-start value (3458.93
   MiB) while the phone had 123 MB free. The fit is not "sampled before dispose": it is sampled once per process.
