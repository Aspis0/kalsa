# RECON — admission pause + missing KALSA_TELEMETRY (S23, app 67ade7a8 / engine 8eac584bb / binding 463f11f9)

Read-only. No code changed. Every claim carries file:line.

## 0. What the capture actually shows

- Only **one native completion ran in the whole capture**: the static-prefix prewarm at
  `raw/logcat-session.txt:334016` (`loadPrompt:501 prompt_n=1812`), which died at
  `raw/logcat-session.txt:334020` (`nextToken:1717 failed to eval, n_eval: 2, n_past: 0`).
  `grep -c "loadPrompt:501"` over the 47 MB logcat = 1.
- The same millisecond: `raw/logcat-session.txt:334019` —
  `KALSA_NATIVE warn admit_prefill: no safe prefill chunk under the thermal ceiling; pausing`,
  and `raw/logcat-session.txt:334021` — `KALSA_PREWARM {"op":"skip","reason":"eval-failed",...}`.
- Battery temp at that instant: `raw/logcat-session.txt:334006` —
  `12:28:08.665 HeatmapThread: batteryLevel : 54  batteryTemperature : 378` → **37.8 °C**, unplugged
  (`batteryplugType : 0`, same line). It sat at 37.9 °C at 12:26–12:27 (`raw/logcat-session.txt:327803`,
  `:328678`) and 37.7–38.4 °C for the rest of the session (`raw/session-end.txt` ACTION_BATTERY_CHANGED
  samples 37.7/37.3/37.7/38.4/38.2).
- `grep -c KALSA_TELEMETRY logcat-session.txt` = **0**; `KALSA_STALL` = 0; `KALSA_GOVERNOR_FALLBACK` = 0.
  After `raw/logcat-session.txt:334021` there are **zero** ReactNativeJS/RNLlama lines until the idle
  unload `raw/logcat-session.txt:338415` (`'model.unload', {"reason":"idle","idleMs":180386}` at 12:31:01),
  and zero after that. No chat turn ever reached the engine.

## 1. Engine: why `admit_prefill` returns Wait

### The exact return path

- `src/llama-governor-runtime.cpp:46-51` calls `policy_.admit_prefill(requested, batch.n_tokens,
  policy_.current_temperature_c())`; on `Wait` it prints the observed message and returns **-2**
  (`src/llama-governor-runtime.cpp:52-57`, warn at `:56`). The comment at `:53-55` is explicit:
  "Reducing tokens is the only allowed fallback; never switch to another engine. Pause this turn."
- Caveat: that message is printed for **any** top-level Wait, including the early return at
  `src/llama-governor-policy.cpp:199-205` (no profile yet → state Unknown → Wait; Invalid/CRITICAL →
  Abort instead, which would log `fail("prefill admission aborted")`). The message therefore
  over-claims "thermal ceiling" for the no-profile/LOWBAT cases too.

### The inputs

| input | where | value/behavior |
|---|---|---|
| temperature source | `src/llama-governor-policy.cpp:23` (`batt_temp_tenths_c / 10.0f`) | **battery** temperature, Android tenths. Read by the app via `NativeModules.GovernorBattery.readThermo()` (`src/engine/governorInputs.ts:270-272`), pushed at load (`src/engine/LlamaService.ts:2349-2374` → `cpp/jsi/RNLlamaJSI.cpp:1215`) and refreshed before every completion (`src/engine/LlamaService.ts:4920-4922`, `:1747-1780` → `cpp/jsi/RNLlamaJSI.cpp:847`). Bench override key `kalsa.bench.thermo` can substitute a "bench-skin" profile (`src/engine/governorInputs.ts:8`, `:257-263`). |
| ceiling constants | `src/llama-governor-policy.cpp:10-11` | `k_warn_c = 40.0f`, `k_limit_c = k_warn_c - 0.5f` = **39.5 °C**, fixed for plugged and unplugged. `admission_margin_c` is only schema-checked to 0.5 (`:19`), never read by admission. |
| per-chunk heat model | `src/llama-governor-policy.cpp:14-15`, applied at `:211-213` and `:215-216` | rows `{128, 512, 1024, 2048}` tokens, deltas `{1.9, 3.25, 3.25, 5.15}` °C. A row survives only if `now_c + delta <= 39.5`. |
| t_idle / plugged baseline | `src/llama-governor-policy.cpp:42-51` (`get_thresholds`), `:99-115` (reference latch), `:118` (`hot_plugged_`) | **Does not enter admission at all.** t_idle only shapes state-classification thresholds while plugged (`:47-51`) and profile validity (`:53-66`); the unplugged thresholds are fixed `{warm 38.0, cool 39.5, critical 42.0}` (order per `src/llama-governor-policy.h:45-52`). |
| thermal state gate | `src/llama-governor-policy.cpp:199-205` | Only Invalid/CRITICAL abort; Unknown/LOWBAT → Wait (same message). WARM/COOLMODE/FAST do not block admission. |

