# Xiaomi RAM / zram investigation — Qwen3.5-4B fit-gate re-verification on the current tree

*Explorer pass, read-only. App repo `/Users/marco/Projects/kalsa`; authoritative ref
`origin/main = 5429799` ("fix(ci): print the turn's reuse number again…"). Lab worktree
`~/.paseo/worktrees/0dh4675z/gov-audit-recheck` (`governor-audit-recheck`, HEAD `612827e8`).*

**Scope and method.** Every code claim below was read off the working tree at
`/Users/marco/Projects/kalsa` and is quoted with `file:line`. The working tree is one commit
ahead of `origin/main` (`745bf82`, which touches only `scripts/device-ciswire-cache.sh`), so
`src/` is byte-identical to `origin/main`; `git diff origin/main..HEAD -- src/` is empty. No
existing file was edited, nothing was committed, no `adb` was run. The Xiaomi is not attached
(only the Jelly and the S23 are), so all device numbers below are read back from the 20/09
record, not re-measured.

---

## 0. What changed since the record — and what did not

The record (`analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md`) was written
against `main@809d191`. Between `809d191` and `origin/main@5429799` the only commit that touches
the fit gate, the estimators, the load policy or the registry is `50b8196` (the vendored-engine
layout port). Its own message says the change is mechanical:

> `src/engine/engineIdentity.test.ts, src/engine/loadPolicy.ts` — Synthetic trees and one comment
> updated to the new layout.

`git --no-pager log --oneline 809d191..origin/main -- src/engine/loadPolicy.ts
src/engine/memoryEstimate.ts src/engine/deviceProfile.ts src/engine/modelGateRAM.ts
src/engine/ModelRegistry.ts src/engine/memoryPressure.ts src/engine/monitor.ts
src/hooks/useProcessHealth.ts` prints exactly one line (`50b8196`). So the arithmetic that
produced the `tightNow` refusal is unchanged, and the re-verification is a confirmation with
better instrumentation, not a different result.

Two record claims are stale and are corrected here:

1. The record says the gate is swap-blind with "0 occurrences of zram/swap in `src/`". At the
   current tree `grep -rn -i "zram\|swap" src/` returns **76 lines** (and already returned 76 at
   `809d191`; `git grep -i "swap\|zram" 809d191 -- src/ | wc -l` = 76). Memory-swap awareness
   exists in `src/engine/memoryPressure.ts`, `src/hooks/useProcessHealth.ts`,
   `src/engine/monitor.ts` and the Settings diagnostic string. The literal string `zram` still
   appears nowhere. The **gate** remains swap-blind, but the app is not.
2. The record's causal emphasis on eager vision as the term that "tips Qwen from fits to
   refused" is incomplete. With repack ON, the refusal holds even with the projector removed
   (§5). Repack is the decisive term; vision is the second-largest removable term.

---

## 1. Fit-gate math

### 1.1 Path from decision to load

The refusal in the record came from the **load** gate, not the Settings/Settings-style hard gate:

```
evaluateLoadGate(model)                       src/app/AppShell.tsx:3890
  -> gateModelLoad({...})                     src/engine/loadGate.ts:158
       residentModelId === null  -> no dispose, disposedResident stays false   loadGate.ts:192
       getAvailableBytes()  (UNCACHED reader injected)                          loadGate.ts:217
       -> decidePreSendFit(model, available, opts)                              loadGate.ts:219
            -> resolveGateLoadPolicy(...)                                       deviceProfile.ts:449
            -> estimateMemory(...)                                              deviceProfile.ts:450
            -> evaluateModelFit(...) -> estimateMemory + fitMemoryEstimate      deviceProfile.ts:463
            -> tight && available < 1.5 * requiredBytes -> refuse tightNow      deviceProfile.ts:483-487
```

The gate input is built by `loadGateFitModel` (`src/engine/loadGate.ts:24`), which resolves the
context through `resolveContextProfile` (`loadGate.ts:73`) and re-prices KV at the chosen cache
profile (`loadGate.ts:78`). The load path consumes the same resolution: `AppShell.tsx:4303`
resolves the profile and `:4361` passes `nCtx`/`cacheTypeK`/`cacheTypeV` to `initEngine`, and
`LlamaService.ts:2286` re-resolves tuning with the same `mmap`/`repack` pair. Gate and engine
cannot disagree about the terms.

### 1.2 Terms, source and formula

`estimateMemory` (`src/engine/memoryEstimate.ts:129`) is the single formula:

```
weightsMiB      = fileBytes / MiB                                  // main GGUF + mmproj
computeMiB      = ubatch * (COMPUTE_MIB_AT_UBATCH_256 / 256)
kvMiB           = contextTokens * kvBytesPerToken / MiB
mmap on,  repack on  -> repackMiB = weightsMiB * REPACK_FRACTION    // anonymous
mmap off, repack on  -> anonWeightsMiB = weightsMiB * 1.32
nonEvictableMiB = anonWeightsMiB + repackMiB + computeMiB + kvMiB   // OOM-deciding number
totalMiB        = weightsMiB - anonWeightsMiB + nonEvictableMiB
```

