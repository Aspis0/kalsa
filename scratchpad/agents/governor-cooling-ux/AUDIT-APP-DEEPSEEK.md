# AUDIT — kalsa app range `67ade7a8..1caf7ed0` (hostile, read-only)

Auditor: deepseek reviewer. Worktree `/Users/marco/Projects/kalsa-wt-bench-apk`, detached HEAD
`1caf7ed07eec5a4ae580bf88ad2cdfd0bcf038f2` (verified: `git rev-parse HEAD`, `git status --short` empty
before and after this audit). No repo was modified; no sub-agents; no push. The binding half
(`llama.rn-kalsa` `1f841412`) was read read-only for the interface only; its own audit stands.

Sabotage runs were done in a scratch copy built with `git archive 1caf7ed0 | tar -x -C /tmp/kalsa-gov-audit`
plus a real `npm ci` (`/tmp/audit-gov-npm-ci.log`, 484 package dirs, `test -L node_modules` false).
The tree was re-extracted before each sabotage. Two parallel probe runs clobbered each other once
(`/tmp/out.log` + `/tmp/keep.orig` shared); every exit quoted below is from a **serial** re-run.

Evidence commands (all quoted exits serial):

| Command | EXIT |
|---|---|
| `npx jest src/engine/thermalResume.test.ts src/engine/prefixPrewarm.test.ts src/host/composerPhase.test.ts src/host/composerView.test.ts src/host/engineTurnEnsure.test.ts src/host/sendSwitchGuard.test.ts src/host/modelSwitchHold.test.ts src/ui/shell/ShellComposer.test.ts src/ui/shell/composerState.test.ts` | **0** (9 suites, 120 tests) |
| `npx jest src/host/fileSize.test.ts src/host/modelSwitchRemote.test.ts src/host/sendHostOwnership.test.ts src/host/turnEnsureDispatch.test.ts src/host/downloadFlow.test.ts` | **0** (5 suites, 25 tests) |
| `npx tsc --noEmit` (scratch) | **0** |
| `bash scripts/assert-engine-provenance.sh` (worktree) | **0** (`[provenance] OK: 1119 files match Aspis0/kalsa.rn@463f11f9f47f`) |
| 13 sabotages, one target suite each | see matrix — **11 red, 3 green** |

Verdict headline: **NO — fix round.** The main path (idle-unload send, Enter, cooling on a governor
thermal pause, prefill deadline handling, prewarm `paused`) is implemented correctly and the new
modules are small and honest. Two product-visible defects and a set of unpinned invariants remain.

---

## F1 — CONFIRMED — a model switch during a cooldown is reported as "cooling timed out"

The cooling loop stops on `isStopped()`, which includes invalidation that set neither `finished`
nor `aborted`:

> `src/engine/LlamaService.ts:5049` — `isStopped: () => finished || aborted || disposing || engine !== context,`

After the loop the caller distinguishes **only** `aborted`:

> `src/engine/LlamaService.ts:5094-5104`
> ```
> if (aborted) return;
> if (pauseReasonOf(result) === "thermal") {
>   // The cooling bound expired while the reading never allowed a
>   // resume: a VISIBLE failure, never the silent empty turn a pause
>   // used to resolve as. Nothing was streamed this round, so nothing
>   // but the failure row can reach history.
>   emitEngineError(callbacks, finishOnce, new Error(strings.errors.coolingTimedOut));
>   return;
> }
> ```

A model switch does not abort the turn's controller: the only `controller.abort()` call sites are
`src/host/sendStop.ts:77` (user Stop), `src/host/useHostEffects.ts:77/113` (conversation change,
unmount) and the idle/background discard bridge (`foregroundIdle.ts:109`, re-asserted at `:119`).
`selectModel` instead disposes the engine (`src/host/modelSwitch.ts:191-194`), which nulls the module
`context` and sets `disposing` (`LlamaService.ts:2913/2917`). So while a cooldown is waiting:

1. the user taps another model; `selectModelById` asks to confirm a switch mid-stream
   (`modelSwitch.ts:295-308`) and `selectModel` runs, or the eager kick of the newly selected model
   does the same (`usePipelineScans.ts:300-308`);
2. dispose nulls `context` → `engine !== context` → the loop's `isStopped()` becomes true;
3. the loop returns the **still-paused** `result`; `aborted` is false; the branch above fires.

Result: `errors.coolingTimedOut` ("The phone stayed too hot to continue your message…") is persisted
for a turn the user ended by switching models — a wrong sentence, a wrong reason key
(`chat.serviceUnreachable`, via `engineTurnStream.ts:271`), and it violates the owner rule "no error
persisted into history while cooling" in spirit (the persisted error is not about cooling at all).
If the switch lands before the first `wait` cycle, `coolingSince === null` also means **no**
`onCooling("end")` fires (`thermalResume.ts:159`) and the user never saw "Cooling down" either.

The comment at `:5096` is the only place in the range that states an untrue invariant: the loop can
also exit because the turn was invalidated, not only because the bound expired. Minimal fix:
replace `if (aborted) return;` with `if (bailIfStopped()) return;` — `bailIfStopped`
(`LlamaService.ts:4680-4708`) already routes `disposing || engine !== context` through
`turnInterrupted` and sets `aborted`.

Related, same family (PLAUSIBLE): if the switch lands during `waitForInFlightChatLoad`, the retry
`ensureEngineForModel(currentModel)` fails `stillCurrent()` (`engineLoad.ts` → `engineEnsure.ts:80-82`)
and the turn shows `chat.modelLoadFailed` naming the **old** model
(`engineTurn.ts:188/198`) — the wait widened the window for that pre-existing classification.

## F2 — CONFIRMED — the owner's cooling rule is not implemented on the tool-fallback completion

The cooling loop wraps one call site (`LlamaService.ts:4972` `runCompletionRound`). The
tool-rounds-exhausted fallback issues its own completion and never inspects `pause_reason`:

> `src/engine/LlamaService.ts:5451-5452` — `const fallbackResult = await trackCompletion(engine.completion(`
> `src/engine/LlamaService.ts:5503-5504` — `if (aborted) return;` / `recordBenchCompletion(fallbackResult);`
> `src/engine/LlamaService.ts:5585-5587` — `if (!exhaustedTel.fallbackOk) {` / `callbacks.onDelta(fallbackMessage, fallbackMessage);`

