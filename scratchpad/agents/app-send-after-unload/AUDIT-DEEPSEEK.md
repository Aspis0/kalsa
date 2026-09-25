# AUDIT — send after idle unload + IME Send key (app `0a72612c`)

**Verdict: SHIP.** Both fixes do what the report claims; the send path is open end to end and the
tests are red-capable. One new race (F2 below) is a spurious failure row, not a break.

## F1 — the send path after an idle unload — CONFIRMED

    composerPhase.ts:61   if (input.modelState === "ready" && !input.engineResident) return "idle";
    composerView.ts:91-94 sendEnabled: composer.canSend && (draft.trim() || attachments.length) && !translating
    ShellComposer.tsx:65  const canActivate = faceEnabled && (face !== "send" || sendEnabled);
    HostChatSurface.tsx:266-269  onSendPress={() => { if (face === "stop") sendHost.stop(); else void sendHost.send(draft); }}
    sendHost.ts:141-149   (!trimmed && staged.length === 0) || sendClaimRef.current || sendingRef.current ||
                          translationInFlightRef.current || !params.historyLoadedRef.current → return;
    engineTurn.ts:167     if (!(await ensureEngineForModel(currentModel))) { ... fail(...) ... }
    engineEnsure.ts:84    if (isEngineReady() && getActiveModelId() === model.id) { queueStaticPrefixPrewarm(...); return true; }

No residency check remains in `sendHost` or `composerView`; the phase is `idle` → `canSend` true
(`composerState.ts:106,153`) → the send reaches `ensureEngineForModel`, which (not resident)
proceeds to load. The gate is free after an idle dispose: `foregroundIdle.ts:165-187` disposes and
then `markChatReleased(genAtEntry)` (or the stale-owner fallback `:180-187`), so the ensure's
`tryAcquireChat` (`engineEnsure.ts:193`) is not refused with `chat_ready` (`:198-200`).
CONFIRMED.

## F2 — a second send while the reload is still in flight fails with a misleading row — CONFIRMED

`tryAcquireChat` refuses a concurrent chat load (`llamaContextGate.ts:27-28` "double-load backstop"),
and the ensure turns that into a bare `false`:

    engineEnsure.ts:193-200   let chatGen = tryAcquireChat();
                              if (chatGen === null) { const gateState = getLlamaContextGateState();
                                  if (gateState === "chat_loading" || gateState === "chat_ready") { return false; } ... }
    engineTurn.ts:171-178     const downloaded = await isModelBundleDownloaded(currentModel) ...;
                              } else if (downloaded) { fail(t("chat.modelLoadFailed", { name: currentModel.name }), "chat.modelLoadFailed"); }

The reload is not abortable (`ensureEngineForModel` takes no signal) and the stop path releases the
claim after at most 3 s (`sendStop.ts:87-127`). So: send on a non-resident model (reload starts) →
user presses stop (the face is `stop` during `prefill`, `composerState.ts:108`) → after the watchdog
the composer is `idle` again (`ready && !engineResident`) → a second send enters while the first
load still holds `chat_loading` → `fail("model load failed")` even though the first load is
succeeding. Before this commit the composer was held (`unloaded`) in that state, so the second send
was impossible. PLAUSIBLE→CONFIRMED by code read (no device run); the rate depends on the load's
duration (seconds on the 2.6B) vs the 3 s watchdog. The double-load guard itself is correct; the
defect is the user-visible copy and the missing "wait for the in-flight load" path.

## F3 — thermal race copy — PLAUSIBLE (minor)

The pre-send backstop checks the thermal ref (`engineTurn.ts:126-129`), and the ensure re-checks it
(`engineEnsure.ts:67-76`, `engineEnsureLoad.ts:207-211`) but returns `false` **without** setting a
model error; the caller then reports `chat.modelLoadFailed` (`engineTurn.ts:175`). A gate that flips
between the two checks shows the wrong sentence (the phase is already `tooHot` when
`thermalGated` is true, `composerPhase.ts:39`, so the window is small). No test covers the race.

## F4 — `composerPhase.ts:61` is a no-op branch — PLAUSIBLE (clean-code nit)

