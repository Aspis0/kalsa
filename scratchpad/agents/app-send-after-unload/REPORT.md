# REPORT — send after idle unload + IME Send key (kalsa app)

Repo: kalsa app worktree `/Users/marco/Projects/kalsa-wt-bench-apk`.
Branch: detached on origin/main `67ade7a8` (verified: `git status --short` empty at start,
`git log --oneline -1` = `67ade7a8`, `node_modules` a real directory, `test -L node_modules/llama.rn`
failed as required — no `npm ci` needed).
Commit: **`0a72612cd01d82182e03bf84985f679d43c247fa`** on that detached HEAD. `git branch --show-current`
printed before the commit (empty = detached). Working tree clean after commit (0 modified). **No push,
no tag, no new branch.**

## Bug 1 — ready-but-not-resident held the composer (fixed)

- Change: `src/host/composerPhase.ts:61` —
  `if (input.modelState === "ready" && !input.engineResident) return "idle";` (was `return "unloaded"`).
  A picked, ready model that is merely not resident no longer holds; the send reloads it through the
  existing ensure path (`src/host/engineTurn.ts:167` `ensureEngineForModel`), which is the old flow's
  behavior (its `canSend`, quoted in `src/ui/shell/composerState.ts:4-9` and
  `src/host/composerView.ts` parity comments, had no residency check).
- Truthful state while it reloads, **existing copy, no new strings**: `sendHost.send` sets
  `sending=true` before any await (`src/host/sendHost.ts:153-155`), so during the reload the phase is
  `prefill` → hold `shell.held.prefill` "Held until the reply starts" (`src/i18n/en.ts:1300`),
  face `stop`. i18n files untouched.
- Missing/error still block: `src/host/composerPhase.ts:64` keeps them → `unloaded` → hold
  `shell.held.unloaded` "Held: the model has to be loaded again" (`src/i18n/en.ts:1308`).
- Every other consumer of phase `"unloaded"` checked: `composerState.ts` PHASE_RULES row (kept — now
  reachable only from missing/error), `composerState.test.ts` `NOT_READY_HELD`/`EXPECTED_HOLD` (kept,
  still true), `composerPhase.test.ts:50` (updated — it pinned the bug), and the invariant comment in
  `src/host/foregroundIdle.ts:17-20` (rewritten: a dispose paints no hold line; the next send reloads).
  No other reference to the phase value exists (grep over `src`).
- `engineResident` stays an input of `ComposerPhaseInput` and is read at the new branch — no dead API,
  no wider removal from `composerView`/`HostRoot`.

## Bug 2 — IME Send key promised and delivered nothing (fixed)

**Decision: the Send key sends, with the button's own gate.** The pre-UX composer did exactly that —
`git show 1a790d7c~1:src/screens/AiChatPage.tsx` lines 4370-4377:

```tsx
onSubmitEditing={() => {
  // Audit follow-up: typing stays enabled during a PDF
  // conversion, but submission must not start mid-conversion.
  if (pdfToRender) return;
  handleSendTracked(draft, attachedItems);
}}
returnKeyType="send"
```

Its conversion guard is subsumed by `canActivate` here (a converting PDF → phase `converting` → hold →
`faceEnabled=false`). Change: `src/ui/shell/ShellComposer.tsx:112-117` — `onSubmitEditing` fires the
same `onSendPress` the button uses, only when `canActivate` (the button's own `disabled` expression,
`ShellComposer.tsx:65`), so the stop face routes to stop through the existing
`HostChatSurface.tsx:266-269` wiring. No parallel send path.

## Tests (new/updated)

- `src/host/composerPhase.test.ts:49` — ready + `engineResident:false` → `"idle"`; missing/error →
  `"unloaded"` case kept (line 54-56).
- `src/host/composerView.test.ts:62-84` — not-resident + draft → `sendEnabled true`, hold null,
  face enabled; missing/error → `sendEnabled false`, hold `shell.held.unloaded`; not-resident +
  sending → hold `shell.held.prefill` (truthful while reloading).
- `src/ui/shell/ShellComposer.test.ts:77-130` — submit fires `onSendPress` when enabled; does nothing
  on `sendEnabled:false` / `faceEnabled:false`; stop face submits through the same `onSendPress`.

## Commands, real exit codes

| Command | Exit |
|---|---|
| sabotage 1 (restore `→ "unloaded"`): `npx jest src/host/composerPhase.test.ts src/host/composerView.test.ts` | **1** (2 failed: the two new residency tests, named in output) |
| sabotage 2 (remove `onSubmitEditing`): `npx jest src/ui/shell/ShellComposer.test.ts` | **1** (4 failed, `onSubmitEditing is not a function`) |
| `npx tsc --noEmit` (after restoring both) | **0** |
| `bash scripts/assert-engine-provenance.sh` | **0** (1119 files `kalsa.rn@463f11f9f47f`, engine `kalsallama@8eac584bb341` == pin) |
| targeted `npx jest` (the 3 files) | **0** (3 suites, 29 tests) |
| full `npx jest` (once, at the end) | **0** (231 suites, 2458 tests — baseline 2451, +7) |

Sabotages were reverted before the final runs; final tree = committed tree (`git status --short` empty).

## Not verified

- No device run: did not confirm on the S23/Jelly that a send dispatches after a real idle unload
  (no adb session opened; phones untouched), nor that a physical IME's action key fires
  `onSubmitEditing` on this field — the test drives the prop directly.
- The recon calls the field multiline from `inputType=0x4001`; 0x4001 decodes as
  CAP_SENTENCES|CLASS_TEXT (single-line), but I could not re-check the probe/device. Either way the
  handler is wired; if the field truly is multiline on some IMEs, Enter may still insert a newline —
  pre-existing, out of scope.