At ≥40 °C on that path the user gets `errors.toolRoundsExhausted`, not "Cooling down", and there is
no auto-resume — the owner decision ("at/above 40 °C the app shows Cooling down and resumes by
itself") is violated for a whole class of turns (tool rounds used up, hot device). The report
declared only the speculative/MTP and give-up gaps; this one is undeclared. The other three
completion sites (`:6068` memory extract, `:6298` translate, `:6419` `completeOnce`) have the same
shape; they are utility calls, lower stakes, but they still resolve a pause as a normal result.

## F3 — CONFIRMED (test gap) — the last gate before a retry is sabotage-green

> `src/engine/thermalResume.ts:151` — `if (isStopped()) break;` (immediately after `refreshThermo`)

Removing that single line leaves `npx jest src/engine/thermalResume.test.ts` **EXIT=0** (13 passed).
The window it closes is exactly the audited race: a Stop (or a dispose) landing inside the thermo
refresh would, without it, fall through to `onCooling("resume")` + `attempt()` — a fresh
`engine.completion()` on a context that may already be released (`disposing` is not checked inside
`refreshGovernorBeforeCompletion`; it only guards `engine === context` for the native write,
`:1766`). The behaviour is correct today; it is simply unpinned, and it is the last gate.

## F4 — CONFIRMED (test gap) — the numbers the owner cares about are not pinned

* `GOVERNOR_COOLING_MAX_MS` 10 min → 1 min: `thermalResume.test.ts` **EXIT=0** (13 passed; the bound
  test injects `now`, so the default constant is never exercised).
* `GOVERNOR_COOLING_POLL_MS` likewise has no assertion anywhere (`thermalResume.ts:48`).
* `readingAllowsResume`'s boundary `< 400` → `<= 400`: **EXIT=0**. Only the constant's *value*
  (`=== 400`) is asserted (`thermalResume.test.ts:181-183`); resuming at exactly 40.0 °C against the
  engine's warn line is not covered. Low impact (the loop re-pauses and is bounded), but it is the
  owner's number.

## F5 — CONFIRMED (test gap) — nothing tests the production cooling wiring

`grep -rln "resumeWhileCooling|KALSA_THERMAL_COOLING|coolingTimedOut" src --include=*.test.ts` returns
**only** `src/engine/thermalResume.test.ts`. The status-label emission, the prefill deadline
clear/re-arm, the flag guard (`finished || aborted`), the `KALSA_THERMAL_COOLING` line and the
give-up copy live in `LlamaService.ts:5045-5106` and are covered by no suite at all — the report
admits only the give-up case. Any mutation in that block is invisible to the tests, which is also
why F1 survived a fix round whose whole purpose was audits of exactly this wiring.

## F6 — CONFIRMED — the cooling telemetry never shows an episode that was stopped or invalidated

> `src/engine/LlamaService.ts:5052` — `if (finished || aborted) return;`
> `src/engine/LlamaService.ts:5063-5076` — the only `KALSA_THERMAL_COOLING` line, on the `else` (i.e. `"end"`) phase

The line carries `{turnId, round, waitedMs}` only (`:5066-5071`, `turnId = String(++turnSeq)` at
`:4172`) — no user text, no model text, nothing sensitive. But it is emitted once, at the end, and
the guard above swallows it when the turn finished or was stopped; F1 shows it is also skipped when
the turn is invalidated. A user-visible cooling episode that the user stops therefore leaves **no**
cooling evidence in logcat, and a 9-minute in-progress cooldown logs nothing until it ends. The plan
promised enter/exit; only exit exists, and only on the happy paths.

## F7 — PLAUSIBLE — an OS thermal CRITICAL during a cooldown removes the Stop control

> `src/host/composerPhase.ts:42` — `if (input.thermalGated) return "tooHot";` (before the `sending` branch)
> `src/ui/shell/composerState.ts:161` — `faceEnabled: rule.face === "stop" ? true : rule.hold === null`
> `src/host/useModelDownload.ts:119-126` — the gate's rising edge aborts only a **download**

Nothing aborts a running turn when the platform gate rises. So while cooling (the state in which the
phone is hot by definition), a CRITICAL transition paints `tooHot` → face `send`, `faceEnabled`
false, Enter disabled (`ShellComposer.tsx:118` requires `face === "send"`) — the user cannot stop the
cooldown for up to the 10-minute cap. Narrow, but it is a new interaction created by the new long
state; a `cooling`-first override (or keeping the stop face under `tooHot` while a run is live) would
close it.

## F8 — CONFIRMED (minor) — `statusHistory` grows one entry per cooling poll, and nothing reads it

> `src/host/sendCallbacks.ts:84` — `statusHistory: [...(message.statusHistory ?? []), status.label],`

Each `"wait"` phase re-emits the label (`LlamaService.ts:5059`), so a full 10-minute episode appends
up to ~60 identical `"Cooling down"` entries. `statusHistory` is rendered nowhere
(`grep statusHistory src` → mapper/persist only strip it), so it is unbounded growth on a field with
no consumer.

## F9 — PLAUSIBLE — the cooling phase is keyed off a translated string

> `src/host/composerPhase.ts:45` — `if (input.statusLabel === input.coolingStatus) return "cooling";`

`statusLabel` is written from `strings.chat.coolingStatus` where `strings = getStrings(locale)` inside
the engine job (`LlamaService.ts:4159`), and compared against `t("chat.coolingStatus")` captured at
render (`HostRoot.tsx:192`). A language change mid-turn makes the two disagree and the composer falls
back to `prefill` (hold "Held until the reply starts") instead of "Cooling down" — the owner rule
breaks until the label is re-emitted. Same coupling already exists for `thinkingStatus`; new only in
that the owner decision names this string.

## F10 — CONFIRMED (clean-code) — duplicated private wait helper

`src/host/loadSettle.ts:25-38` (`sleepWithAbort`) and `src/engine/thermalResume.ts:84-97`
(`waitOrAbort`) are the same function, character for character apart from the parameter name. One
should be lifted; the abort-aware timer is exactly the kind of trap this project prefers to have in
one place.

## F11 — CONFIRMED (clean-code, direction of travel) — the ratchet does not cover where this grew

`src/engine/prefixPrewarm.ts` 542 → **551** lines and `src/engine/LlamaService.ts` 6468 → **6537**,
and the new cooling logic sits inside the 6500-line file with no seam of its own. The file-size test
only ratchets `src/host` (limit 350) and `src/ui/shell` (`fileSize.test.ts:9-17, 74-75`), so `src/engine`
is outside the promise. The new modules themselves are exemplary (162/49/36 lines) and `sendHost.ts`
was correctly cut off the 350 line (now 348, `fileSize.test.ts` green) — but the product behaviour of
this range lives entirely in the one file the ratchet cannot see.

---

## Verified correct (with the sabotage that proves it)

| # | Sabotage (scratch copy) | Target suite | EXIT |
|---|---|---|---|
| S1 | `composerPhase` `ready && !engineResident` → restore `"unloaded"` | composerPhase, composerView | **1** (2 failed) |
| S2 | `ShellComposer` drop `face === "send"` | ShellComposer | **1** (2 failed) |
| S3 | drop the post-`refreshThermo` `isStopped()` | thermalResume | **0** ← F3 |
| S4 | `waitForInFlightChatLoad` returns `"none"` immediately | engineTurnEnsure | **1** (2 failed) |
| S5 | disable the `signal.aborted → finish()` branch | engineTurnEnsure | **1** (1 failed) |
| S6 | drop `modelSwitchInFlightRef` from the entry guards | sendSwitchGuard | **1** (1 failed) |
| S7 | drop the OS-thermal branch in the ensure classification | engineTurnEnsure | **1** (1 failed) |
| S8 | move `setModelState("checking")` back after the marker clear | modelSwitchHold | **1** (1 failed) |
| S9 | drop the prewarm `"paused"` class | prefixPrewarm | **1** (1 failed) |
| S10 | `GOVERNOR_COOLING_MAX_MS` 10 min → 1 min | thermalResume | **0** ← F4 |
| S11 | resume gate `< 400` → `<= 400` | thermalResume | **0** ← F4 |
| S12 | accept any non-empty `pause_reason` string | thermalResume | **1** (1 failed) |
| S13 | drop the post-`wait` `isStopped()` | thermalResume | **1** (1 failed) |

* Security/privacy: the only new log line is `KALSA_THERMAL_COOLING {turnId, round, waitedMs}`;
  `turnId` is a per-process counter, `round` an int. No prompt, draft, model output, path, or key
  reaches it. `logPrewarm`'s new fields are the literal reason and the prefix hash. No secret or
  token in the diff. `emitEngineError` does put `rawMessage` into `reportChatGenerationTelemetry`
  (`LlamaService.ts:3092-3096`), but the cooling message is our own catalogue string.
* Owner "under 40 °C prefill always proceeds": the app's resume gate is the engine's warn line as a
  constant (`thermalResume.ts:45`) with the drift trap named; the engine side is out of app scope.
* Owner "no error persisted while cooling": during the wait only `statusLabel` is patched
  (`sendCallbacks.ts:79-86`, no persist); the persisted failure exists only after the bound — or
  falsely per F1.
* Owner out-of-scope (failed reload clears the draft, message stays): untouched in the range.
* `loadSettle` "unbounded but stoppable": the stop resolves the sleep at once (`loadSettle.ts:27-37`)
  and `engineTurn.ts:181-184` ends the turn with `finish()`; the background discard aborts the send
  bridge (`foregroundIdle.ts:109`) so a suspended timer still gets its abort listener fired. A gate
  wedged at `chat_loading` keeps the send waiting until the user's Stop — the comment says so, the
  UI still offers Stop (phase `prefill`, face `stop`), and the 3 s stop watchdog unlocks the composer
  even if the native load never settles. **REFUTED**: no way to hang with no exit *other than* the
  turn's own abort, which is wired.
* Enter: `ShellComposer.tsx:112-119` sends only on `face === "send" && canActivate`; stop/stopping and
  every held send face are inert; red under S2 and pinned by `ShellComposer.test.ts:109-129`.
* Model-switch hold: `modelSwitch.ts:129` sets `checking` before the marker-clear await and
  `sendEntryGuards.ts:31` refuses every dispatch path (cards/edit/regenerate all enter
  `sendHost.send` through `messageActions.ts:5`); red under S6/S8.
* Prewarm `paused`: `prefixPrewarm.ts:396-398` classifies, `:471-475` keeps it out of the failure
  budget, and `LlamaService.ts:1544-1553` releases the dedupe key and records no strike — the next
  send prefills cleanly; red under S9. No loop: one paused prewarm per queueing, no re-queue.
* Gate pairing: every refusal/error path in `engineEnsureLoad.ts` releases the acquired generation
  (`:95, 122, 143, 153, 184, 194, 203, 208, 241, 256`), `markChatReady` at `:270`; no leak path found.
* No dead API: every new export is used (`resumeWhileCooling`, `pauseReasonOf` and the three constants
  in `LlamaService`/`thermalResume`); `coolingStatus` is constructed in every `ComposerPhaseInput`
  site; `tsc` EXIT 0.
* Note carried from the reports and re-verified: the app pin is still
  `github:Aspis0/kalsa.rn#463f11f9f47ff0b235267e3bb29136ad8cbbbb13` (`package.json:50`, provenance
  EXIT 0), so with `pause_reason` absent the whole cooling path is inert on a device until the pin
  bump — implemented structurally, unobservable today.

## What this audit could not verify

* No device run, no adb. F1/F2/F7 are code-path arguments with the lines quoted, not observed rows.
* The tool-fallback and utility completion sites were read, not executed (no harness for
  `LlamaService.streamAssistantTurn`).
* The binding classification ("thermal" only for a multi-token batch,
  `llama.rn-kalsa cpp/rn-llama.cpp:694-700`; the pause is recorded only at the prompt-eval failure,
  `cpp/rn-completion.cpp:1722`) is read read-only; the residual it implies — a `"profile"`/`"reload"`
  pause (including a 40 °C pause landing on a 1-token eval chunk) still resolves as a silent
  empty/truncated turn in the app — belongs to the binding audit, flagged here as PLAUSIBLE.
* `GOVERNOR_COOLING_MAX_MS` expiry shows a failed row (`⚠️ <errors.coolingTimedOut>` via
  `engineTurnStream.ts:266-271` plus the failed row), not the cooling state; not exercised end-to-end.

---

# Re-audit (fix commit `9bb7a1cb`, scope F1 / F6 / F3 / F4)

Worktree `/Users/marco/Projects/kalsa-wt-bench-apk`, detached `9bb7a1cb187ac59fa11780b5b4b1f75ec10797db`
on top of `1caf7ed0`; `git status --short` empty before and after, `git diff 1caf7ed0..9bb7a1cb --name-only`
= `src/engine/LlamaService.ts`, `src/engine/thermalResume.test.ts`, `src/engine/thermalResume.ts`.
Read-only; no repo modification, no delegation. Scratch `/tmp/kalsa-fix2` = `git archive 9bb7a1cb`
(re-verified byte-identical for `thermalResume.ts` against `git show`) plus the real `npm ci`
`node_modules` from the round-1 audit, moved in as a directory (`test -L` false, 484 entries);
`package.json`/lockfile unchanged by this commit, so the install still matches the lockfile.

| Command (scratch) | EXIT |
|---|---|
| 9-suite targeted set (same as round 1) | **0** (9 suites, **124** tests; baseline 120) |
| 5-suite regression neighbors (fileSize, modelSwitchRemote, sendHostOwnership, turnEnsureDispatch, downloadFlow) | **0** (25 tests) |
| `npx tsc --noEmit` | **0** |
| `bash scripts/assert-engine-provenance.sh` (worktree) | **0** (`OK: 1119 files match Aspis0/kalsa.rn@463f11f9f47f`) |
| 12 sabotages + 2 scratch probes | matrix below |

## F1 — CONFIRMED fixed, and correct for every exit

> `src/engine/LlamaService.ts:5102` — `if (bailIfStopped()) return;`
> `:5099-5101` — `// A stop, a finish, or an invalidation (model switch / dispose — / // neither aborts this controller) ends the turn the way it always / // has; only a turn still alive can reach the bound-expiry failure.`

* **stop**: `aborted` is set by `abort()` from the signal listener; `bailIfStopped()`'s first branch
  (`:4681-4684`) re-runs `finishOnce(() => callbacks.onDone())`, which is a no-op because
  `aborted ⇒ finished` (`aborted` is set at `:4209` and `finishOnce` at `:4211`, same tick) and
  `finishOnce` sets `finished` before calling its fn (`:4200-4205`). No double `onDone`, no error row.
* **finish**: any `finished && !aborted` state takes the same first branch and returns silently.
* **invalidation**: `disposing || engine !== context` → `bailIfStopped` sets `aborted`, marks
  `assembleOutcome` invalidated and emits `turnInterrupted` (`:4702-4707`) — the same outcome every
  other invalidation point in the turn already produces, and the one F1 asked for. The dispose path
  itself emits nothing, so there is no duplicate row.
* **real expiry**: `bailIfStopped()` false → `:5103` `pauseReasonOf(result) === "thermal"` → the
  `errors.coolingTimedOut` row. Only a live turn can get there: the loop's only exit that keeps a
  thermal result is the bound break (`thermalResume.ts:167-170`), and the comment at `:5104-5108`
  says exactly that. **The comment is now true.**
* The module's own `signal?.aborted` check cannot outrun the caller: `LlamaService.ts:4331-4334`
  (`if (signal?.aborted) { onAbort(); ... return; }`) and the listener at `:4330` guarantee
  `signal.aborted ⇒ aborted`, so `thermalResume`'s `stopped()` (`thermalResume.ts:156`) and the
  caller's `bailIfStopped()` agree. The pre-aborted-signal hole I hunted does not exist.
* Sabotage **SI** (revert `:5102` to `if (aborted) return;`) stays green — the fix is review-only,
  which the writer declared (F5, no `LlamaService` harness). No regression test exists for it.

## F6 — CONFIRMED: the pair cannot break; one outcome label lies

* **No exit without enter**: the `end` call sits inside `if (coolingSince !== null)`
  (`thermalResume.ts:192-197`) and `coolingSince` is assigned only on the `start` path (`:164-166`);
  a first-attempt rejection leaves `coolingSince === null` → zero lines (probe 2 confirmed:
  `seen === []`). Sabotage **SG** (emit `end` unconditionally) → **EXIT=1** (2 failed).
* **No double enter / double exit**: `coolingSince` is set once per `resumeWhileCooling` call and the
  `finally` runs once; one episode = one pair, and `round` in the line separates episodes of one turn.
* **No text leak**: the payload is `{turnId, round, phase, waitedMs, batt_temp_tenths_c, outcome}`
  (`LlamaService.ts:5058-5065`) — counter, int, two literals, two numbers/null. One log site only
  (`grep -rn KALSA_THERMAL_COOLING src` → 2 hits, one of them the comment). No lab script parses the
  line yet (`grep -rn KALSA_THERMAL_COOLING ~/Projects/kalsa-moe-experiments` → only the two agent
  documents), so the shape change breaks no consumer.
* **New, low — a retry that THROWS is labelled `outcome: "resumed"`.** Scratch probe (not committed):
  `attempt` = `[paused, rejects("boom")]` → `paused` forced the episode open, the retry rejects, and
  the finally (`:191-197`) computes `boundExpired ? "timeout" : stopped() ? "stopped" : "resumed"`.
  Nothing set `isStopped()` and the finally runs while unwinding, so the line is
  `KALSA_THERMAL_COOLING {..., "outcome":"resumed"}` for an attempt that never resolved — against
  the type's own doc, `":66 /** The last attempt resolved without a thermal pause. */"`.
  Reachable: the retry is `engine.completion(...)`, which throws on real decode failures/errors. The
  user impact is nil; the lab's evidence is wrong exactly where a cooling retry died. Two-line fix:
  wrap `result = await attempt()` (`:189`) and set a distinct end reason (or derive "resumed" from
  `pauseReasonOf(result) !== "thermal"`).
* Enter-line shape (cosmetic, message vs code): on `start`, `detail()` has no `endReason`, so
  `"outcome"` is absent and `"batt_temp_tenths_c"` is `null` while `"waitedMs"` is `0` (`:157-161`);
  the commit message describes the line as always carrying `outcome`. The code is fine; a lab reader
  must expect the enter line to be number-less.
* Sabotage **SL** (inject `msg: strings.chat.coolingStatus` into the log object) stays green: log
  purity is guarded by review only (declared F5).

## F3 / F4 — CONFIRMED: the requested tests go red

| # | Sabotage (scratch, `git archive`d tree per run) | Suite | EXIT | Failing test |
|---|---|---|---|---|
| SA | drop the post-`refreshThermo` `stopped()` (`thermalResume.ts:184`) | thermalResume | **1** | "a stop landing inside the thermo refresh never reaches the retry (the last gate)" (`test.ts:147`) |
| SB | `GOVERNOR_COOLING_MAX_MS` `10*60_000` → `5*60_000` | thermalResume | **1** | "the shipped numbers…" (`test.ts:219`) |
| SC | `GOVERNOR_COOLING_POLL_MS` `10_000` → `5_000` | thermalResume | **1** | same |
| SD | `readingAllowsResume` `< 400` → `<= 400` | thermalResume | **1** | "exactly 400 tenths is AT the warn line…" (`test.ts:244`) |
| SE | swap `resumed`/`stopped` in the `endReason` derivation | thermalResume | **1** (3 failed) | the three endReason assertions (`test.ts:84/144/196`) |
| SG | emit `end` even when `coolingSince === null` | thermalResume | **1** (2 failed) | the two zero-episode tests |
| SH | drop the post-`wait` `stopped()` (`thermalResume.ts:173`) | thermalResume | **1** | abort-mid-wait test |
| SF | drop `|| signal?.aborted === true` from `stopped()` | thermalResume | **0** | non-issue: in production `signal.aborted ⇒ aborted` (see F1), and the test's own `isStopped` reads the signal |
| SI | revert the F1 fix (`:5102` → `if (aborted) return;`) | thermalResume+engineTurnEnsure | **0** | declared F5 gap, review-only |
| SL | add a text field to the cooling log | thermalResume | **0** | declared F5 gap, review-only |
| SC2 | keep the constant but double its use: `maxCoolingMs = GOVERNOR_COOLING_MAX_MS * 2` | thermalResume | **0** | residual F4 gap: the literal is pinned, the applied budget is not |

All restores re-verified green (`RESTORE_EXIT=0` for the last one). The two probes were deleted from
the scratch afterwards; the worktree never saw them.

## Regressions introduced by `9bb7a1cb` — none found

The diff is the cooling block plus the F1 line; no new files, no new export left unused
(`CoolingDetail`/`CoolingEndReason` are constructed and asserted), `onCooling` has exactly one
production implementor (`LlamaService.ts:5054`), `tsc` 0, 14 suites green, provenance unchanged
(`package.json` untouched). The F1 call happens after `stopStallWatchdog()` (`:5084`) and after the
adoption latch, so a stopped turn still records adoption and clears its timers first; `bailIfStopped`
is idempotent. The `stopped()` widening only stops the loop earlier, never later.

## Out of scope (declared, not re-raised)

F2 (tool-fallback / utility completions), F7 (CRITICAL hides Stop under `tooHot`), F8
(`statusHistory` growth), F9 (translated-label coupling), F10 (duplicated wait helper), F11 (no
ratchet over `src/engine`) — unchanged by this commit and none of them blocks a device session
(no crash, no wedge, no data loss; F2/F7 need a hot device plus exhausted tool rounds / an OS CRITICAL
edge). Not re-raised beyond this line.

## Re-audit limits

No device run: F1 and the two log lines are code-reviewed (plus the module probes), not observed in
logcat. The full-suite claim (235 suites / 2489 tests) was not re-run — targeted suites only, per
instruction; the 9-suite delta (120 → 124) matches the +4 tests in the diff.

**Verdict: SHIP.** F1 is correct for all four exits and its comment now tells the truth; the
enter/exit pair is structurally and test-guaranteed; the requested gates go red on sabotage. The
open items are one low-severity evidence bug (R1: `outcome: "resumed"` on a throwing retry), one
residual test gap (the applied cap can double while green), and the declared F5 review-only surface.

---

# Re-audit 2 (fix commit `b2c39305`, non-thermal pauses / telemetry truth)

Worktree `/Users/marco/Projects/kalsa-wt-bench-apk`, detached `b2c3930540a5ec4ed1ed26f35b996c811cc8008b`
on top of `9bb7a1cb`; `git status --short` empty before and after, `git diff 9bb7a1cb..b2c39305
--name-only` = `src/engine/LlamaService.ts`, `src/engine/governorPauseWiring.test.ts` (new),
`src/engine/thermalResume.ts`, `src/engine/thermalResume.test.ts`. Read-only, no delegation.
Scratch `/tmp/kalsa-fix3` = `git archive b2c39305` (byte-verified against `git show` for
`thermalResume.ts`) + the real `npm ci` `node_modules` moved in as a directory (`test -L` false, 484
entries; no manifest touched by the commit).

| Command (scratch unless noted) | EXIT |
|---|---|
| 10-suite targeted set (round-2 nine + `governorPauseWiring.test.ts`) | **0** (135 tests; report claims 135) |
| 5-suite regression neighbors | **0** (25 tests) |
| `npx tsc --noEmit` | **0** |
| `bash scripts/assert-engine-provenance.sh` (worktree) | **0** |
| 9 sabotages | 7 red, 2 green — matrix below |

## What the commit does, verified

1. **CONFIRMED — non-thermal pauses end visibly at both turn sites.**
   `governorPauseEnding` (`thermalResume.ts:46`) maps `thermal → "coolingTimedOut"`, every other
   reason `→ "serviceUnreachable"`, nothing else `→ null`; `endOnGovernorPause`
   (`LlamaService.ts:3122-3153`) logs `KALSA_GOVERNOR_PAUSE {turnId, round, reason}` and routes through
   `emitEngineError`; called after `bailIfStopped()` at the round (`:5145-5150`) and at the fallback
   (`:5547-5561`), both before `recordBenchCompletion`/`emitTurnTelemetry`, i.e. a paused result can no
   longer fall into `emitFinalText`/the onDone finals. Sabotages **RC** (drop `unexplained`) →
   EXIT=1 (2 failed) and **RD** (swap the mapping) → EXIT=1 (4 failed), so the mapping itself is
   behaviourally pinned.
2. **CONFIRMED — no thermal pause now fails where it should cool.** At the round, only a *live* turn
   can carry a thermal result past the cooling loop, and the loop's only exit that keeps one is the
   bound break (`thermalResume.ts:167-170`): the other exits are non-thermal or `stopped()` and are
   caught by `bailIfStopped()` (`:5145`); a throwing retry propagates instead of returning. The
   fallback does end a thermal pause on `coolingTimedOut` with no cooling wait — the writer's declared
   residual ("no auto-resume at this site"), and the only place the earlier owner rule (≥40 °C →
   Cooling down + auto-resume) is knowingly not applied.
3. **CONFIRMED — my round-2 R1 is fixed.** `retryFailed` is set in the catch and the error is
   rethrown unchanged (`thermalResume.ts:222-230`), the end reason checks `stopped()` first
   (`:236-243`), and the new test pins `rejects.toBe(boom)` + `endReason === "failed"`. Sabotage
   **RE** (`retryFailed = false`) → EXIT=1. A stop-caused rejection still reads `stopped`, as declared.
4. **CONFIRMED — `waitedMs` is wait-only.** `elapsedMs = wallMs - retryGenerationMs`,
   `generationMs` is a separate field (`thermalResume.ts:186-195`) and rides the exit JSON
   (`LlamaService.ts:5105`). The new test pins 100_000 wait vs 60_000 generation → sabotage **RF**
   (fold generation back in) → EXIT=1. The declared multi-cycle residual is a reading nuance, not an
   arithmetic error: `waitedMs + generationMs` reconstructs wall time.
5. **CONFIRMED — the APPLIED budget is pinned.** The new clock-in-wait test asserts 3 attempts at
   exactly 600_000; my round-2 mutation (constant kept, use doubled) now goes red: **RG** →
   EXIT=1.

## New findings

* **RG2 — CONFIRMED (test hygiene, low): the new wiring guard pins the call, not the ending.**
  `governorPauseWiring.test.ts:18` asserts `noComments.match(/endOnGovernorPause\(/g)` has length 3 —
  a text count. Sabotage **RA** (round site: `if (endOnGovernorPause(...)) { return; }` → a bare call,
  the failure then falls through into the round loop) and **RH** (same at the fallback) both stay
  **EXIT=0**. RH has teeth in production: there is **no further `bailIfStopped()`** after
  `LlamaService.ts:5547` in the fallback path (the next one is outside the block), so an ignored return
  appends `errors.toolRoundsExhausted` (`LlamaService.ts:5644-5645`) after the pause error — exactly the false
  sentence this commit removed. The committed code is correct; the outcome is unpinned. A shape
  assertion (`/if \(\s*endOnGovernorPause/`) or the round-trip through a tiny extractable function
  would close it.
* **RI — CONFIRMED (declared gap): log purity is review-only.** Injecting
  `msg: String((result as { text?: unknown }).text ?? "")` into the `KALSA_GOVERNOR_PAUSE` payload
  keeps all 28 targeted tests green. The committed line is numbers/literals only
  (`LlamaService.ts:3133-3139`), but nothing red would stop a future text field — same no-harness
  surface the writer declared.
* **Claim accuracy — CONFIRMED, low.** Both the commit message and the report say the helper
  "applies it at every completion site"; the file has six `engine.completion(` sites and the helper has
  two callers. Not wired: `extractMemory` (`:6126`), `translateText` (`:6356`), `completeOnce`
  (`:6477`). Impact is limited (a paused translate already surfaces the caller's generic
  `error: true`, `useTranslateMessage.ts:109-111`; a paused extract stores no facts), and the utility
  residual was already declared out of scope — the wording, not the code, is wrong.
* **PLAUSIBLE, low — copy.** `chat.serviceUnreachable` reads "Couldn't reach the AI service. Please
  try again." (`en.ts:574`) while the ending is a *local* governor refusal (`profile`/`reload`/
  `unexplained`). The sentence points at connectivity. Owner scope says no copy polish, so this is a
  note, not a defect: the failure is at least visible, and `KALSA_GOVERNOR_PAUSE` carries the real
  reason.