Deleting the old `unloaded` line already yields `idle` for `ready && !engineResident`: the chain
falls to `:62` (`missing`/`error` — false) then `:63 return "idle"`. The new branch is therefore
semantically redundant; it exists to carry the 5-line comment and keep `engineResident` consumed
(its only reader). The comment's invariant is true (the ensure reloads; the prefill line holds while
`sending`), so this is style only.

## F5 — IME submit vs button double fire — REFUTED

A single IME action fires only `onSubmitEditing` (`ShellComposer.tsx:112-117`), which calls the same
`onSendPress` behind the same `canActivate` as the control (`:65`); `sendHost.ts:151
sendClaimRef.current = true;` is set synchronously before any await, so a second `send` returns at
`:143`. `handleStop` is idempotent (re-aborts the same controller, `sendStop.ts:75-77`; the watchdog
is re-armed `:82-87`). Behavior change to record: on the stop face the IME Send key now *stops* the
run (pinned by `ShellComposer.test.ts:120-127`) where the pre-UX composer's `onSubmitEditing` sent —
deliberate per the report and consistent with the visible control. PLAUSIBLE (design), not a defect.

## F6 — `"unloaded"` consumers — CONFIRMED (all accounted for)

`git grep -n '"unloaded"' 0a72612c -- src` → `composerPhase.ts:62` (missing/error only),
`composerPhase.test.ts:54-55` (kept), `composerState.ts:41` union + `:113` row (still reachable via
missing/error), `composerState.test.ts:81 NOT_READY_HELD` (kept, still true), and the rewritten
comment `foregroundIdle.ts:17-20`. No other consumer; `useProcessHealth.ts:36-37 unloadedReason` is
the unrelated memory-pressure surface, and the i18n strings are untouched.

## F7 — tests red-capable — CONFIRMED

`composerPhase.test.ts:3-12` base is `modelState:"ready", engineResident:true`; `:49-50` overrides
`engineResident:false` → `idle` (red on the pre-fix `unloaded`). `composerView.test.ts:20-38` same
base; the new cases (`:62-84`) override `engineResident:false` → `sendEnabled` (red pre-fix).
`ShellComposer.test.ts` mounts with defaults (`face:"send", faceEnabled:true, sendEnabled:true`) and
calls `props.onSubmitEditing()`; pre-fix that prop is undefined → TypeError → red; the two gated
cases and the stop-face case assert 0/0/1 calls. The driver invokes the prop directly, not a real
IME — acknowledged in the report, and the only way without a device.

## F8 — user-visible slow/failed reload — CONFIRMED (no dead end)

Slow: `sending=true` → phase `prefill` → hold `shell.held.prefill` + `face:"stop"`
(`composerState.ts:108`) — truthful, the stop control is live. Failure: the engineTurn `fail()`
(`engineTurn.ts:113-122`) emits the `⚠️` delta + `onFailed`, and the ensure's own refusals set a
specific model error (`engineEnsure.ts:153-171` blocked RAM → `setModelState("error")` +
`gateReasonMessage`; `engineEnsureLoad.ts:145-149,239-250` `embedding.busy`), so the phase becomes
`unloaded` with the pill's message. The stop during a reload aborts the turn, not the load (no
signal reaches `ensureEngineForModel`), which is F2's window.

## F9 — clean code / process — CONFIRMED

6 files (2 source, 1 comment header in `foregroundIdle.ts`, 3 tests), no new file, no new imports, no
new API; comments are WHY and their invariants hold; no secrets. Commit message carries repo, branch
and detached HEAD (`0a72612c` on `67ade7a8`), no push/tag/branch. The only code-shape nit is F4.

## What I could not verify

- No device: the idle-unload → send → reload sequence, the physical IME's action key on this field
  (the RECON's `inputType=0x4001` ambiguity — single-line flags vs a multiline field — means some
  IMEs may still insert a newline), and the F2 timing (load duration vs the 3 s stop watchdog).
- The writer's sabotage exit codes and the full jest run; the tree may have later commits on top, so
  everything here was read at `0a72612c` via `git show`/`git grep` only.
