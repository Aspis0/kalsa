# Governor note 2026-10-15: a memory fit refusal drops the GPU entirely, and that costs 54x on prefill

Research note by the coordinator session, from a live bug on the owner's Xiaomi 14. No code written,
nothing pushed. The user-visible half of this (telling the owner why the answer will be slow) belongs
to the kalsa-brain session and is theirs to decide; this note is the governor half.

## The measurement

Same phone, same model, same app build (`aa789620`), two loads on 2026-10-15:

| local time | `gpu_fit` | `decode_repack` | available | `nGpuLayers` prefill | prewarm |
|---|---|---|---|---|---|
| 11:11 | Fit | false | 4678.89 MiB | 99 | 1989 tok / 2.35 s |
| 11:13 | Fit | true | 5680.91 MiB | 99 | 1989 tok / 2.35 s |
| 11:17 | Fit | true | 5555.19 MiB | 99 | 1760 tok / 2.01 s |
| **14:35** | **NoFit** | **false** | **3004.93 MiB** | **0** | 1760 tok / **109.45 s** |

App log lines (the only place this is visible: a release+debuggable build writes no JS to logcat):

```
2026-10-15T18:35:02.320Z KALSA_GOVERNOR_PLAN {"gpu_fit":"NoFit","decode_repack":false,
  "required_mib_with_repack":4905.12,"required_mib_without_repack":3385.06,"available_mib":3004.93,...}
2026-10-15T18:35:07.999Z KALSA_NATIVE_VARIANT {"nGpuLayers":{"prefill":0,"decode":0},
  "androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl"}
2026-10-15T18:39:18.438Z KALSA_PREWARM {"op":"done","promptMs":109448.759,"promptN":1760}
```

The shortfall was **380 MiB on a 3385 MiB estimate, i.e. 12.6 %**. The cost of refusing it was a
prefill at **16 tok/s instead of ~850**, on a turn whose whole prompt was 1760 tokens. The owner saw
a turn that never answers.

## Where it happens, in the shipping code

- `src/engine/governorInputs.ts:216-225` - `fitMemoryEstimate` then `lane.requiredMiB + extraMiB <=
  availableMiB` produces `gpu_fit`. `:172-190` `lanePrice` = `estimateMemory({fileBytes, contextTokens,
  kvBytesPerToken, ubatch, mmap, repack})`. `:38` `NPU_PREFILL_EXTRA_MIB = 219`, so the printed
  3385.06 is 3166.06 of lane + 219 of NPU prefill copy.
- `src/engine/LlamaService.ts:2702` - `n_gpu_layers: nGpuLayersForBackend(tuning.backend)`, which is
  all-or-nothing in the other direction too (99 on Metal, 0 for a cpu-only Android backend).
- **`src/engine/LlamaService.ts:2712-2719`** is the step that matters:

  ```ts
  // Android: an enabled governor with an invalid thermo sample or a
  // conservative fit refusal stays on the existing CPU-only loader; no native
  // two-context attempt is made and no driver allocation is risked.
  if (Platform.OS === "android" && governorFeatureEnabled && !governorLoad) {
    params.n_gpu_layers = 0;
  }
  ```

  A fit refusal therefore does not reduce the GPU offload, it **removes** it. There is no rung
  between 99 and 0 on this path, while the engine takes an arbitrary layer count.

## Why this is worth a decision rather than a shrug

The refusal is deliberate and its stated reason is sound (do not risk a driver allocation on the
owner's daily driver). The problem is the size of the response: a 12.6 % shortfall on an *estimate*
buys a 54x slower prompt read, and the app says nothing, so the turn reads as a hang rather than as
a slow phone. On this SoC that state is reachable by opening a few apps - it is not an exotic
configuration.

## Three candidate moves, none of them mine to choose alone

1. **Partial offload.** Offload as many layers as fit instead of dropping to zero. Needs a
   per-layer price, which `estimateMemory` does not provide today (it prices a whole lane at a whole
   context). Risk: an OOM on the daily driver, which is exactly what the existing comment refuses.
   Unknown and unmeasured: whether HTP + Adreno on this SoC can share a context with only part of the
   weights on the GPU without breaking the one-copy contract. I will not assume it works.
2. **Price the lane on the prompt, not on the configured context.** `lanePrice` uses
   `memory.contextTokens`; on a phone configured with a large context and talking about something
   small, the refusal costs 109 s for a 1760-token prompt. Cheaper and safer than (1), but it moves
   the guarantee: the KV grows during a turn, so a price that fits at turn start can stop fitting
   mid-turn.
3. **Nothing in the governor; only tell the owner.** Zero risk, and it is the other session's call.
   It leaves the 109 s in place.

## What I need to proceed

- The owner's trade: is a mid-load OOM risk on the daily driver acceptable in exchange for not losing
  54x of prefill latency? I would not decide that myself.
- One measurement we do not have: what a partial offload actually costs in memory on SM8650, i.e.
  whether option 1 is even implementable without breaking one-copy. It needs a bench cell on the
  Xiaomi or a QDC SM8650 board, not the code.

## Status

Reported to the kalsa-brain session, who own the user-visible line and who are shipping the load
marker fix (`fe43287f` + `a99c1314`) that caused the first half of the hang. Nothing pushed from
this side; the app checkout was not touched.