* **PLAUSIBLE, low — contract drift.** `pauseReasonOf` is a four-literal whitelist
  (`thermalResume.ts:29-43`); a fifth classified reason added by the binding would be read as "not
  paused" and silently return to the empty-reply path. The binding's `unexplained` exists as its
  catch-all, so today the sets agree; the prewarm classifier's broader
  `typeof pause_reason === "string" && !== ""` check is the reminder that the two sides are not
  mechanically tied.

## Regressions from `b2c39305` — none found

`bailIfStopped()` replaced `if (aborted) return;` at the fallback *after* `stopStallWatchdog()`
(`:5537`), so a stop still clears its timers; the invalidated case now ends with `turnInterrupted`
instead of recording a partial, consistent with every other invalidation point; the round's helper is
after the adoption latch, so KV adoption evidence is unchanged; `KALSA_THERMAL_COOLING` gained one
field only; no new export is unused (`governorPauseEnding`, `CoolingEndReason "failed"`,
`CoolingDetail.generationMs` all consumed); `package.json` untouched, provenance EXIT=0; 15 suites
green. The only behaviour deliberately given up at the fallback (no cooling wait) is declared.

## Re-audit 2 limits

No device run: the helper's runtime ending, `emitEngineError → onError`, and both log lines remain
code-reviewed (the writer's declared F5 no-harness gap, confirmed by RI/RA/RH staying green). The
full-suite claim (236 suites / 2500 tests) was not re-run — targeted only, per instruction; the
10-suite count matches the report.

**Verdict: SHIP.** The scoped items hold: non-thermal pauses end visibly through one mapping, the
fallback is wired, a throwing retry reads `failed`, `waitedMs`/`generationMs` are pinned, and the
applied budget now goes red when doubled. Open items are one unpinned return-shape (RG2, with a real
consequence at the fallback), the declared review-only log purity, an overstated "every completion
site" claim, a misleading generic copy on local refusals, and the whitelist-drift risk — none of them
changes the committed behaviour or blocks a device session.

---

# Re-audit 3 (fix commit `bad66ec2`, fallback cooling + utility refusals + guarded wiring)

Worktree `/Users/marco/Projects/kalsa-wt-bench-apk`, detached `bad66ec2a7f72a8e3c77911c359bf361d1d27da6`
on top of `b2c39305`; `git status --short` empty before and after; `git diff b2c39305..bad66ec2
--name-only` = `src/engine/LlamaService.ts`, `src/engine/governorPauseWiring.test.ts`,
`src/engine/thermalResume.ts`, `src/memory/memoryTelemetry.ts`. Read-only, no delegation. Scratch
`/tmp/kalsa-fix4` = `git archive bad66ec2` (byte-verified against `git show` for `LlamaService.ts`) +
the real `npm ci` `node_modules` moved in (`test -L` false; the commit touches no manifest).

| Command (scratch unless noted) | EXIT |
|---|---|
| 10-suite targeted set (round-3 ten, `governorPauseWiring` included) | **0** (137 tests) |
| 5-suite regression neighbors | **0** (25 tests) |
| `npx tsc --noEmit` | **0** |
| `bash scripts/assert-engine-provenance.sh` (worktree) | **0** |
| 10 sabotages | 5 red, 5 green — matrix below |

## What the commit does, verified

* **Fallback cools — CONFIRMED.** `coolingRound(roundForLog, attempt)` (`LlamaService.ts:4952`) is one
  factory; the round calls `resumeWhileCooling(coolingRound(round, runCompletionRound))` (`:5159`) and
  the fallback `resumeWhileCooling(coolingRound(MAX_TOOL_ROUNDS, runFallbackRound))` (`:5570-5572`),
  the fallback's `engine.completion` body moved into the arrow unchanged. A thermal pause there now
  waits/resumes; `endOnGovernorPause` sees only unresumable pauses — the doc claims at `:3119-3126`
  and `thermalResume.ts:44-46` ("every turn completion site runs that loop first") are now true.
* **Stop / switch during the fallback wait — CONFIRMED safe.** The shared listener keeps
  `isStopped: () => finished || aborted || disposing || engine !== context` (`:4959`), the caller does
  `bailIfStopped()` at `:5583` before `endOnGovernorPause` (`:5585`), so an invalidation ends as
  `turnInterrupted`, never `coolingTimedOut` — same shape as the round, and `stopStallWatchdog()`
  (`:5573`) still runs before the bail.
* **No double listeners / broken log pairs — CONFIRMED.** Each `coolingRound` call builds a fresh
  listener and episodes are sequential (one round at a time, one fallback); `resumeWhileCooling` emits
  one `start` and one `end` per episode, the fallback's `round` is `MAX_TOOL_ROUNDS` (distinct from
  `0..MAX-1`), and the wait registers at most one abort listener (`thermalResume.ts:142`, `{ once:
  true }` plus explicit removal). A thermal resume at the fallback logs the pair with
  `outcome: "resumed"` and no `KALSA_GOVERNOR_PAUSE`; only the bound logs both.
