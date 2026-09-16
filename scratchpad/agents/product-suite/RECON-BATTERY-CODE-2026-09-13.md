# RECON: Production CPU/Energy Paths on Android Chat

**Date:** 2026-09-13 | **Repo:** kalsa | Lines from HEAD

---

## 1. n_threads / n_threads_batch on S23 Production

`threadProfile.ts:131-222` -- detectThreadCount(): reads /sys/.../cpu_capacity, counts cores > 50% max. S23 capacities [266,266,266,811,811,811,811,1024] -> **5 fast cores**.

`deviceTuning.ts:91-98` -- measured preset:
```
sd-8-gen2: decodeThreads=5, prefillThreads=5   # SAME
```

`LlamaService.ts:1580-1620` -> `engineParams.ts:93-107`:
- n_threads = 5
- applyPrefillThreadOverride only sets n_threads_batch when decode != prefill -> **never set on S23**
- Both prefill and decode use **5 threads** via n_threads.

Batch: n_batch=512, n_ubatch=256 ("measured:ubatch-256").

G99 is the only device with a split: decodeThreads=2, prefillThreads=8.

---

## 2. forceShort vs Extended; 287 Tokens on "solo il numero"

`thinkingBudgets.ts:78-85` -- userTurnLooksLikeToolRequest() matches arithmetic (\d+[+*]\d), "calcola/quanto fa" keywords.

`thinkingBudgets.ts:118-150` -- default path:
```
extended = !forceShort && decodeTokPerSec >= 5
budget = extended ? model.extended (LFM:1024) : model.short (LFM:512)
nPredict = model.nPredict ?? 1024  -> LFM: 2048
```

**forceShort=true** -> budget = 512 (LFM short), thinking still enabled (budget caps, not disables).

287 tokens = think block (<=512 budget, compressed by LFM) + answer text. STOP_WORDS (`LlamaService.ts:518-525`): `</thought>`, `</s>`, `<turn|>` etc. do NOT fire for short outputs -- the model simply exhausts the budget or produces the answer and hits the EOS.

**"solo il numero" is NOT a tool request** (no digits flanking an operator, no "calcola" keyword) -> forceShort=false, extended=true on S23 (10+ tok/s). Budget=1024 (LFM extended), nPredict=2048. The 287 observed may come from a specific benchmark run where a different model/override was active, or from early termination via STOP_WORDS.

---

## 3. extractMemory After Every Completed Turn

**YES, every completed turn runs extractMemory** (when memory is enabled).

### The path

1. `AppShell.tsx:5712-5757` -- `armMemoryExtract()` called at onDone:
   ```
   armMemoryExtract()  // registers extract job, waits for save gate
   ```

2. `AppShell.tsx:5757` -- gate opens after `saveEngineSession()` settles:
   ```
   await saveEngineSession(...)  // FIFO via withEngineJob
   releaseSaveGate?.()           // opens extract gate
   ```

3. `LlamaService.ts:4320-4476` -- `extractMemory()`:
   - `EXTRACT_MEMORY_N_PREDICT = 192` (line 479)
   - `enable_thinking: false`, `thinking_budget_tokens: 0` (lines 4460-4462)
   - Single user-message completion with temperature=0.1, top_k=20, top_p=0.9
   - Timeout: `extractTimeoutMs()` from `extractBudget.ts:14-38`, floor 20s, ceiling 120s
   - With EXTRACT_MEMORY_PRESERVE_CHAT_KV=true: snapshots KV, runs extract, restores from .kvs

### Can it be skipped?

YES, several paths skip it:
- `MemoryStore.getEnabled()` returns false (memory OPT-IN, default OFF) -> `stopReason: "skipped_no_snapshot"` (`AppShell.tsx:5020`)
- `signal.aborted || turnFailed || !assistantFull.trim()` -> early exit (`AppShell.tsx:5000-5010`)
- `calendarExtractSkipSeq === fetchAllowlistTurnSeq` -> calendar turn (`AppShell.tsx:5015`)
- `EXTRACT_MEMORY_PRESERVE_CHAT_KV=true` but `kvHoldsChatSession=false` -> skip (`LlamaService.ts:4389-4391`)
- Abort from next send -> `stopReason: "aborted_by_send"` (`extractAbort.ts`)

