# Device Tuning Layer — per model / GPU / CPU optimization profiles

Date: 2026-08-10 · Branch: perf/fluidity-and-deviceprofile (design) · Status: DESIGN

## 1. Why (the "something unique")

Rivals ship one-size-fits-all engine settings (MLC: compile-time static variants; PocketPal: 80%-of-cores heuristic; Layla: opaque). Kalsa already proved that per-SoC tuning matters (threads from `cpu_capacity` fixed a 3× regression on SD 8 Gen 2; Helio G99 wants a different count than the big-core devices; prefill and decode want opposite thread counts on G99). The Device Tuning Layer makes this **systematic, measured-first, and provenance-tracked**: every engine knob is resolved per (model, device, measured context) with an explicit source, so nothing is ever a blind heuristic and every default is defensible.

## 2. Principles (hard rules, learned from past mistakes)

1. **Measured-first.** A knob's value must trace to a measurement (our own harness/llama-bench, or a documented measurement in code). Never invent.
2. **Conservative default.** Unmeasured device/model → the safest measured value (threads fallback 4; ubatch 256; kv q8_0/q4_0). A wrong default must degrade gracefully, never OOM/kill.
3. **Exact-match over rules.** An exact SoC match in the measured registry wins over any family rule. Family rules only cover measured layouts.
4. **Provenance everywhere.** Every resolved knob carries its source string (like `ThreadCountSource`), surfaced in `formatBenchStatus` / settings. A user/CI can see WHY the app picked 5 threads.
5. **Never hard-block on missing probes** (existing `modelGateVerdict` contract).
6. **No FPS HUD.** This layer tunes the engine; the UI refresh rate is handled by the rendering work, not by this module.

## 3. Inputs

```
type TuningInput = {
  model: ModelInfo;          // catalog: id, contextLength, engineCtx, kvCache, hybrid, mtp, thinking, sizeBytes, kvBytesPerToken
  profile: DeviceProfile;    // deviceProfile.ts: brand/model, total/available RAM, cpuCoreCount, ramTier, family, isMiuiFamily, isFoldableCandidate
  measured?: Partial<MeasuredDevice>;  // optional bench data (see §5)
  request: {                // per-request overrides (user settings / bench arms)
    contextBudget?: number;  // desired n_ctx
    ubatchOverride?: number;
    threadsOverride?: number;
  };
};
```

## 4. Outputs (resolved engine params + provenance)

```
type TuningResult = {
  n_threads: number; nThreadsSource: string;
  n_ubatch: number; ubatchSource: string;
  kv: { type_k: string; type_v: string }; kvSource: string;
  context: { n_ctx: number; ctxSource: string };      // budget incl. KV estimate
  memory: { nonEvictableMiB: number; availableMiB: number | null; fit: MemoryFitVerdict["status"] };
  backend: { policy: BackendPolicy; reason: string }; // see §6
  thermal: { maxDecodeSeconds?: number; guardSource: string };  // optional
};
```

## 5. Measured registry (seeded from the app's own benchmarks — do not re-derive)

| SoC / device | CPU layout | threads (decode) | threads (prefill) | notes / measurement |
|---|---|---|---|---|
| Helio G99 (Jelly Star) | 2×A76 + 6×A55 | 2 | 8 | llama-bench b10156, CPU-only; prefill/decode want opposite counts (41f22c3) |
| SD 8 Gen 2 (Xiaomi 14?) | 1+4+3 | 5 | 5 | capacity rule; 6 collapses to 27 tok/s vs 8 → 65 (threadprofile data) |
| SD 8 Gen 3 | 1P+5perf+2eff | 6 | 6 | measured 103.9 tok/s @6 vs 78.6 @4 vs 10.8 @8 (setup-review) |
| iOS (Metal) | n/a | 4 | 4 | fallback; llama.rn iOS path (threadProfile) |