* **Utility refusals — CONFIRMED, no paused output is consumed.** `utilityGovernorPause` (`:3167`)
  logs `KALSA_GOVERNOR_PAUSE {site, reason}` (two literals only) and returns the predicate; used as a
  condition at `extractMemory` (`:6183` → `stopReason = "governor_paused"`), `translateText` (`:6414`
  → the existing `{ text: "", truncated }`), `completeOnce` (`:6550` → the catch shape). Each sits
  after the abort/KV checks, so nothing partial is parsed.
* **Persisted `governor_paused` — CONFIRMED safe, log literal only.** The value flows
  `LlamaService.ts:6184` → `MemoryExtractResult.stopReason` → `engineTurnMemory.ts:206-210`
  `extractDetails` → the `KALSA_MEMORY_EXTRACT` console line (`engineTurnMemory.ts:84-102`); no store,
  no UI mapping. `engineTurnMemory.ts:216` `if (extractResult.stopReason !== "done") return;` stops
  the paused extraction from applying, `parseOutcome` stays `0` ("did not run",
  `MemoryStore.ts:131`), and the numeric `extractStopReason` stays `0` ("extraction attempted") — the
  same convention `timeout`/`aborted_by_send` already use. The mirrored union
  (`memoryTelemetry.ts:55`) is the only second copy (`engineTurnMemory.ts:21` imports the type).