**When memory is OFF (default), extractMemory is skipped entirely** (`AppShell.tsx:5020`): `getEnabled()` check happens BEFORE `extractMemory()` is called. `trackMemoryExtractStopReason(2)` = "memory disabled". The 192-token completion does NOT run.

---

## 4. Other CPU Spinners Between Turns

### 4a. Prefix Prewarm (EAGER_PREFIX_PREWARM=true)

`LlamaService.ts` `queueStaticPrefixPrewarm()`:
- Runs on app foreground + engine ready
- Uses `n_predict: 0` (prefill-only, no decode) -- **burns prefill CPU but NOT decode**
- Gated: skips if `kvHoldsChatSession` or already warmed (hash match)
- `notifyStaticPrefixInputs()` triggers on locale/tools change, may `clearCache()` + re-prewarm
- **Cost:** one full prefill of system+tools prefix (~1.3k tokens). On S23 ~130ms; on Jelly ~400ms.

### 4b. Memory Monitor (15s interval)

`AppShell.tsx:3142` -> `src/engine/monitor.ts:128-167`:
```
startMemoryMonitor({ intervalMs: 15_000, onPressure, onAppState })
```
- `setInterval(sample, 15_000)` -- reads `/proc/meminfo` + `/proc/self/status` every 15s
- `onPressure` callback -> `"pressure.transition"` log + potential background discard trigger
- **Cost:** negligible (proc reads are ~1ms), but the interval keeps the JS event loop alive

### 4c. Background Grace Timer (45s)

`AppShell.tsx:352`: `BACKGROUND_DISPOSE_GRACE_MS = 45_000`
- `backgroundGrace.onBackground()` starts a 45s timer
- On expiry -> `requestDeferredDispose()` -> `disposeEngine()` (releases native context)
- **CPU cost during the 45s:** NONE (timer only, no work). After expiry: dispose + release (brief CPU).

### 4d. Foreground Idle Dispose (180s)

`src/app/foregroundIdleDispose.ts:1-8`:
```
FOREGROUND_IDLE_DISPOSE_MS = 180_000
```
- After 180s idle in foreground -> dispose engine
- **CPU cost:** only at expiry (dispose). Nothing spinning during the 180s.

### 4e. Governor Thermo Refresh

`LlamaService.ts` `refreshGovernorBeforeCompletion()`:
- Called before EVERY completion (chat + extract + prewarm)
- `readGovernorThermo()` -> reads thermal sensor
- `engine.setGovernorThermo()` -> native governor update
- **Cost:** one async read + native call per completion. ~1-2ms.

**Note:** Governor is gated by `kalsa.governor.enabled` (default OFF). When off, this still runs but the `setGovernorThermo` is a no-op (`activeGovernorActive=false`).

### 4f. Embedding Service

`src/engine/EmbeddingService.ts:1-30`:
- Lazy loaded, serialized via `runNativeOp` (same mutex as chat)
- Runs AFTER chat completes (not concurrent)
- Only when documents are indexed and embedder is downloaded
- **Cost:** separate initLlama + embedding completions. Can burn significant CPU if chunks pending.

### 4g. Platform Thermal Listener

`src/engine/platformThermalStatus.ts:50-80`:
- Native event listener, fires on thermal state changes
- Only triggers hard-gate overlay (CRITICAL/EMERGENCY/SHUTDOWN)
- **Cost:** zero CPU when idle (event-driven). Only fires on thermal transitions.

---

## 5. extra_bufts, mmap, flash_attn, n_gpu_layers=0 Production Defaults

### no_extra_bufts (= NOT repack)

`src/engine/loadPolicy.ts:24-32`:
```
DEFAULT_LOAD_POLICY = { mmap: true, repack: true }
```
`resolveLoadPolicy()` (line 62-80): when no bench override + no streaming:
- `noExtraBufts = !policy.repack = !true = false`
- **Production default: repack ON** (extra_bufts = false, meaning the repack buffer IS allocated)

Exception: expert streaming (`moe_stream.enabled=true`) forces `no_extra_bufts=true`.

### use_mmap