- `fileBytes` is the **bundle**: `main + (mmproj?.sizeBytes ?? 0)` (`deviceProfile.ts:428-434`,
  `:341-345`; `modelGateRAM.ts:71`). The mmproj is therefore inside the weight term.
- Constants: `COMPUTE_MIB_AT_UBATCH_256 = 249` (`memoryEstimate.ts:35`);
  `REPACK_FRACTION = (1333 - 249) / 1211 ≈ 0.8951` (`memoryEstimate.ts:51`);
  `FIT_HEADROOM_MIB = 512` (`memoryEstimate.ts:73`);
  `ANON_WEIGHTS_REPACK_ON_FACTOR = 1.32` (`memoryEstimate.ts:95`).
- The gate always prices `ubatch: 256` (`deviceProfile.ts:264`, `:369`, `:458`;
  `modelGateRAM.ts:82`), matching `DEFAULT_UBATCH = 256` (`deviceTuning.ts:244`). The engine
  sends `n_batch: 512, n_ubatch: tuning.n_ubatch` (`LlamaService.ts:2383-2386`).
- Context is `resolveGateContextTokens` (`deviceTuning.ts:672`) → `resolveEngineTuningSync` →
  `resolveContextBudget` (`deviceTuning.ts:527`), which floors at `CTX_FLOOR = 8192`
  (`deviceTuning.ts:247`) and only shrinks when the non-evictable estimate exceeds available.
- Verdict (`memoryEstimate.ts:192`): `does_not_fit` when `nonEvictable > available` (`:215`);
  `tight` when `nonEvictable + 512 > available` (`:223`) **or** when `total > available` while
  non-evictable fits (`:232`); else `fits`.
- `decidePreSendFit` maps: `does_not_fit -> tooLarge` (`deviceProfile.ts:472-473`),
  `unknown -> allow + banner` (`:475-476`), and `tight -> refuse tightNow iff
  availableBytes < 1.5 * requiredBytes` (`:480-488`), where `requiredBytes = nonEvictableMiB`.

The observed refusal is the last branch. The hard gate used by Settings and the download path
(`modelGateVerdict`, `deviceProfile.ts:140`) blocks only on `nonEvictable > available`
(`:183-198`) — it does **not** have the 1.5× rule. On the Xiaomi it would return `allowed:"ok"`
for Qwen; the load/send gate is strictly the stricter of the two.

### 1.3 Model entries

`MODEL_REGISTRY` (`src/engine/ModelRegistry.ts:181`):

| field | `qwen3.5-4b` (`:183`) | `lfm2.5-2.6b` (`:241`) |
|---|---|---|
| `sizeBytes` | `2_834_975_040` (`:190`) | `1_593_894_944` (`:248`) |
| `mmproj` | `{file:"mmproj-F16.gguf", sizeBytes:672_423_616}` (`:196-199`) | absent (text-only, `:250`) |
| `engineCtx` | `8192` (`:203`) | `8192` (`:254`) |
| `hybrid` | `true` (`:207`) | `true` |
| `kvCache` | `{k:"q8_0", v:"q4_0"}` (`:206`) | `{k:"q8_0", v:"q4_0"}` |
| `kvBytesPerToken` | `13312` (`:232`) | `6656` (`:262`) |
| `minRamTier` | `"high"` (`:237`) | `"low"` (`:268`) |
| `default` | — | `true` (`:273`) |
| `loadPolicy` | **absent → `DEFAULT_LOAD_POLICY`** | **absent → `DEFAULT_LOAD_POLICY`** |

Neither entry carries `loadPolicy`. `DEFAULT_LOAD_POLICY = { mmap: true, repack: true }`
(`src/engine/loadPolicy.ts:33`), i.e. llama.cpp normal behaviour plus the ARM repack. The
precedence is documented at `loadPolicy.ts:8-26` and implemented in `resolveLoadPolicy`
(`:60`) / `resolveGateLoadPolicy` (`:88`): **bench levers > streaming > per-model policy >
default**. `kalsa.bench.norepack=1` forces `no_extra_bufts` (`:71-73`), `=0` forces repack on.

`resolveContextProfile` (`contextProfile.ts:159`) upgrades a hybrid to `HIGH_RAM_N_CTX = 16384`
(`:10`) when `totalMemoryBytes >= CTX_UPGRADE_MIN_TOTAL_BYTES = 7_500_000_000` (`:62`). The
Xiaomi reports ~11.4–12 GB, so Qwen resolves to **16384**, which the record's `n_ctx=16384`
log line confirms. LFM is also hybrid and would upgrade too, but it fits at either size (§1.5).

### 1.4 Qwen-4B memory budget — nominal vs actual (Xiaomi, 20/09 readings)