Rules with measured bounds (from threadProfile harness):
- capacity threshold `> 50% of max` is a CHOICE bounded by tests, not a derived constant (real layouts pin only (0.34, 0.79)).
- `threads >= 7` produced catastrophic decode on one device (0.06 tok/s @8 on SD8Gen3) — warning string is measured fact only.
- ubatch 256 documented lmkd guard (2B and 4B compute buffer ≈ 249 MiB at ub=256).

## 6. Backend policy per family

```
BackendPolicy =
  | { kind: "cpu-only"; reason: "hexagon-offload-fatal" }            // Android default (HTP0 broke FA + V-cache q4)
  | { kind: "gpu-opencl"; reason: "adreno-capable" }                 // future: OpenCL on Adreno w/ dotprod+i8mm gate (PocketPal pattern) — NOT implemented, gated off by default
  | { kind: "gpu-metal"; reason: "apple" }                            // iOS n_gpu_layers 99 (existing)
  | { kind: "emulator"; reason: "no-accel" }                          // x86 CI / emulator
```
Android stays **cpu-only** until an OpenCL path is measured end-to-end on a real Adreno device (the app's history: Hexagon HTP0 was fatal; OpenCL vision crashed → CPU encode). The policy is a documented switch, defaulting off.

## 7. Resolution order (pure function — harness-testable)

```
resolveEngineTuning(input) ->
  1. exact SoC preset from measured registry (match on cpuCoreCount + capacity signature + brand) -> if found, use it (provenance "soc-preset:<name>")
  2. else family policy:
     - Apple          -> threads 4, kv q8_0/q4_0, ctx from RAM tier, backend metal
     - Android big-core (max cap ratio >= 0.7 with >=6 cores) -> capacity rule threads (existing), ubatch 256, backend cpu-only
     - Android small-core (G99-like: max cap ratio < 0.7, 8 cores) -> decode threads = fast-core count (<=2), prefill = all cores, ubatch 256
     - unknown/emulator -> threads 4, ubatch 256, ctx 8192, cpu-only   (provenance "fallback")
  3. memory budget: n_ctx = min(requested, ctxFit(availableMiB, model.kvBytesPerToken)) — never exceed a context that pushes nonEvictableMiB past available RAM; never below 2048.
  4. thermal guard: if measured decode > 60s sustained on 4B tier and availableMemory low -> optional maxDecodeSeconds (harness-only flag; UI decision later).
```

## 8. Provenance strings (contract for telemetry)

`"soc-preset:helio-g99" | "family:apple" | "family:android-big" | "family:android-small" | "fallback" | "override:user" | "override:bench"` — appended to `formatBenchStatus` (already has `threads_src=`).

## 9. Harness (scripts/tuningLayerHarness.mjs)

Pure-function cases (compile-from-disk pattern like threadProfileHarness):
1. exact SoC match wins over family rule (G99 synthetic profile → 2 decode / 8 prefill, source soc-preset)
2. SD 8 Gen 2 signature → 5 threads (capacity rule)
3. SD 8 Gen 3 → 6 threads
4. unknown 8-core → fallback 4 (never invents)
5. Apple → 4 + metal backend
6. ctx budget: large n_ctx requested but available RAM tight → n_ctx reduced (never exceeds fit), floor 2048
7. kv quant unchanged by policy on Android cpu-only (q8_0/q4_0)
8. provenance field present and correct on every path
9. ubatch override honored (request > preset)
10. no hard block when availableMemory null (fit "unknown", params still resolve)

## 10. Integration points

- `src/engine/deviceTuning.ts` (new pure module) + `scripts/tuningLayerHarness.mjs`.
- `LlamaService.ts` init: replace ad-hoc `n_threads`/`n_ubatch`/`n_ctx` resolution with `resolveEngineTuning` output (keeping the existing measured threads path until the new module is green).
- `benchConfig.ts`: bench arms can override via `request` (threads/ubatch/ctx) — keeps the harness owner's bench intact.
- Settings: show resolved params + source (one line, no FPS).

## 11. Out of scope (this design)

- OpenCL/GPU inference enablement (policy exists, default off — needs a real Adreno measurement campaign first).
- Thermal governor (flag only).
- Mini-app SDK, personas, WebRTC remote (competitor-driven, separate tranche).