* **My RG2 hole is closed — CONFIRMED.** The guard now matches the *guarded* shape
  (`governorPauseWiring.test.ts:27-31`); sabotages **S2** (fallback) and **S3** (round), modelled as
  bare calls, are **EXIT=1** each — the round-2 RA/RH green is gone.

## Sabotage matrix (scratch, serial, real `npm ci` tree)

| # | Sabotage | Target | EXIT | Reading |
|---|---|---|---|---|
| S1 | unwrap the fallback loop (`runFallbackRound()` only) | wiring | **1** | `resumeWhileCooling(` === 2 pins both sites |
| S2 | fallback `endOnGovernorPause` guarded → bare | wiring | **1** | RG2 closed |
| S3 | round `endOnGovernorPause` guarded → bare | wiring | **1** | RG2 closed |
| S4 | fallback attempt → `coolingRound(MAX_TOOL_ROUNDS, runCompletionRound)` | wiring, thermalResume | **0** | *site↔attempt binding unpinned* (the fallback would run the main round's completion) |
| S5 | extract body `stopReason = "governor_paused"` → `"done"` | wiring, MemoryStore | **0** | *guard pins the condition + site literal, not the body* |
| S6 | drop the translate check | wiring | **1** | site condition pinned |
| S7 | mute the utility logger | wiring | **1** | `KALSA_GOVERNOR_PAUSE` === 2 pinned |
| S8 | inject `msg: result.text` into the utility log | wiring, thermalResume | **0** | log purity review-only (declared no-harness) |
| S9 | fallback `roundForLog` → `0` | wiring, thermalResume | **0** | log-only field, harmless |
| S11 | `utilityGovernorPause` predicate inverted (never detects) | wiring, thermalResume | **0** | *helper body unpinned* (structure-only guard, no unit test) |

All restores were re-verified green. S8 and S11 are the declared F5 class (no `LlamaService` harness;
the guards are source-shape only). S4/S5 are new instances of the same class and worth a line in the
next round: the guard could also pin `coolingRound\(MAX_TOOL_ROUNDS, runFallbackRound\)` and
`stopReason = "governor_paused"` as literals for free.

## New findings (all low)

1. **PLAUSIBLE — a throwing fallback retry still ends on the false copy.** `runFallbackRound` is
   inside the pre-existing `catch (fallbackError)` (`:5648`): a retry that *throws* (not
   pauses) is logged/swallowed there and the turn falls through to
   `strings.errors.toolRoundsExhausted` (`:5681`) — while `KALSA_THERMAL_COOLING` reported
   `outcome: "failed"`. Pre-existing fallback error policy, not a regression; copy-only, out of scope.
2. **PLAUSIBLE — two `KALSA_GOVERNOR_PAUSE` shapes now exist.** The turn helper logs
   `{turnId, round, reason}` (`:3138-3144`), the utility helper `{site, reason}` (`:3174`) with
   `site: "translate"` while the function is `translateText`. A lab parser must branch, and a research
   turn calling `completeOnce` twice (plan + write) emits two identical utility lines with no turn id.
   No parser exists yet (`grep` over the two worktrees), so nothing breaks today.
3. **REFUTED — "utilities persist a new state".** `governor_paused` reaches no store, no UI label and
   no parse path; verified above. `MemoryExtractStopReason` gained a literal and its mirrored union
   was extended (tsc EXIT=0; no third copy — `grep -rn aborted_by_send src` lists only the two
   declarations and the assignments).

## Regressions from `bad66ec2` — none found

`resumeWhileCooling` is now called twice per turn at most, each with its own budget (per-episode
10 min, as before per round); the cooling listener's UI/deadline actions are unchanged; the fallback
keeps `stopStallWatchdog` → adoption latch → `bailIfStopped` → helper ordering; `package.json`
untouched, provenance EXIT=0; 15 suites + tsc green. No API left unused (`CoolingLoopOptions` import is
the factory's type; `utilityGovernorPause` has three callers).

## Re-audit 3 limits

No device run: the fallback's runtime cooling, the three utility returns and both `KALSA_GOVERNOR_PAUSE`
lines remain code-reviewed (S8/S11 and the F5 gap are that limit made visible). The full-suite claim
(236 suites / 2502 tests) was not re-run — targeted only, per instruction; my 10-suite count is one
suite short of the report's 11 (they included a neighbor I did not), tests 137 vs 138.

**Verdict: SHIP.** The fallback now cools through the same loop and only unresumable pauses end it;
the three utility completions refuse paused output without consuming or persisting it; the ignored-
return hole I raised in round 2 goes red at both sites; stop/switch during the fallback wait is
honest; no regressions. Remaining items are source-guard depth (S4/S5/S11) and cosmetic log-shape /
pre-existing catch-policy notes — none changes the committed behaviour or blocks a device session.

---

# Re-audit 4 (commit `2602729d`, emitters moved to `governorPauseLog.ts`)

Worktree clean at `2602729d398c6098b6a8e29827f860d2c0e75629`, read-only, no delegation. Scratch
`/tmp/kalsa-fix5` = `git archive 2602729d` (byte-verified) + the real `npm ci` `node_modules`.
Evidence: 11-suite targeted set **EXIT=0** (147 tests), 5-suite neighbors **EXIT=0** (25),
`tsc --noEmit` **0**, provenance **0**, 10 mutations (8 red, 2 green).

**No behaviour change — CONFIRMED.** A scratch probe (not committed) compares the moved builders
against the exact old-format strings and passes byte-for-byte, e.g.
`KALSA_THERMAL_COOLING {"turnId":"3","round":0,"phase":"enter","waitedMs":0,"generationMs":0,"batt_temp_tenths_c":null}`
and `KALSA_GOVERNOR_PAUSE {"site":"translate","reason":"thermal"}`; key order is unchanged by
construction (`governorPauseLog.ts:50-58` vs the bad66ec2 inline object). Call sites and guard order
are unchanged: the turn helper logs at `LlamaService.ts:3143` inside its try, then `emitEngineError`
(`:3147`); the listener logs at `:4942-4949` inside `phase === "start" || "end"` and only then hits
`if (finished || aborted) return;` (`:4954`); the utility sites are untouched. `endOnGovernorPause`
now derives `reason = pauseReasonOf(result)` (null → false, `:3140-3141`) and the copy from
`governorPauseEnding(result)` (`:3152`) — the same synchronous field read, so the comment at `:3151`
("reason non-null pins the ending non-null") is true. The raw keys exist as code only in
`governorPauseLog.ts:24/50` (the two `LlamaService` hits are comments).

| Mutation (scratch) | EXIT | Reading |
|---|---|---|
| T1 `waitedMs` → `waitMs` | **1** (2 failed) | payload pinned |
| T2 utility line logged twice | **1** (4 failed) | per-event cardinality pinned |
| T3 raw duplicate emitter in `LlamaService` | **1** | "no raw emitter in the turn file" pinned |
| S8a trailing text on the utility line | **1** (4 failed) | round-4 S8 now **red** |
| S8b extra `msg` field in the event | **1** (4 failed) | round-4 S8 now **red** |
| S11c returns `false` after logging | **1** (4 failed) | round-4 S11 now **red** |
| T4 reorder the cooling-line keys | **0** | key *order* not pinned (`toEqual` is order-insensitive); harmless for JSON consumers, a raw-regex parser would be the only loser — no parser exists |
| T5 helper builds the line but drops `console.log` | **0** | the helper's console wrapper is text-pinned, not effect-pinned — declared F5 class |
| S5 extract body `stopReason = "governor_paused"` → `"done"` | **0** | unchanged: the body literal is outside the new module's reach |

Type-system note: the crude S11 variants (invert the null check) do not even compile — the log call
would see `GovernorPauseReason | null` — so the helper's decision is guarded by narrowing as well as
by the new runtime assertions (`governorPauseLog.test.ts:28-36`).

Asked greens: **S8 → RED, S11 → RED** (both closed by the new unit test); **S5 → still GREEN**
(pre-existing, unrelated to this refactor). New low notes: key-order and the helper's console wrapper
(T4/T5) are unpinned; no other regression found.

**Verdict: SHIP.** The refactor is behaviour-neutral (byte-identical payloads, same sites, same guard
order), and the new tests go red on the payload, cardinality, raw-emitter and utility-decision
mutations, including two of my earlier test-gap greens. Remaining greens are key ordering, the
helper's log wrapper and the extract body literal — all cosmetic or the declared no-harness class.