- DeepSeek audit before push: not performed (no push requested/allowed).

---

# Fix round 1 (audits of 0a72612c: luna NO, deepseek SHIP with notes)

One commit on top of `9d8b63d2`: **`1caf7ed07eec5a4ae580bf88ad2cdfd0bcf038f2`**
(repo kalsa app, branch detached — `git branch --show-current` printed empty before the commit,
`git add` by name, no push/tag/branch). Tree clean after.

**1. IME Send key stopped live turns (luna).** Fix: `src/ui/shell/ShellComposer.tsx:118` —
`if (face === "send" && canActivate) onSendPress?.();` (`canActivate` alone is true on the stop
face, generation and cooling alike). Test: `src/ui/shell/ShellComposer.test.ts:120-128` — the test
that pinned "stop face submits" inverted to `it.each(["stop","stopping"]) … not.toHaveBeenCalled()`.
Sabotage (revert gate): **EXIT=1** (2 failed).

**2. Send during a succeeding load showed `chat.modelLoadFailed` (deepseek F2).** Fix chose the
**wait** over a composer hold: by the time the refusal reaches the turn the message row is already
appended (sendHost appends before `handleSendStream`), so only waiting keeps it truthful — and the
wait already wears the existing prefill hold with the stop face, so no new phase/copy. Wiring:
new `src/host/loadSettle.ts:40` `waitForInFlightChatLoad` (verdicts `none`/`settled`/`aborted`;
no wall-clock bound — every ensure exit releases the gate and the turn is stoppable) +
`src/host/engineTurn.ts:172-177` `ensureForTurn` (wait + one retry) and the silent
`signal.aborted → finish()` at `:179-183`. Test: `src/host/engineTurnEnsure.test.ts` — wait/retry
(gate state at the retry ≠ `chat_loading`), abort → no verdict (`onFailed` never called,
`setStreaming(false)`), both red on sabotage. Sabotages: wait removal **EXIT=1** (2 failed),
abort branch removal **EXIT=1** (1 failed).

**3. Thermal refusal of a load showed load-failed (deepseek F3).** Cooling work did **not** cover
it (cooling waits out governor pauses of a running completion, never an OS-gated load). The quoted
line was `engineTurn.ts:175` `fail(t("chat.modelLoadFailed", { name: currentModel.name }),
"chat.modelLoadFailed");` after `engineEnsure`'s thermal preamble returned false with no error set.
Fix: `src/host/engineTurn.ts:194-197` — `thermalHardGateRef.current || thermalHardGated` →
`fail(t("chat.thermalHardGateBody"), "chat.thermalHardGateBody")`, ordered before the downloaded
branch. Test: `engineTurnEnsure.test.ts` "an OS-thermal refusal…" (gate flips mid-ensure,
downloaded=true — still thermal). Sabotage **EXIT=1** (1 failed).

**4. Model-switch race (luna).** Two halves: `src/host/sendEntryGuards.ts:14` `sendEntryRefused`
refuses every dispatch while `modelSwitchInFlightRef.current` (covers cards/edit/regenerate — the
paths that never consult the composer), called at `src/host/sendHost.ts:140`; and
`src/host/modelSwitch.ts:129` sets `checking` **before** the marker-clear await, so the composer
holds the switch from the tap (phase `loading`), while the selection flip still waits for the clear
(kept comment stays true — asserted). Tests: `src/host/sendSwitchGuard.test.ts` (no claim, no
draft clear, no message), `src/host/modelSwitchHold.test.ts` (ordering + flip-after-clear).
Sabotages: guard removal (both in sendHost inline and post-extraction in sendEntryGuards)
**EXIT=1** each (1 failed); transition revert **EXIT=1** (with item 5: 3 failed).
`sendHost.ts` sat exactly on the 350-line ratchet — the guard list moved to `sendEntryGuards.ts`
(a decision with its own name, not line-shuffling); file now 348 lines, `fileSize.test` green.

**5. Comments that lied.** `src/host/composerPhase.ts:63-68` now says missing OR any pipeline
error holds (error is the catch-all; the `error → unloaded` mapping untouched, still asserted);
`src/host/modelSwitch.ts:196-203` — the dispose-timeout log now names the real way out (load the
picked model; a same-index re-select is refused at the entry guard). Pinned by source guards in
`composerPhase.test.ts` ("the comments tell the truth…") and `modelSwitchHold.test.ts`. Sabotage
(both reverted) **EXIT=1** (3 failed).

**Follow-on (not a new bug):** two source guards pinned the old inline guard location —
`translateFlow.test.ts` (shared-ref gates the send before the claim) and `attachUi.test.ts`
(attachment-only send passes) — updated to the invariant's new home `sendEntryGuards.ts`, same
expectations.

**Not covered / not verified:** no device run; the wait path was exercised only through
`handleSendStream` harness tests (real gate, real 250 ms poll), not against a real slow load; the
`sendStop` 3 s watchdog interaction with item 2 is unchanged (pre-existing, cited by deepseek only
as the path that lets a second send enter); the failed-reload draft-clearing stays as-is (owner
decision, out of scope).

**Commands (final):** `npx tsc --noEmit` **EXIT=0**; targeted jest (10 suites incl. regression
neighbors `modelSwitchRemote`, `sendHostOwnership`, `turnEnsureDispatch`, `downloadFlow`,
`fileSize`) **EXIT=0** (51 tests); one full `npx jest` at the end **EXIT=0**
(**235 suites, 2485 tests**; baseline 232/2477 → +3 suites/+8 tests). One intermediate full run
failed on the file-size ratchet (`sendHost.ts (356)`) and one on the two moved source guards —
both fixed before the final run, quoted exits are from after the fixes.