Device inputs, from the record: `MemTotal 11 436 476 kB (~11.4 GB)`,
`MemAvailable 3 727 652 kB (= 3640.3 MiB)`, `SwapTotal 12 582 908 kB`,
`SwapFree 9 188 752 kB (~3.4 GB already compressed)`. Nominal RAM 12 GB.
`MemTotal` (and expo-device `totalMemoryBytes`) ≥ `7.5e9` ⇒ `n_ctx = 16384`.

| term | MiB | where it comes from |
|---|---:|---|
| main GGUF `Qwen3.5-4B-Q4_K_M.gguf` | 2703.6 | `ModelRegistry.ts:190` (2 834 975 040 B) |
| vision projector `mmproj-F16.gguf` | 641.3 | `ModelRegistry.ts:198` (672 423 616 B) |
| **bundle (gate's `fileBytes`)** | **3344.9** | `deviceProfile.ts:428-434` |
| repack, `0.8951 × bundle` | 2994.1 | `memoryEstimate.ts:160` |
| compute at ubatch 256 | 249.0 | `memoryEstimate.ts:149` |
| KV at 16384 × 13312 B/tok | 208.0 | `memoryEstimate.ts:150`, `ModelRegistry.ts:232` |
| **non-evictable (gate's `requiredBytes`)** | **3451.1** | `memoryEstimate.ts:164` |
| total (peak-RSS proxy) | 6796.0 | `memoryEstimate.ts:168` |
| **`MemAvailable`** | **3640.3** | `/proc/meminfo`, record §4 |

Verdict sequence on this input: `nonEvictable 3451.1 < 3640.3` ⇒ not `does_not_fit`;
`3451.1 + 512 = 3963.1 > 3640.3` ⇒ `tight`; ratio test `3640.3 < 1.5 × 3451.1 = 5176.7` ⇒
`{ allow:false, reasonKey:"model.tightNow" }` (`deviceProfile.ts:483-487`). This reproduces the
record's `KALSA_LOAD {"refusedBy":"fit","reasonKey":"model.tightNow"}` exactly.

**The nominal/actual gap is the point.** The gate's nominal model is "a 4B Q4 model, ~2.8 GB
file". The actual load it prices is 3.35 GB of file (because the projector rides along
unconditionally, §3) plus a 2.99 GB anonymous repack copy — 6.3 GB of anonymous weight memory
demand for a "4B" model, against 3.6 GB free. The repack term alone (2994 MiB) is 82% of
`MemAvailable`.

### 1.5 Scenario table (computed from the current consts)

All rows: `n_ctx = 16384`, KV 13312 B/tok unless noted, `ubatch = 256`, `MemAvailable = 3640.3 MiB`.

| configuration | non-evictable MiB | verdict | gate outcome |
|---|---:|---|---|
| current: bundle + repack ON + mmap ON | 3451 | tight | **REFUSE `tightNow`** (3640 < 5177) |
| lazy vision only (main + repack ON) | 2877 | tight | **REFUSE `tightNow`** (3640 < 4316) |
| repack OFF (bundle, incl. mmproj) | 457 | tight | allow (3640 ≥ 686); `total` 3802 > 3640 |
| repack OFF + lazy vision (main only) | 457 | fits | allow |
| bundle + repack ON at 8192 ctx | 3347 | tight | **REFUSE `tightNow`** |
| `lfm2.5-2.6b` bundle + repack ON at 16384 | 1714 | fits | allow (this is why LFM loads) |

Consequences:
- The **only single change that clears the gate is repack OFF**. Lazy vision alone does not.
- Repack OFF + lazy vision is the only combination that reaches a clean `fits`.
- A smaller context is not a fix: at 8192 the non-evictable term falls by 104 MiB and the
  refusal stands.
- Under the record's own measured 4B repack calibration (1.00× file, `memoryEstimate.ts:53-56`),
  the true anonymous weight pair is ≈ 2703.6 (LLM repack) + 641.3 (anonymous projector) = 3345 MiB,
  so `nonEvictable ≈ 3802 > 3640` and even the hard gate would return `tooLarge`. Under the
  gate's own 0.8951 calibration the pair is 2420 + 641 = 3061 MiB, so the gate's repack line
  (2994) under-prices the real anonymous weights by ≈67 MiB (~2%) — it charges the projector as
  a repack copy (574) when the engine allocates it as plain anon (641). Neither reading makes
  the refusal a false positive; the 1.00× reading makes the gate too lenient, not too strict.

---

## 2. The repack

**What it is.** llama.cpp's ARM weight-repack keeps a second, anonymous, layout-optimised copy
of the mapped weights. The JS flag is inverted: `no_extra_bufts = !repack`
(`loadPolicy.ts:71`, `:83`). `LlamaService.ts:2381` writes it into `ContextParams`:

```ts
// True → skip the anonymous repack buffer (~file size of extra RSS).
no_extra_bufts: load.noExtraBufts,
```

(`src/engine/LlamaService.ts:2380-2381`). Native side: when extra bufts are on, the CPU buffer
list gains the repack buffer type — `make_cpu_buft_list(...)` at
`node_modules/llama.rn/vendor/llama.cpp/src/llama-model.cpp:1095`
(`if (use_extra_bufts) { … ggml_backend_dev_get_extra_bufts … }`). Each repackable tensor is
then allocated in that type, and the buffer itself is a plain anonymous CPU allocation:

```cpp
static ggml_backend_buffer_t ggml_backend_cpu_repack_buffer_type_alloc_buffer(
        ggml_backend_buffer_type_t buft, size_t size) {
    ggml_backend_buffer_t buffer = ggml_backend_buft_alloc_buffer(
        ggml_backend_cpu_buffer_type(), size);
```

(`node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-cpu/repack.cpp:5374-5376`; buffer name
`"CPU_REPACK"` at `:5365-5368`).

**Why.** The JS default is `{mmap:true, repack:true}` and neither registry entry overrides it
(`loadPolicy.ts:33`; no `loadPolicy` key in either `ModelRegistry` entry). The repack is on
because it is the shipping default, not because a measurement asked for it here.

**Is it avoidable for a 4B on a mid-RAM device?** Mechanically yes: set `repack:false` for
`qwen3.5-4b` (or resolve it from device pressure). The estimator already models the post-change
state with one flag. The load-policy comment calls mmap the "CORRECT configuration, not a
compromise" (`loadPolicy.ts:20-26`), and llama.cpp's own default is `use_mmap = true` with repack
opt-in. The cost is performance: repack exists to make CPU `mul_mat` faster, so `norepack` is a
non-shipping-config measurement per the record's own caveat. It is avoidable; whether it should
be the *product* default needs a device tok/s + major-fault measurement (§8).

**The 20/09 evidence fits this mechanism.** The record's `disposedResident:false` means no
resident engine was disposed (`loadGate.ts:190-193`: `residentModelId === null` skips the
dispose block), so it is not evidence of a leak. The stronger reading is the force-stop delta:
the record states that force-stopping the app "freed the resident LFM and lifted MemAvailable to
~5 GB", i.e. ~+1.35 GB from a 3.65 GB baseline. LFM's own repack estimate is 1360.6 MiB
(§1.5, 1.5939 GB file × 0.8951). The match is near-exact, which says the 3.65 GB reading was
itself depressed by kalsa's *anonymous* repack — the same term that then refuses Qwen. This is
inferential; it uses the record's readings, not a fresh measurement.

---

## 3. Eager vision — confirmed on the current tree

Both text-chat load sites pass the projector unconditionally when the model has one, and
`initMultimodal` is mandatory:

```ts
const mmprojPath = model.mmproj ? modelLocalPath(model, model.mmproj.file) : null;
```
`src/app/AppShell.tsx:4298` (ensure/chat path) and `:4870` (download path)

```ts
initEngine(modelLocalPath(model, model.file), model.id, {
  mmprojPath,
```
`src/app/AppShell.tsx:4359-4360` (and `4985-4986` on the download path)

```ts
const isMultimodal = Boolean(options.mmprojPath);          // LlamaService.ts:2363
if (isMultimodal && options.mmprojPath) {                  // :2675
  enabled = await context.initMultimodal({ path: options.mmprojPath, use_gpu: Platform.OS === "ios",
    image_max_tokens: 512 });                              // :2686-2694
  ...
  if (!enabled) { await disposeEngineLocked(); throw new Error(withNativeTail(strings.errors.visionInitFailed)); }
```

There is no image-present condition anywhere on the path. `initMultimodal` itself throws when a
governor is active (`node_modules/llama.rn/cpp/rn-llama.cpp:1093-1099`) and therefore the engine
disables the governor whenever an mmproj is passed: `governorLoad` requires
`!options.mmprojPath` (`LlamaService.ts:2316`). Vision also forces `ctx_shift: false`
(`LlamaService.ts:2396`).

**Footprint.**
- Projector weights: `672 423 616 B = 641.28 MiB` (`ModelRegistry.ts:198`). These are read into
  **anonymous default CPU buffers**, not mmap'd and not repacked: the clip loader allocates
  `ggml_backend_get_default_buffer_type(ctx_clip.backend)` and reads the file into it with
  `fin.read(reinterpret_cast<char*>(cur->data), num_bytes)`
  (`vendor/llama.cpp/tools/mtmd/clip.cpp:3600-3626`). There is no `mmap`/`host_ptr` path in
  `clip.cpp` (grep returns none). So the projector is 641 MiB of un-reclaimable anon memory.
- Vision compute: `clip_init` runs `warmup` at multimodal init
  (`clip.cpp:3963-3980`; `warmup` size at `:1831-1834`, `:3664`), and the per-encode graph
  buffer is allocated from `buf_compute_meta` (`clip.cpp:267-268`). This work happens inside
  `initMultimodal`, i.e. inside the load, before any post-load `MemAvailable` sample. The gate
  never prices a distinct vision-compute term; its `computeMiB = 249` is the LLM term
  (`memoryEstimate.ts:35`).

**Net accounting for the projector.** The gate charges it as part of `weightsMiB` and then
applies `REPACK_FRACTION`: `0.8951 × 641.3 = 574.0 MiB` of "repack". The engine allocates
641.3 MiB of plain anon instead. Net error ≈ −67 MiB (the gate slightly *under*-prices the
projector), so eager vision is not a gate overcount in net. It is a real 641 MiB anonymous cost
plus un-priced vision compute plus the loss of the governor path.

---

## 4. Swap / zram

**`grep -rn -i "zram\|swap"` over `src/`** returns 76 lines at the current tree (and at
`809d191`), not ~0. The literal string `zram` returns 0 lines (`grep -rn -i "zram" src/` is
empty). The 76 lines break down as:

- real VmSwap/swap code: `src/engine/memoryPressure.ts` (`SWAP_DISTRESS_BYTES` at `:109`,
  `swapGrewBy` at `:119`, `isSwapDistressed` at `:151`, `VmSwap` parse via
  `parseStatusKbField`), `src/hooks/useProcessHealth.ts` (`:3`, `:100`, swap baseline),
  `src/engine/monitor.ts` (`getProcessMemorySampleUncached`), `src/engine/__tests__/memoryPressure.test.ts`;
- swap diagnostics in UI: `src/screens/SettingsScreen.tsx:1030-1039`;
- false positives where "swap" means exchanging one thing for another:
  `src/engine/LlamaService.ts`, `src/engine/threadProfile.ts`, `src/chat/historyWritePolicy.ts`,
  `src/research/deepResearch.ts`, `src/theme/icons/BrandIcon.tsx`.

**How `MemAvailable` is read.** `parseMemAvailableBytes` matches only `^MemAvailable:`
(`src/engine/memoryEstimate.ts:255-262`). There are two readers:

- `getAvailableMemoryBytes()` (`memoryEstimate.ts:289`) — **cached for process lifetime**
  (`let cachedAvailableBytes`, `:269`; set at `:312`). Its own header says it must not be used
  for live decisions; `monitor.ts:5-8` repeats this.
- `getAvailableMemoryBytesUncached()` (`src/engine/monitor.ts:55`) — fresh `/proc/meminfo` read.
  Live decision paths use this: `AppShell.tsx:3931` injects it into `gateModelLoad`,
  `AiChatPage.tsx:2031` (send/regen fit), `AppShell.tsx:3443` (foreground fit banner),
  `SettingsScreen.tsx:1060`, `useProcessHealth.ts:100`.

**Does the gate see swap?** No. `decidePreSendFit`/`evaluateModelFit` receive only
`availableBytes`; `parseMemAvailableBytes` reads no `SwapTotal`/`SwapFree` field, and
`grep -rn "SwapTotal\|SwapFree" src/` is empty. `MemAvailable` is affected by swap pressure
indirectly, but the gate never adds zram capacity to its budget and never subtracts the swap it
is already using. The app's swap awareness lives only in the Settings diagnostic
(`SettingsScreen.tsx:1025-1039`, mounted from Settings alone: `useProcessHealth` is imported at
`SettingsScreen.tsx:82`; `AppShell` imports only `setProcessUnloadedReason` at `:189`). It is a
reported number, never a gate.

**Under pressure.** `memoryPressure.ts:1-17` states the load-vs-run distinction: `MemAvailable`
is valid pre-load but invalid as running headroom, because a mapped model's resident pages are
counted by `MemAvailable` as reclaimable page cache; `residentHeadroomBytes = MemAvailable −
RssFile` (`:93`) is the diagnostic correction, explicitly "not validated against a collapse
yet… never a gate" (`:73-86`). `SWAP_DISTRESS_BYTES = 256 MiB` (`:109`) is the growth treated
as distress, from the one measured case where VmSwap went 26 MB → 1.02 GB while the process
looked thin and was killed anyway (`:105-107`). The platform behaviour behind this is documented
in the lab recon (`reports/research-hyperos-ram.md`): HyperOS zram plus vendor writeback
("Memory extension", `persist.miui.extm.*`) evicts anonymous pages to UFS, so a major fault can
be a flash read rather than an in-RAM decompress; reclaim shortfall is handled by kswapd
compressing into zram and by PSI-driven `lmkd` kills. The app itself does no reclaim and never
calls `mlock` deliberately (`use_mlock: true` at `LlamaService.ts:2375` becomes
`LLAMA_LOAD_MODE_MMAP_MLOCK` via `node_modules/llama.rn/cpp/jsi/JSIParams.cpp:347-360`; with
Android's small `RLIMIT_MEMLOCK` the mlock normally fails with a warning and the mapping stays
evictable — but where it succeeds, the estimator's "mapped weights are evictable" assumption
breaks).

---

## 5. The two hypotheses

### H1 — kalsa's own footprint (repack + eager vision) is the cause

**Supported.** The gate arithmetic reproduces the refusal from these two terms alone (§1.4,
§1.5). The term that tips it is the repack, not the model: a text-only Qwen load with repack ON
still refuses. The 20/09 force-stop delta (~+1.35 GB) matches LFM's repack (1360.6 MiB), which
says the measured 3.65 GB baseline is itself a gate input depressed by an anonymous kalsa
allocation. Eager vision is confirmed on the current tree (§3) and adds 641 MiB anon plus
un-priced vision compute.

**Measurement that would settle it.** On the Xiaomi, load Qwen with `norepack=1` and sample
`/proc/<pid>/status` (`RssAnon`, `RssFile`, `VmSwap`) plus `/proc/meminfo` `MemAvailable` at
three points: app-idle, post-load-pre-decode, and post-first-token. Predictions from H1: with
repack off, `RssAnon` ≈ 457 MiB + vision compute and `MemAvailable` stays near the app-idle
value (the record saw ~4.9 GB); with repack on it would not load at all. A repeat with the
projector absent (lazy-vision build) should drop `RssAnon` by ~641 MiB at constant context.
`dumpsys meminfo` `ZRAM:` and `/sys/block/zram0/bd_stat` alongside the process sample separate
"the app holds it" from "the kernel compressed it".

### H2 — something else (gate misestimate / double count, leak, cached polling, `disposedResident:false`, anti-OOM watcher)

**Largely unsupported by the code, with two real but non-causal defects.**

- *Gate misestimate / double count.* The gate prices exactly the configuration the engine loads
  (same `resolveGateLoadPolicy` on both sides, `deviceProfile.ts:449` vs `LlamaService.ts:2249`).
  Two arithmetic quirks exist and both push the same way: (i) `REPACK_FRACTION` is calibrated on
  a 2B (`memoryEstimate.ts:45-56`), and the record's own 4B Q3 measurement is 1.00× not 0.895×,
  so the real repack may be larger than priced; (ii) the projector is priced as repack when it is
  anonymous, a ≈67 MiB under-charge. Neither explains a false refusal; if anything the gate is
  slightly optimistic. There is no double count of resident bytes on the load path: the same-model
  case returns early (`loadGate.ts:190-193`), and a foreign resident is disposed first (`:196-215`).
- *`disposedResident:false`.* Explained by `residentModelId === null` — no engine was resident at
  gate time (`loadGate.ts:192`). It is not a leak signature. The subsequent "silent" LFM is the
  designed one-hop fallback (`AppShell.tsx:4201-4232`, `pickFallbackModel` at
  `src/engine/loadMarker.ts:104`, never the refused model, never a marked one).
- *Uncached MemAvailable polling.* The live gates use the uncached reader. The stale one is used
  by the **hard** gate: `buildDeviceProfile` stores `getAvailableMemoryBytes()` (the cached
  reader) at `deviceProfile.ts:653-654`, and `gateForModel`/`resolveGateContextTokens` consume
  `profile.availableMemoryBytes` (`AppShell.tsx:552`, `deviceTuning.ts:685`). That can make the
  *priced context* reflect a stale budget, but the fit comparison at `deviceProfile.ts:480-488`
  uses the fresh injected value. It is a correctness bug to fix, not the cause of this refusal.
- *Leak.* No code path retains a disposed context: `disposeEngineLocked` nulls
  `context`, `activeModelId`, `activeMmprojPath` (`LlamaService.ts:2782-2790`), and a bounded
  dispose that times out refuses rather than stacking (`loadGate.ts:205-213`).
- *Anti-OOM watcher.* `startMemoryMonitor` polls every 15 s and only logs
  `pressure.transition` and manages background grace (`AppShell.tsx:3330-3390`); it never
  unloads the foreground engine and never refuses a foreground load. Its foreground branch
  (`:3443-3460`) only sets a banner and an unloaded reason for Settings. It cannot be the cause.

**Measurement that would settle it.** Same process sample as H1, plus `dumpsys meminfo` for
system/app split and `am memory-limiter status`. If `RssAnon` post-load matches the priced
non-evictable term within ~10%, the estimator is honest and H2's misestimate reading dies. A
leak would show as monotonic `RssAnon` growth across N load→dispose cycles; the 20/09 session
did not cycle enough to test that and the current artifacts cannot.

---

## 6. Baseline

**Is ~3.65 GB normal?** The device-side reading is real but it is not "the OS alone". The record
shows the same phone at ~5 GB `MemAvailable` after force-stopping the app, and closing three
foreground apps moved the reading only ~60 MB (`3.65 → 3.71 GB`). Two independent statements
follow: (a) MIUI/HyperOS keeps a large resident set (the lab recon measures ~5.4 GB occupied on
an 11.4 GB device and warns "do not expect +4 GB from turning zram off"), and (b) the specific
3.65 GB number was taken with the app running and (by the force-stop delta) probably with LFM's
repack resident. The honest baseline range for this ROM is roughly **5 GB app-free, 3.6 GB with
the previous model resident**, and the gate is asked to fit Qwen into the second number. A fresh
`/proc/meminfo` at three states — app force-stopped, app foregrounded with no model, model
resident — would settle which. The Xiaomi is not attached, so that cannot be done now.

**What the app's anti-OOM code assumes.**

- Load-time fit: library-configurable `FIT_HEADROOM_MIB = 512` (`memoryEstimate.ts:73`), on top
  of non-evictable; `tight` = within 512 MiB or total > available (`:223-236`). Headroom is
  anchored to 2× the 249 MiB compute term, not to a RAM fraction.
- Send/regen/load refusal: `availableBytes < 1.5 × requiredBytes` on `tight`
  (`deviceProfile.ts:480-488`). This is the line that refused Qwen.
- Hard Settings/download gate: `nonEvictable > available` only (`deviceProfile.ts:183-198`).
- Running-process diagnostics: `residentHeadroomBytes = MemAvailable − RssFile`
  (`memoryPressure.ts:93`), `SWAP_DISTRESS_BYTES = 256 MiB` (`:109`), `majfltGrewBy`; surfaced in
  Settings ("…MiB headroom · swap +N MiB · majflt +N", `SettingsScreen.tsx:1030-1044`).
  Diagnostic only.
- Background/idle: `backgroundDiscardPlan` + grace; `addTrimMemoryListener`
  (`AppShell.tsx:3495`). No foreground threshold unload.

The recon recommends 1.0–1.5 GiB headroom on HyperOS (`reports/research-hyperos-ram.md`,
"Product-side recommendation"), which is larger than the app's 512 MiB. That mismatch is a
plausible reason the `tight` band is too permissive on this device — but it does not change the
`tightNow` refusal, which the 1.5× ratio already forced.

---

## 7. Fix options, ranked

Nothing here is implemented. Blast radius is the set of behaviours that can regress.

### Rank 1 — Memory-aware repack (per-model or per-pressure `loadPolicy`)

- **Where:** add `loadPolicy: { mmap: true, repack: false }` to the `qwen3.5-4b` entry
  (`src/engine/ModelRegistry.ts:183-238`), or resolve it dynamically from
  `profile.availableMemoryBytes` in `resolveGateLoadPolicy` (`src/engine/loadPolicy.ts:88`).
  Both gate and engine already honour it (`deviceProfile.ts:449`, `LlamaService.ts:2249-2262`,
  params at `:2379-2381`).
- **Effect:** removes the 2994 MiB repack term. Qwen goes `tightNow → allow` (457 MiB
  non-evictable; `total` 3802 > 3640 keeps a non-blocking `tight` on the total-only branch,
  `memoryEstimate.ts:232`). The record's `norepack=1` run is direct evidence this loads.
- **Blast radius:** decode speed — repack is the ARM-optimised `mul_mat` path, so this may cost
  tok/s and raise major faults (with `mmap` on those are file-cache refaults, not flash swap).
  Small code surface; the runtime risk is real and must be measured, per the record's
  "non-shipping config" caveat. Do not ship a global default without the measurement; a
  per-model entry for the 4B is the conservative form.

### Rank 2 — Lazy vision (load the mmproj only when an image is attached)

- **Where:** make `mmprojPath` conditional in `AppShell.tsx:4298`/`:4359-4360` and
  `:4870`/`:4985-4986`; rework `isMultimodal`/`initMultimodal` into a load-on-first-image step
  (`LlamaService.ts:2363`, `:2675-2700`), adjust `isEngineReady()`'s `activeMmprojPath !== null`
  requirement (`:2094`), the `ctx_shift` decision (`:2396`), and the governor exclusion
  (`:2316`, which would otherwise start working for Qwen).
- **Effect:** removes ~641 MiB anon (projector) + vision compute from text loads, re-enables the
  governor for text, and drops the non-evictable term to 2877 MiB. **Alone it does not clear the
  gate with repack ON** (§1.5) — it is necessary for a clean fit but not sufficient.
- **Blast radius:** engine lifecycle and readiness, KV/session restore, the chat-vs-image state
  machine, and first-image latency. Medium–high; touches the load path that every model uses.

### Rank 3 — Unify the live memory number (correctness, low risk)

- **Where:** `buildDeviceProfile` caches the process-lifetime reader
  (`deviceProfile.ts:653-654`, `memoryEstimate.ts:289`), while the load gate uses the uncached
  one. Feed the fresh value into `gateForModel`/`resolveGateContextTokens`
  (`AppShell.tsx:534-558`, `deviceTuning.ts:672-690`) or refresh the profile's available value
  before gating.
- **Effect:** the priced context and the hard gate stop using a boot-time `MemAvailable`. Does
  not change the observed refusal by itself.
- **Blast radius:** low; the resolver is pure and already accepts the value as input.

### Rank 4 — Review the `1.5 ×` tight rule (diagnostic, not a recommended fix)

- **Where:** `deviceProfile.ts:480-488`. This is the exact predicate that returned `tightNow`.
- **Effect:** loosening it would admit the Qwen load with ~190 MiB of slack and repack ON. That
  is very likely to thrash or be killed. Keep the rule; use it to explain the refusal, not to
  work around it.

### Rejected — swap-aware gate

Counting `SwapFree`/zram as available for weights would admit a load the kernel then has to
compress, converting the refusal into the flash-writeback thrash the recon documents. The
product view already taken (record §4, recon "Product-side recommendation") is correct and the
code's own `memoryPressure.ts` doc says the same. Do not do this.

### Secondary, code-suggested but not load-changing

- Recalibrate `REPACK_FRACTION` to the measured 1.00× for 4B-class files
  (`memoryEstimate.ts:45-58`) so the gate is honest about the repack. This makes refusals
  stronger, not weaker.
- `madvise(MADV_WILLNEED)` prefetch on the mmap region as a controlled-fault alternative to
  `mlock` (recon §4.4); native-side work, needs a device run.
- Expert streaming does not apply: `qwen3.5-4b` has no `canStreamExperts`/`streamingResident`,
  so `shouldStreamExperts` returns false (`expertStreaming.ts:74-130`).

---

## 8. Out of scope / what needs the Xiaomi attached

The Xiaomi is not connected to adb (only the Jelly and the S23 are), so no live number below
could be produced here, and none was fabricated. The measurements that would close this out,
all requiring the Xiaomi, are:

1. `cat /proc/meminfo`, `/proc/self/status` (`RssAnon`/`RssFile`/`VmSwap`), `dumpsys meminfo`,
   `/sys/block/zram0/mm_stat`, `/sys/block/zram0/bd_stat` at four states: app force-stopped,
   app foreground with no model, LFM resident, Qwen resident (norepack).
2. The same set for Qwen with repack ON to observe the refusal path and with repack OFF to
   observe the loading path, plus decode tok/s and `pgmajfault` delta per token. This separates
   "repack off is a viable shipping config" from "it loads but thrashes".
3. A lazy-vision build (or a run with the mmproj file removed) to confirm the 641 MiB `RssAnon`
   delta and that the vision-free load clears the gate only in combination with repack off.
4. `getprop persist.miui.extm.enable/bdsize`, `ro.lmk.use_psi`,
   `ro.lmk.swap_free_low_percentage` to fix the zram/writeback baseline for this ROM.

Until then, the honest statement is narrower than the 20/09 record's: on the current tree the
gate prices exactly what the engine loads, the load includes a ~2994 MiB anonymous repack of a
3345 MiB bundle, and that repack — not the model — is what exceeds the device's 3640 MiB
`MemAvailable` under the gate's own 1.5× rule.

---

## Appendix — evidence index

| fact | source |
|---|---|
| working tree `src/` == `origin/main` (only `745bf82` ahead, scripts only) | `git diff --stat origin/main..HEAD` = `scripts/device-ciswire-cache.sh` |
| gate only file changed since `809d191` | `git log 809d191..origin/main -- src/engine/...` = `50b8196` |
| swap/zram count in `src/` (76; zram literal 0) | `grep -rn -i "zram\|swap" src/`; `grep -rn -i zram src/` |
| gate path | `AppShell.tsx:3890,3904,3929`; `loadGate.ts:158,217,219`; `deviceProfile.ts:449-488` |
| estimator | `memoryEstimate.ts:35,51,73,95,129-168,192-236,255-262,289` |
| default load policy | `loadPolicy.ts:33,60,71-83,88-101` |
| registry entries | `ModelRegistry.ts:183-238,241-273` |
| context upgrade | `contextProfile.ts:9,10,62,79,159-206`; `deviceTuning.ts:244,247,527,672` |
| repack native allocation | `vendor/llama.cpp/src/llama-model.cpp:1095`; `ggml/src/ggml-cpu/repack.cpp:5365-5376` |
| eager vision | `AppShell.tsx:4298,4359-4360,4870,4985-4986`; `LlamaService.ts:2363,2396,2675-2700,2094,2316` |
| projector anonymous | `vendor/llama.cpp/tools/mtmd/clip.cpp:3600-3626`; `rn-mtmd.hpp:730` |
| hard gate vs fit gate | `deviceProfile.ts:140-198` vs `:464-488` |
| cached vs uncached MemAvailable | `memoryEstimate.ts:289` vs `monitor.ts:55`; `deviceProfile.ts:653-654` |
| swap diagnostics | `memoryPressure.ts:93,109-153`; `useProcessHealth.ts:3,100`; `SettingsScreen.tsx:1025-1044` |
| fallback to LFM | `AppShell.tsx:4201-4232`; `loadMarker.ts:104` |
| 20/09 device readings and logcat | `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` §1, §4 |
| HyperOS zram / extm / lmkd context | `reports/research-hyperos-ram.md` §0-§3, Product-side recommendation |
