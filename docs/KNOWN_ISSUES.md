# Known issues

## P0 — memory guard blocks completion with the model already loaded (HyperOS flagships)

**Found:** 2026-08-14, Xiaomi 14 (HyperOS, SD8Gen3), Qwen3.5-4B Q4_K_M, APK `bea257e` (main + TTFT-v2).
**Evidence:** `moe-experiments/results/ttft_4b_xiaomi/manual_1a/logcat_send_oom.txt`.

Sequence (device timestamps):

1. Cold launch: `model.fit {"verdict":"tight","availableMb":5596}` → model loads fine,
   prewarm completes (`KALSA_PREWARM done`, 30-50 s, 1179 tok).
2. With the 2.7 GB model resident, HyperOS settles `MemAvailable` at ~2.1 GB
   (`pressure.transition {"availableMb":2079..2176}` every 15 s — this is normal on
   MIUI/HyperOS: the OS keeps the rest as reclaimable cache).
3. User taps Send → app shows **"not enough memory for this model"** and never calls
   the engine (no `loadPrompt`, nothing in logcat from RNLlama).

**Root cause (hypothesis, high confidence):** the send-path fit-check compares
`availableMb` (~2.1 GB) against the model footprint (~2.7 GB) **without checking that
the engine already holds this model** — the model's own resident bytes are what
lowered `availableMb`. Double-counting. The pre-load fit-check logic is being applied
where the load has already happened.

**Fix direction:** when `isEngineReady() && activeModelId === requested`, the
completion path must skip the size-vs-available check entirely (or check only the
incremental need: KV/compute buffers). Pre-load checks stay as they are.

## P1 — idle engine unload leaves zombie UI ("Ready" header, dead Send, silent JS)

Same session, ~10 min idle after a completed prewarm: app process alive but RSS
dropped 3 GB → 167 MB (engine/model gone), header still "Qwen 3.5 4B · Ready ·
local", Send taps (including physical finger taps) produce **zero** ReactNativeJS
logcat output, composer still accepts text. Force-stop + relaunch recovers.

**Code-level fix (2026-08-14, `fix/p1-idle-zombie`):** JS `isEngineReady()` was
only `context !== null` — HyperOS can reclaim the native heap without going
through `disposeEngine` (no `onTrimMemory`; background dispose would have left
Ready). Send had no breadcrumb before the busy-guard / first await, so a hung
native call or a stuck `sendClaimRef` produced zero logcat. Fix: RSS-vs-baseline
liveness probe on foreground + send; `markEngineLost` drops the JS wrapper
without native `release()`; header leaves Ready; send recovers via
`ensureEngineForModel` (`recoverLost` skips the leftover-MemAvailable refuse).
Every send attempt logs `KALSA_SEND`.

**On-device verify still required** (Xiaomi/HyperOS not in hand):
1. Cold load 4B, wait for prewarm done, confirm header Ready · local.
2. Idle ~10 min (or until RSS collapses); confirm chip leaves Ready (reload
   affordance) on foreground, and `engine.lost` in logcat.
3. Type + Send: one `KALSA_SEND` line, then load progress, then a real
   completion (not "not enough memory").
4. Confirm a second send after recover still works (prewarm re-queued).

## Note for automated testing on HyperOS

Synthetic `input tap` (deviceId=-1) is silently dropped by HyperOS unless
"USB debugging (Security settings)" is enabled in Developer options — physical taps
(deviceId=7) work. All three automation attempts tonight failed on this, not on app
code. Enable that toggle on test devices, or drive taps through uiautomator/Appium
with an accessibility channel.