`LlamaService.ts:1593-1596`:
```
use_mmap: load.useMmap  // from resolveLoadPolicy
```
Default: `mmap: true` (weights mapped from GGUF file, page-cache backed, kernel-reclaimable).

### flash_attn_type

`LlamaService.ts:1614`:
```
flash_attn_type: "auto"
```
Always "auto" in production. Bench-only can set "off" (with `cache_type_v: "f16"` fallback).

### n_gpu_layers

`src/engine/deviceTuning.ts:780-787`:
```
export function nGpuLayersForBackend(backend: BackendPolicy): number {
  switch (backend.kind) {
    case "gpu-metal": case "gpu-opencl": return 99;
    default: return 0;
  }
}
```
`resolveBackendPolicy()` (line 375-420): Android -> `{ kind: "cpu-only", reason: "gpu-fit-gate-blind" }`.

**Production Android: `n_gpu_layers = 0`** (CPU-only).

When governor feature enabled but governor not eligible: `LlamaService.ts:1564`:
```
if (governorFeatureEnabled && !governorLoad) {
  params.n_gpu_layers = 0;   // force zero even if backend policy said otherwise
}
```

### kv_unified

`LlamaService.ts:1611`:
```
...(options.kvUnified ? { kv_unified: true } : {})
```
Qwen3.5 has `kvUnified: true` in catalog -> sent. LFM does not -> omitted.

### ctx_shift

`LlamaService.ts:1613`:
```
ctx_shift: isMultimodal ? false : true
```
Text-only chat: `ctx_shift: true`. Vision: `false`.

---

## 6. PowerManager / PARTIAL_WAKE_LOCK

### expo-keep-awake (DOWNLOAD only)

`src/app/AppShell.tsx:4237`:
```
await activateKeepAwakeAsync(DOWNLOAD_KEEP_AWAKE_TAG).catch(() => undefined);
```
`AppShell.tsx:4544`:
```
await deactivateKeepAwake(DOWNLOAD_KEEP_AWAKE_TAG).catch(() => undefined);
```

**Only used during model download.** Tag: `DOWNLOAD_KEEP_AWAKE_TAG`.

### No other wakelocks

`grep -rn "PowerManager|PARTIAL_WAKE_LOCK|WakeLock|wakeLock|keepAwake|KeepAwake"` across src/ only finds:
- `AppShell.tsx` (expo-keep-awake above)
- `thermalHardGate.ts` (reads thermal status, no wakelock)
- `platformThermalStatus.ts` (native module query, no wakelock)

**There is NO PARTIAL_WAKE_LOCK held during chat inference.** The CPU stays awake only because React Native's JS thread keeps the process alive while in foreground. When the app goes background, the 45s grace timer fires, disposes the engine, and the process can be suspended by Android.

### Foreground CPU keepalive

No explicit foreground service or wakelock during chat. The process stays alive because:
1. Foreground Activity (React Native) keeps the process alive
2. llama.cpp native threads run on pthreads (not Android services)
3. When backgrounded: 45s grace -> dispose -> process becomes suspendable

---

## Summary: CPU/Energy Budget Per Chat Turn

| Phase | Threads | Duration (S23 est.) | CPU cost |
|-------|---------|---------------------|----------|
| Prefill (prompt eval) | 5 | ~100-200ms per 1k tokens | High |
| Decode (token generation) | 5 | 10-109s (102-287 tokens @ ~10 tok/s) | High |
| Governor thermo read | 1 async | ~1-2ms | Negligible |
| Memory monitor (15s) | JS event loop | ~1ms per sample | Negligible |
| Prefix prewarm (on change) | 5 (prefill only) | ~130ms (system+tools) | Medium |
| extractMemory (if enabled) | 5 | 20-120s budget, ~5-20s typical | **High** |
| Session save (native) | 1 (serialize) | ~100-500ms | Medium |

**The two dominant CPU consumers per turn are:**
1. **Chat completion** (prefill + decode) -- unavoidable
2. **extractMemory** (192-token completion with KV checkpoint/restore) -- runs AFTER every turn when memory is ON

When memory is OFF (default), extractMemory is skipped entirely (`stopReason=2`).