### The values that produce the pause at ~37 °C

- Row selection (`src/llama-governor-policy.cpp:207-213`): the smallest row 128 survives iff
  `now_c + 1.9 <= 39.5`, i.e. **now_c <= 37.6 °C**. At 37.8 °C (`raw/logcat-session.txt:334006`)
  `37.8 + 1.9 = 39.7 > 39.5` → table empties → tail rule at `:214-222` needs `prompt < 128` **and**
  `now_c + 1.9 <= 39.5` → also fails → `Wait`. The observed failing batch was n_eval=2
  (`raw/logcat-session.txt:334020`; prefill batches are `n_tokens > 1`, `src/llama-governor.cpp:247`),
  so even a 2-token batch pauses once `now_c >= 37.7`.
- So: **any battery temp ≥ 37.7 °C ⇒ every prefill pauses**, regardless of prompt size, plugged state,
  or requested engine. (For prompts ≥ 512 the table already degrades to 128-token chunks above
  36.25 °C, because rows 512/1024 need `now_c <= 39.5 − 3.25 = 36.25`.)
- At 37.8 °C the state itself was FAST (`classify`, `src/llama-governor-policy.cpp:69-80`, unplugged
  warm_enter 38.0), so nothing else was blocking.

### Measured or default?

- **Default constants.** `k_warn_c/k_limit_c/k_table_tokens/k_cpu_delta_c` were introduced wholesale in
  `40051f8ae` (2026-09-03, "feat(governor): implement tri-engine runtime contract v0.2" — message
  carries no measurement provenance; `git show 40051f8ae` adds them verbatim) and the tail rule in
  `6f0a33c0d` (2026-09-04, "fix(governor): admit safe final prefill tails"). `git log -S k_cpu_delta_c
  -- src/` returns only those two commits — the heat table has **never been recalibrated**. Contrast
  `prefill_engine()`, which cites measured evidence (ALIVE #38) at `src/llama-governor-policy.cpp:169-170`;
  the ceiling/heat table has no such comment. Also note `k_cpu_delta_c` gates GPU prefill too — the
  table is engine-blind.

### What changed in `b0d5dbd2c~15..8eac584bb`

- Only three commits in that range touch `src/llama-governor*`:
  - `b0d5dbd2c` (09-24 09:43) — battery floor `batt<45` now only when unplugged, in `prefill_engine()`.
  - `c0dad89c0` (09-24 10:50) — battery floor removed from `prefill_engine()` and `select_decode()`;
    LOWBAT restricted to unplugged.
  - `8eac584bb` (09-24 11:13) — CRITICAL recovery re-enters LOWBAT when unplugged and <25 %.
- **None of them changes admission.** `admit_prefill` never looks at battery level or plug state
  (`src/llama-governor-policy.cpp:195-236`), only `now_c` and `prompt_tokens`; the floor only changed
  *which engine is requested* (`prefill_engine()`, `:160-166`), and the Wait path is engine-independent.
  At 54 % battery the old `batt < 45` floor would not have fired anyway.
- The plugged/idle-baseline commits (`61db879b8`, `a7d2cec79`) are **older than the requested range**
  and only apply to plugged sessions; t_idle never reaches admission.
- The commit that actually turned heat refusal into a dead turn is **outside the range**:
  `f2073505e` (2026-09-21, "governor : pause hot prefill instead of routing it to CPU (defect 5.1)") —
  before it, Wait routed the turn to CPU and ran (`git show f2073505e`, diff removes the
  `prefill_route_ = CPU; return 0` branch); after it, Wait returns -2. Slow-but-working became
  silent-stop.

## 2. Binding and app behavior on pause

### Binding

- `cpp/rn-governor.h:16-18`: `governor_decode_failed(rc, engine_failed) = rc != 0 && (rc != -2 || engine_failed)`
  → -2 is a **pause, not a failure**: `cpp/rn-governor.cpp:51-63` returns -2 without latching
  `failure_reason_`, and `cpp/rn-llama.cpp:672-684` logs `KALSA_GOVERNOR_FALLBACK` only for real
  failures — hence 0 fallback lines in the capture.
- `cpp/rn-completion.cpp:1709-1721`: the caller treats any non-zero decode as an eval failure —
  `LOG_ERROR("failed to eval, ...")` (`:1713`), `embd.resize(n_past)`, `has_next_token = false`, return.
  Generation stops immediately; the completion **resolves** (not rejects) with a result whose
  `tokens_evaluated` is the planned prompt length and `tokens_cached` 0.

### App

- Prewarm path (what actually ran): resolved result classified by
  `src/engine/prefixPrewarm.ts:384-399` — `tokensEvaluated(1812) > tokensCached(0)` → `"failed"` →
  logged at `src/engine/LlamaService.ts:1364-1370` (the observed `eval-failed` line) and counted as a
  **persistent** failure (`src/engine/LlamaService.ts:1351-1352`,
  `src/engine/prefixPrewarm.ts:462-466`), giving up after 2 failures
  (`src/engine/prefixPrewarm.ts:450`). No retry of the paused prefill itself.
- Chat path (never reached here): a completion that resolves after a paused prefill would still pass
  `src/engine/LlamaService.ts:5037` (`if (aborted) return;`) and **would** emit `KALSA_TELEMETRY` at
  `src/engine/LlamaService.ts:5046` (tool rounds `:5436`) with 0 tokens, then
  `emitGovernorTelemetry` (`:5114`) and `emitFinalText` (empty). The only user-visible failure path is
  `src/host/engineTurnStream.ts:253-271` (rejections only → `chat.serviceUnreachable`); a resolved
  empty result shows **no error**. Engine-side there is no resume, no in-turn retry, no CPU fallback
  (`src/llama-governor-runtime.cpp:53-55`); -2 is non-latching so the *next* attempt simply re-runs
  admission (`cpp/rn-governor.cpp:51-63`), which succeeds only below 37.7 °C.

### Why the sends produced no telemetry line

1. **No completion ever ran after 12:28:08.742** — zero `loadPrompt`, zero admission warns, zero
   ReactNativeJS lines until the idle unload (`raw/logcat-session.txt:338415`); after 12:31:01 the model
   was unloaded, so any dispatched send would have logged a reload — none. Telemetry is emitted only
   after a completion resolves (`src/engine/LlamaService.ts:5046`), so no completion ⇒ no line.
2. Therefore the silence is **upstream of the engine**, i.e. the send never reached
   `engine.completion`. Candidates, all silent by design:
   - `src/host/sendHost.ts:141-149` — early `return` (no log) on empty draft, held `sendClaimRef`,
     `sendingRef`, in-flight translation, or `!historyLoadedRef.current`.
   - `src/host/engineTurn.ts:113-133` — `fail()` shows a ⚠️ delta but **no console log** (so it would
     be invisible in logcat); however it requires Android thermal status ≥ 4
     (`src/engine/thermalHardGate.ts:32`, `:44-47`) and the session observed status 0–1
     (`raw/session-end.txt`, `raw/final-device-state.txt`) → not the cause here.
   - Composer/IME dispatch trouble: 5 `Fabric View [-1] ... SurfaceId` exceptions at
     `raw/logcat-session.txt:342280, 343252, 344450, 345121, 354376` (12:34–12:38) and the whole
     IME-probe evidence set (`raw/composer-focus-probe-ime.txt`, `raw/ime-state-current.txt`,
     `raw/window-ime-state.txt` — `mInputShown=false`, `mServedView` a `ReactViewGroup`).
3. Independent of dispatch: at the observed temperatures (37.7–38.4 °C, `raw/session-end.txt`) a send
   *would* have re-paused anyway at ≥ 37.7 °C; only the 12:34 dip (37.3 °C) was below the cutoff.

## 3. S23-only, or any device at ~37 °C?

**Any device.** The cutoff is a hard-coded constant: `k_limit_c − k_cpu_delta_c[0] = 39.5 − 1.9 =
37.6 °C` (`src/llama-governor-policy.cpp:10-15`), identical for plugged/unplugged, all generations,
both engines, and independent of Android thermal status (the app's hard gate keys on platform status ≥ 4
only, `src/engine/thermalHardGate.ts:32`). Preconditions: governor mode (admission runs only under
`policy_enabled_`, `src/llama-governor.cpp:253`), a prefill batch ≥ 2 tokens (`:247`), battery temp
≥ 37.7 °C. The Jelly Star was at 36.5 °C at session start (`REPORT.md`) — 1.1 °C from the same cliff —
and battery sensors commonly idle at 33–37 °C under load, so this is a class-wide failure mode, not an
S23 quirk. (Device variation enters only through the sensor itself and the optional bench-skin
override, `src/engine/governorInputs.ts:257-263`.)

## 4. Smallest candidate fixes (described only) + discriminating data

1. **Engine, one-line-class**: keep a minimum safe row (e.g. admit the 128-row, or a new 32-row) while
   `now_c < k_warn_c` (40.0) instead of requiring `now_c ≤ 37.6`; edit the loop/fallback at
   `src/llama-governor-policy.cpp:211-222`. Cheapest unblock; safety then rests on the 40 °C warn/kill
   constants rather than the 39.5 − delta headroom.
2. **Engine, diagnostic**: include `now_c`, `prompt_tokens`, `state`, `have_profile_` in the warn at
   `src/llama-governor-runtime.cpp:56`, so table-exhaustion is distinguishable from the
   no-profile/LOWBAT Wait of `src/llama-governor-policy.cpp:199-205` (currently one message for both).
3. **Engine, honest model**: replace `k_cpu_delta_c` with measured per-chunk ΔT (battery *and* skin)
   per device class — today the default table (`src/llama-governor-policy.cpp:15`) has no provenance
   and is engine-blind (gates GPU prefill with a `k_cpu_*` coefficient).
4. **Binding/app, visibility**: plumb -2 as a distinct reason (today it collapses into generic
   "failed to eval", `cpp/rn-completion.cpp:1709-1721`) so the app can show "paused — device too warm"
   and schedule a retry; the pause is already non-latching (`cpp/rn-governor.h:16-18`), so a
   temperature-driven re-attempt would need no engine change. Also emit a marker even for resolved
   empty completions so "paused" is not indistinguishable from "no answer".
5. **App, forensics**: add a log at `src/host/sendHost.ts:141-149`'s early return and at turn entry —
   in this capture dispatch-vs-engine is unresolvable from logcat alone.
6. **Not recommended without data**: restoring the CPU fallback removed by `f2073505e` — that commit's
   message documents it as defect 5.1 (CPU was the hottest engine for the whole batch).

**Data that would pick among them**

- `now_c` logged at every admission (confirm 37.8 → Wait; catch the 37.3-°C windows where admission
  would pass). Battery series already in `raw/session-end.txt` is enough for the first check.
- Lab measurement of Δbattery °C vs chunk size (128/512/1024/2048) and engine (CPU vs GPU prefill) on
  S23 and Jelly Star → whether 1.9 °C/128 tok is over-conservative (fix 1 vs fix 3).
- Distribution of steady-state battery temp during chat on both phones (if 37–38 °C is the norm, the
  current ceiling makes the app unusable and fix 1/3 is mandatory, not cosmetic).
- A send-entry JS marker + post-tap uiautomator dump of composer text → which silent guard (or IME)
  ate the sends (fix 5).
- A profile-present flag in the first admission (fix 2) → rules the alternative Unknown-state Wait
  in/out for cold-start cases like 12:28:08.

---

# Send path (why the chat sends never reached the engine)

App `67ade7a8` (contains the UX-line merge `03ba7d6a`; `git merge-base --is-ancestor 03ba7d6a HEAD` = true).

## A. The path, button → native

1. Send control: `src/ui/shell/ShellComposer.tsx:126-131` — `Pressable disabled={!canActivate}`;
   `canActivate = faceEnabled && (face !== "send" || sendEnabled)` (`:65`). A disabled RN Pressable
   never fires `onPress` → **no JS runs, no log is even possible**.
2. `onPress` → `src/host/HostChatSurface.tsx:266-269`: `face === "stop" ? sendHost.stop() :
   void sendHost.send(draft)`.
3. IME Enter: the field has `returnKeyType="send"` (`ShellComposer.tsx:111`) but **no
   `onSubmitEditing`/`onKeyPress` anywhere under `src/ui/shell`** (grep: handlers exist only in
   `src/screens/SettingsScreen.tsx:1937,2048`, `src/screens/AccountSignInPanel.tsx:123`,
   `src/theme/components/DrawerContent.tsx:110`). Field is multiline (`inputType=0x4001`,
   `raw/composer-focus-probe-ime.txt`) → **Enter can never send in this build**; at best it inserts a newline.
4. `sendHost.send` guards: `src/host/sendHost.ts:141-149` — empty draft+no rows, `sendClaimRef`,
   `sendingRef`, `translationInFlightRef`, `!historyLoadedRef` → bare `return;` (`:148`), **no log**.
   Then `runBenchTurn` (`:163`, `bench:`-prefixed text only, `src/host/benchTurn.ts:36-38`), content
   gate (`:172-196`, returns with a visible decline row, no `console.log`), user+assistant rows appended
   (`:226-242`, no log), draft cleared (`:243`).
5. `handleSendStream` (`src/host/engineTurn.ts:55`): thermal backstop `:126-133` → `fail()` (`:113-122`)
   emits a "⚠️" delta + `onFailed` but **no `console.log`** (invisible in logcat); memory-extract wait
   `:158-165` (silent; nothing pending in a fresh process); `ensureEngineForModel` `:167` — with the
   model unloaded this **reloads and logs natively** (failure → `fail()`, again no log).
6. `src/host/engineTurnStream.ts`: prewarm `:100` → first possible marker `KALSA_PREWARM start`
   (`src/engine/LlamaService.ts:1139`, logger `:883`), then the first unconditional per-send marker `KALSA_WINDOW`
   (`engineTurnStream.ts:122`), then `streamAssistantTurn` (`LlamaService.ts:4096`) → native
   `loadPrompt`/admission logs.

**Dispatch markers** (any one proves the send reached the engine half): `KALSA_PREWARM`,
`KALSA_WINDOW`, `RNLlama loadModel`, `loadPrompt:501`, the admission warn. Counts over the whole capture:
`KALSA_WINDOW` = 0, `KALSA_TELEMETRY` = 0; last `loadModel` is `raw/logcat-session.txt:334000`
(12:28:08); after the idle unload `raw/logcat-session.txt:338415` (12:31:01.092,
`'model.unload', {"reason":"idle","idleMs":180386}`) there is not one marker. So **no send ever got
past guard 4 / step 5's entry.**

## B. Every early return: logs? evidence

| # | Exit | Logs? | Evidence in the S23 capture |
|---|---|---|---|
| 1 | **Send control disabled (held composer)** — phase table `src/ui/shell/composerState.ts:106-114` (`loading/tooHot/unloaded/converting` all carry a `hold`), `canSend`/`faceEnabled` = `hold === null` (`:153,156`) → `ShellComposer.tsx:65,131` disabled. Phase from `src/host/composerPhase.ts:38-58`. | **No** (never reaches JS) | **FOR (strong):** the idle unload at 12:31:01 disposes the engine (`src/host/foregroundIdle.ts:163-175`; `onDisposed` only bumps a render tick, `:244-246`; `modelState` is untouched by disposal — setters only in scan/load/download paths, `src/host/useModelHost.ts:223-248`) → `engineResident = isEngineReady() && …` false (`src/host/HostRoot.tsx:201-202`, `isEngineReady` `src/engine/LlamaService.ts:1852`) with `modelState "ready"` → `composerPhase.ts:56` returns `"unloaded"` → hold "Held: the model has to be loaded again" (`src/i18n/en.ts:1308`, surfaced `HostChatSurface.tsx:239`). **No code path can return `idle` while `engineResident` is false** (`composerPhase.ts:53-58`). Both driver sends are after the unload: 16:34:40Z and 16:38:29Z (`raw/s1-brackets.txt:90-134`, `:532-576`), ≥3 min post-unload; even the pre-unload window had no attempt (first bracket = 12:34:08). **AGAINST:** no UI dump survived — their `uiautomator` runs crashed (`raw/uiautomator-current.log` `shell_exit=164 / Signal 36`; `raw/uiautomator-dump.log` `dump_exit=164`) — so the hold line was never captured. |
| 2 | **Tap coordinate miss** (secondary): driver taps `(963,1089)` (`raw/run-scripts/s1-turn.py:91`) after focusing `(500,2100)` (`:80`) and `input text` (`:85`, exit 0 → some field had focus → IME up → app content ends at the IME top `y=1314`, `raw/ime-source-frame.txt:9`). The band's bottom edge is 1314, so the send circle sits ≈1150-1300; `y=1089` is above the band (transcript). | No | FOR: geometry + zero dispatch markers. AGAINST: coordinates were "measured" in a prior smoke report (`s1-turn.py:88-89` comment) and band height is runtime (`src/ui/shell/shellGeometry.ts`), so a miss is plausible, not proven. Undecidable without a post-tap dump (see E). |
| 3 | `sendHost.ts:141-149` guards | **No** | `sendClaimRef`/`sendingRef`/`translationInFlightRef` start false in the fresh process (only set at `sendHost.ts:152-155` by a send; none ran) → **AGAINST** for those three. `!historyLoadedRef`: possible but then the phase would be `loading` (`composerPhase.ts:53`) → already disabled pre-JS (row 1) — indistinguishable, and history normally settles quickly (`src/host/useHistoryHost.ts:70,157`). Empty draft is possible only if `input text` never reached the RN field — the 5 `Fabric View [-1] … SurfaceId` exceptions during composer interaction (`raw/logcat-session.txt:342280,343252,344450,345121,354376`) keep this open. |
| 4 | Thermal hard gate `engineTurn.ts:126-133` → `fail()` | **No** (⚠️ row only) | **AGAINST:** needs platform status ≥4 (`src/engine/thermalHardGate.ts:32,49`) and would also set phase `tooHot` (row 1); capture shows Thermal Status 0-1 (`raw/session-end.txt`, `raw/final-device-state.txt`). |
| 5 | Content gate / bench commands / notices `sendHost.ts:163-196` | decline row, no `console.log` | **AGAINST:** prompts are benign (`raw/s1-prompts.txt`) and none is `bench:`-prefixed. |
| 6 | Memory-extract wait `engineTurn.ts:158-165` | No | **AGAINST:** no prior extract exists in this process. |
| 7 | `ensureEngineForModel` failure `engineTurn.ts:167-181` | `fail()` only, but the reload attempt itself always logs natively | **AGAINST:** zero `loadModel`/native lines after 12:28:08 (`raw/logcat-session.txt:334000`) → ensure never ran. |
| 8 | A stuck claim from an earlier turn would silently eat ALL later sends (`sendHost.ts:148`; release only in `finally { releaseOwned(token) }` `:324-326`) | No | **AGAINST:** a first dispatch must log (ensure → native, or `KALSA_PREWARM`/`KALSA_WINDOW`) before any long await; none exist, and pid 30370 (from 12:28:00) never completed a send. |

## C. Can the paused (-2) prewarm or a busy state block later sends?

- **No.** The prewarm's completion *resolved* (`raw/logcat-session.txt:334021`); `trackCompletion`
  releases in `finally` (`LlamaService.ts:1619-1626`), the prewarm dedupe key releases in its own
  `finally` (`LlamaService.ts:1529-1540`), and it never touches `sendingRef`/`sendClaimRef` (only
  `sendHost.ts:152-155` set those). Its sole downstream effect is the failure budget: 2 strikes and
  prewarm stops for that model/prefix (`src/engine/prefixPrewarm.ts:450`,
  `LlamaService.ts:1533-1537`) — prewarm only, never sends.
- A stuck "generating" state would **not** look like this capture: `sending` ⇒ phase
  `prefill/thinking/writing` ⇒ face `"stop"` with `faceEnabled` true (`composerState.ts:108-110,
  :156`) ⇒ the tap calls `sendHost.stop()` (`HostChatSurface.tsx:267`) — an abort, not a dead button;
  and any stuck `sending` implies a prior dispatched send, which must have logged. `KALSA_IDLE_STALL`
  count = 0.

## D. What the new UX composer requires that the old flow didn't

- **A resident engine.** `composerPhase.ts:56` (`ready && !engineResident → "unloaded"`) holds the
  composer; the recovery is a human tap on the model pill (strip semantics `HostChatSurface.tsx:135`,
  `src/ui/shell/ModelBar.tsx`; "Explicit user reload … HUMAN act" `src/host/useModelHost.ts:289`).
  The old controller's `canSend` (parity quotes `AiChatPage.tsx:3603-3605` in `composerView.ts:94-97`
  and `AiChatPage.tsx:4339` in `composerState.ts:4-9`) had **no residency check** — ensure would load on send
  (`engineTurn.ts:167` still exists but is now unreachable from a held composer). Net: after any idle
  unload (180 s here), the new UX refuses sends until a reload; the driver never triggered one.
- Also required: history settled (`composerPhase.ts:53`), a picked model (`missing/error → "unloaded"`,
  `:57`), non-empty draft or staged row (`composerView.ts:91-94`), no translate (`:94-97`), no PDF
  converting (`composerPhase.ts:49`), platform thermal <4 (`composerPhase.ts:39`).
- **Not** required: a created chat (`activeId || DEFAULT_CHAT_ID`, `engineTurn.ts:227`); no modal/
  overlay gate exists in the send code path.
- **IME Enter regression:** no submit handler at all (A.3) — the driver's "Enter action" could never
  dispatch regardless of state.

## E. Most likely cause + the one check

**Most likely:** the idle unload at 12:31:01 (`raw/logcat-session.txt:338415`) left the composer in
phase `unloaded` → hold line "Held: the model has to be loaded again", send control disabled
(`composerPhase.ts:56` → `composerState.ts:153,156` → `ShellComposer.tsx:65,131`); both driver taps
(12:34:40, 12:38:29) hit a disabled control, so nothing downstream could log. The stale send-tap
coordinate (`y=1089`, above the band when the IME is up) is a plausible co-cause that the code path
cannot distinguish from the log.

**One adb check:** `adb exec-out uiautomator dump /dev/tty` immediately after focusing the composer —
look for the send node (`content-desc` "Send" / `shell.a11y.send`) with `enabled="false"` and a node
containing "Held: the model has to be loaded again" (`en.ts:1308`); whether `shell.composer.field`
still holds the typed prompt separates cause 1 (text in field + button disabled) from cause 2 (button
enabled + tap landed elsewhere). Log-side equivalent: any dispatched send must print `KALSA_PREWARM`
(`LlamaService.ts:1139`) or `KALSA_WINDOW` (`engineTurnStream.ts:122`) within ~1 s of the tap — the
capture has 0 of both after `raw/logcat-session.txt:338415`.
