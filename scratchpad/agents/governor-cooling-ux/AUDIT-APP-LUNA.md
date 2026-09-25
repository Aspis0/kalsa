# App audit — Luna

Read-only review of `/Users/marco/Projects/kalsa-wt-bench-apk`, range `67ade7a8..9bb7a1cb`. At start: detached `9bb7a1cb187ac59fa11780b5b4b1f75ec10797db`, clean tracked/untracked status. No app-repo files changed. No device run.

## Findings

1. **CONFIRMED — blocker: the shipped binding cannot trigger cooling.** The app pins `package.json:50` to `github:Aspis0/kalsa.rn#463f11f9f47ff0b235267e3bb29136ad8cbbbb13`. Its installed `NativeCompletionResult` (`node_modules/llama.rn/src/types.ts:534-573`) ends with `context_full`, `interrupted`, `tokens_cached`, `timings`, and has no `pause_reason`; JSI emission at `cpp/jsi/JSICompletion.h:175-187` likewise emits no pause field. The app returns null for a missing field (`src/engine/thermalResume.ts:31-36`: `return reason === "thermal" || reason === "profile" || reason === "reload" ? reason : null;`) and enters its loop only for thermal (`:163`: `while (pauseReasonOf(result) === "thermal" && !stopped())`). Thus this app pin cannot show Cooling down or auto-resume a native governor pause. Binding HEAD `b23fc083` does emit `pause_reason` (`cpp/jsi/JSICompletion.h:192`, `src/types.ts:582`), but this app does not pin it.

2. **CONFIRMED — chat tool-fallback completion bypasses cooling.** The ordinary round is wrapped at `src/engine/LlamaService.ts:5049-5053` (`attempt: runCompletionRound`, `refreshThermo`, `onCooling`). The fallback instead directly calls `engine.completion` at `:5460-5475`; it never calls `resumeWhileCooling` or checks `pauseReasonOf`. With a resolved thermal-pause result and no text, `:5539-5559` leaves `fallbackOk` false and `:5594-5597` emits `strings.errors.toolRoundsExhausted`. That is a false error instead of cooling/auto-resume. This becomes reachable when the app moves to a binding that reports pause outcomes. Utility completions at `:6076`, `:6306`, and `:6427` also bypass the loop; lower impact.

3. **CONFIRMED — the device evidence can report a failed retry as resumed.** `src/engine/thermalResume.ts:189` awaits the retry, then `finally` at `:191-197` chooses `boundExpired ? "timeout" : stopped() ? "stopped" : "resumed"`. A rejected retry with a live turn takes the last arm. This contradicts the type comment at `:66` (“The last attempt resolved without a thermal pause.”). In the scratch-copy probe, `[thermal pause, rejected retry]` rejected to the caller while the captured end reason was `resumed` (Jest exit 0 for that isolated probe). This corrupts `KALSA_THERMAL_COOLING` evidence.

4. **CONFIRMED — logged `waitedMs` includes retry generation time.** `CoolingDetail.elapsedMs` is `now() - coolingSince` (`thermalResume.ts:157-160`); the retry starts at `:189`, and the end detail is created only after it settles in `finally` (`:192-195`). `LlamaService.ts:5062` writes that value as `waitedMs`. A slow successful retry is therefore counted as cooling wait. The line carries no user/model text (`:5058-5065`: `turnId`, `round`, phase literal, elapsed number, thermo number/null, outcome); `turnId` is a counter (`:4172`).

5. **CONFIRMED — an OS thermal gate removes Stop during an active cooldown.** `src/host/composerPhase.ts:42` returns `tooHot` before checking `sending`; `composerState.ts:117` maps `tooHot` to `face: "send"`, and `:158-160` disables a held send face. The active loop's stop predicate (`LlamaService.ts:5052`) does not include the OS thermal gate. If that gate rises during cooling, the UI no longer offers the Stop action while the wait continues.

6. **CONFIRMED — a model-switch request can be silently dropped during a long cooldown.** `regenState.ts:73-76` queues model IDs while `sendClaimRef` is held. `modelSwitch.ts:264-274` waits at most 5 seconds and drains the queue if sending remains active. The cooling completion can stay active up to 10 minutes (`thermalResume.ts:50-52`), while `sendHost.ts:322-324` releases the send claim only in the send's `finally`. A switch requested through `selectModelById` during a longer cooling episode is therefore discarded without dispatch.

7. **PLAUSIBLE — Stop during the send's own lazy load can leave stale turn preparation running.** `engineTurn.ts:172-176` returns true immediately when `ensureEngineForModel` succeeds; the abort check at `:181-184` is only in the failed-ensure branch. The load path has no send signal (`engineEnsure.ts:247-255`), so Stop cannot cancel that ensure. `sendStop.ts:87-127` retires/unlocks after 3 seconds; a late successful ensure can then continue into window preparation and `streamEngineTurn` (`engineTurn.ts:297-324`) beside a newer send. The eventual LlamaService call does reject a pre-aborted signal before completion (`LlamaService.ts:4330-4335`), but no test covers this own-load/second-send interleaving. I did not establish resulting persisted-history corruption.

8. **CONFIRMED test gap — the applied 10-minute budget is not pinned.** The scratch sabotage changed the default from `GOVERNOR_COOLING_MAX_MS` to `GOVERNOR_COOLING_MAX_MS * 2`; `thermalResume.test.ts` still passed all 17 tests (exit 0). The existing test checks the constant value, not the default actually supplied to the loop.

## Refuted / no issue established

- **REFUTED — ordinary Stop during the cooling wait is cancellable.** `sendStop.ts:77` aborts the controller; `thermalResume.ts:104-116` clears the timer on abort, and `:172-184` checks stop after wait and after refresh. `LlamaService.ts:5052` includes `aborted` and `:5102` calls `bailIfStopped()` before timeout handling.
- **REFUTED — a second send can enter while the first cooling send owns its claim.** `sendHost.ts:148-155` claims before its first await, `sendEntryGuards.ts:27-34` refuses while claimed/sending, and `sendHost.ts:322-324` releases in `finally`.
- **REFUTED — the in-flight-load wait has no stop exit.** `loadSettle.ts:25-37` resolves its sleep on abort; `:43-48` returns `aborted`; `engineTurn.ts:181-184` finishes without a verdict. It has no time bound, but a live Stop resolves it.
- **REFUTED — timers/listeners leak on the normal abort paths.** Both abort-aware wait helpers clear their timeout; normal timeout removes the listener (`loadSettle.ts:25-37`, `thermalResume.ts:104-116`). No unpaired listener was found.
- New `thermalResume.ts` is 200 lines, `loadSettle.ts` 49, and `sendEntryGuards.ts` 36; each has one responsibility. `thermalResume.test.ts` is a 261-line single-topic state-machine test. No new God file found.

## Checks

- Targeted Jest on the app worktree: `npx jest src/engine/thermalResume.test.ts src/engine/prefixPrewarm.test.ts src/host/engineTurnEnsure.test.ts src/host/modelSwitchHold.test.ts src/host/sendSwitchGuard.test.ts src/host/composerPhase.test.ts src/host/composerView.test.ts src/ui/shell/ShellComposer.test.ts --runInBand` — **EXIT=0**, 8 suites / 87 tests.
- Disposable source copy under `/tmp/kalsa-audit-luna-9bb7a1cb`; `npm ci` — **EXIT=0**; `node_modules` and `node_modules/jest` both real directories (`test -L` false).
- Scratch sabotage removing the post-refresh `stopped()` gate: `npx jest src/engine/thermalResume.test.ts --runInBand` — **EXIT=1**, the refresh-stop test failed (second attempt ran).
- Scratch sabotage doubling the applied max wait: same suite — **EXIT=0**, 17 passed.
- Scratch retry-throw probe — **EXIT=0** for the assertion that the rejected retry was labelled `resumed`; scratch probe expecting no retry after the max wait — **EXIT=1** (second attempt ran). Scratch source restored byte-identically to HEAD afterward.
- `git diff --check 67ade7a8..9bb7a1cb` — **EXIT=0**. No full Jest, tsc, native build, or device test was run; this was a read-only targeted audit.

## Verdict

**NO.** The current app pin makes the promised cooling behavior inert; after the binding pin is advanced, the fallback path still bypasses it. Cooling telemetry also misstates failed retries and elapsed waiting. The critical-gate Stop and model-switch races remain device-session hazards.

## Re-audit — b2c39305

Read-only review of `b2c3930540a5ec4ed1ed26f35b996c811cc8008b` on `9bb7a1cb`; app worktree remained clean. No device run.

### Findings

- **CONFIRMED — F2 remains behaviorally incomplete:** main turns use `resumeWhileCooling` (`src/engine/LlamaService.ts:5091`), but tool fallback directly awaits `engine.completion` (`:5495-5500`) and sends its result to `endOnGovernorPause` (`:5547-5560`). `governorPauseEnding` maps thermal to `coolingTimedOut` (`src/engine/thermalResume.ts:50-55`), and the helper emits an error (`LlamaService.ts:3143-3151`). Thus a thermal pause in this reachable fallback path fails immediately; it never shows Cooling down or auto-resumes. The writer explicitly declares this residual in `REPORT.md` lines 255-259. This conflicts with the owner’s thermal-pause behavior.

- **CONFIRMED — F3 fixed for a throwing retry:** retry rejection sets `retryFailed` and rethrows unchanged (`thermalResume.ts:222-232`); end selection reports `failed` unless the turn is stopped (`:234-247`). The exit cooling log uses that `endReason` (`LlamaService.ts:5097-5108`). No false `resumed` for a live retry exception remains. A stop racing with rejection is deliberately labeled `stopped`, due to precedence at `:241-244`.

- **CONFIRMED — F4 fixed for retry generation:** detail computes `elapsedMs = wallMs - retryGenerationMs` and records `generationMs` (`thermalResume.ts:186-193`); exit telemetry emits them separately as `waitedMs` and `generationMs` (`LlamaService.ts:5100-5108`). The test distinguishes 100 s wait from 60 s generation (`thermalResume.test.ts:311-332`).

- **CONFIRMED — F8 applied default is pinned:** the loop defaults `maxCoolingMs` to `GOVERNOR_COOLING_MAX_MS` (`thermalResume.ts:172-176`), whose value is 600,000 ms (`:68-71`). The applied-budget test expects 3 attempts then timeout (`thermalResume.test.ts:335-349`); doubling the actual default made it red.

- **CONFIRMED — main-turn F5 handling is present for non-thermal reasons including `unexplained`:** `pauseReasonOf` accepts all four reasons (`thermalResume.ts:31-39`), the ending map sends each recognized non-thermal reason to `serviceUnreachable` (`:50-55`), and `endOnGovernorPause` logs the reason then emits the existing error (`LlamaService.ts:3122-3152`). It is called after the normal round (`:5145-5149`) and after tool fallback (`:5547-5560`). The added wiring test is explicitly source-shape-only and says the `emitEngineError` → `onError` path is unpinned (`governorPauseWiring.test.ts:1-8`).

- **CONFIRMED — other utility completion paths still accept a pause silently:** memory extraction reads `content`/`text` and parses it without checking `pause_reason` (`LlamaService.ts:6140-6152`; its default stop reason is `done`, `:6009-6011`); translation returns cleaned empty text without a pause check (`:6370-6378`); `completeOnce` returns empty text with `aborted: false` absent a pause check (`:6502-6520`). Prewarm is an intentional exception: it classifies pause and logs a skip (`:1362-1374`), not a user-turn completion. These utility paths are outside the new helper’s two guarded sites.

- **REFUTED — new evidence logs contain user/model text:** `turnId` is a numeric sequence (`LlamaService.ts:4213-4214`). `KALSA_GOVERNOR_PAUSE` serializes only `turnId`, `round`, and `pauseReasonOf(result)` (`:3133-3138`); `KALSA_THERMAL_COOLING` serializes only IDs, numeric wait/generation/temperature values, phase, and outcome (`:5100-5108`). Neither payload contains prompt, response, or model name.

### Tests and mutation checks

- Targeted Jest: `npx jest --runInBand src/engine/thermalResume.test.ts src/engine/governorPauseWiring.test.ts` — **EXIT=0**, 2 suites / 28 tests.
- Disposable scratch copy `/tmp/kalsa-audit-luna-recheck-b2c39305`: `npm ci` — **EXIT=0**; `node_modules` and `node_modules/jest` are real directories, both `test -L` false. All sabotages below ran only there; both modified source files were restored byte-identically (cmp **EXIT=0** each).
- F2 sabotage (rename fallback helper call): wiring Jest **EXIT=1**. This proves the source-shape assertion catches the missing call, not runtime behavior.
- F3 sabotage (force retry-throw end reason to `resumed`): targeted Jest **EXIT=1**.
- F4 sabotage (use wall time directly as elapsed): targeted Jest **EXIT=1**.
- F8 sabotage (double the default cooling bound): targeted Jest **EXIT=1**.
- F5 mapping sabotage (`profile`/`reload`/`unexplained` map to null): targeted Jest **EXIT=1**. Main-round wiring sabotage: source guard **EXIT=1**.
- `git diff --check 9bb7a1cb..b2c39305` — **EXIT=0**; app worktree status remained empty.
- No full Jest, typecheck, native build, or device run; this was a focused re-audit.

### Verdict

**NO.** The targeted fixes and their mutations are sound, but thermal fallback still becomes an immediate failure instead of entering the owner-required cooling/resume path, and utility completions still consume pause results as empty success. The wiring test only verifies source shape, not callback emission.

### Source quotes for the re-audit claims

- **F2:** `LlamaService.ts:5495-5500` — `const fallbackResult = await trackCompletion(` / `engine.completion(`. `thermalResume.ts:55` — `return pause === "thermal" ? "coolingTimedOut" : "serviceUnreachable";`. `LlamaService.ts:3147-3150` — `ending === "coolingTimedOut" ? strings.errors.coolingTimedOut : strings.chat.serviceUnreachable`.
- **F3:** `thermalResume.ts:224-229` — `result = await attempt();` / `retryFailed = true; throw error;`. `thermalResume.ts:243-245` — `: retryFailed ? "failed" : "resumed"`.
- **F4:** `thermalResume.ts:189-192` — `elapsedMs: wallMs - retryGenerationMs` and `generationMs: retryGenerationMs`. `LlamaService.ts:5104-5107` — `waitedMs: detail.elapsedMs`, `generationMs: detail.generationMs`, and `outcome: detail.endReason`.
- **F8:** `thermalResume.ts:174-176` — `maxCoolingMs = GOVERNOR_COOLING_MAX_MS`. `thermalResume.test.ts:347-348` — `expect(attempt).toHaveBeenCalledTimes(3);` / `expect(details.at(-1)?.endReason).toBe("timeout");`.
- **F5:** `thermalResume.ts:34-38` — the four pause literals including `"unexplained"`. `LlamaService.ts:5145-5148` — the live normal-round `endOnGovernorPause` gate. `LlamaService.ts:5551-5558` — the fallback gate. `governorPauseWiring.test.ts:5-8` — `Source-level on purpose ... what stays unpinned is the emitEngineError → onError path itself`.
- **Silent utility results:** `LlamaService.ts:6147-6151` — `const raw = ... result.content ... : (result.text ?? ""); extraction = parseMemoryExtract(raw);`. `:6374-6378` — the same content/text fallback followed by `return { text: cleanTranslationOutput(raw), truncated };`. `:6506-6520` — content/text extraction ending in `return { text, aborted: false };`.
- **Log privacy:** `LlamaService.ts:4214` — `const turnId = String(++turnSeq);`. `:3134-3138` — the pause object keys are `turnId`, `round`, and `reason`. `:5100-5108` — cooling keys are `turnId`, `round`, `phase`, `waitedMs`, `generationMs`, `batt_temp_tenths_c`, and `outcome`.

## Re-audit 2 — bad66ec2

Read-only review of `bad66ec2a7f72a8e3c77911c359bf361d1d27da6` on `b2c39305`. At review start and end the app worktree was clean. No device run.

### Findings

- **CONFIRMED — fallback now enters the same cooling state machine.** The fallback wraps `runFallbackRound` in `resumeWhileCooling(coolingRound(MAX_TOOL_ROUNDS, ...))` (`src/engine/LlamaService.ts:5528-5572`); the normal loop calls the same wrapper (`:5159`). One shared factory owns one `onCooling` listener (`:4949-4990`), and fallback runs only after the serial tool-round loop. `resumeWhileCooling` starts an episode once and emits its end from one `finally` (`src/engine/thermalResume.ts:195-203, 234-248`). Static read shows no duplicate listener or double enter/exit pair per episode.
- **REFUTED — Stop can trigger another fallback attempt:** Stop aborts the signal (`src/host/sendStop.ts:74-78`); the cooling wait clears its timer and resolves on abort (`thermalResume.ts:131-143`), then the loop checks `stopped()` before refresh/retry (`:204-218`). The turn signal listener also calls `abort()` (`LlamaService.ts:4397-4402`). The fallback checks `bailIfStopped()` after the cooling wrapper (`:5570-5583`). Its unit coverage verifies abort during wait gives `start, wait, end`, no refresh/retry, `stopped` (`thermalResume.test.ts:149-168`).
- **REFUTED — a confirmed direct model switch retries against the switched context:** `coolingRound` treats `disposing` and `engine !== context` as stopped (`LlamaService.ts:4955-4959`); the loop checks that predicate after the wait and again after thermo refresh before attempting (`thermalResume.ts:204-218`). `disposeEngineLocked` marks `disposing` and clears `context` before waiting for the job chain (`LlamaService.ts:2916-2924`). A wait already in progress is not awakened by that predicate, so the switch can wait up to the 10 s poll before the turn exits; I found no stale retry/UAF path. **PLAUSIBLE, pre-existing request loss:** `selectModelById` drops a queued switch if send remains active after 5 s (`src/host/modelSwitch.ts:260-274`), longer than one cooling poll. This is a dropped switch request, not concurrent engine use; the direct confirmed switch path is separate (`:295-305`).
- **CONFIRMED — `governor_paused` is diagnostic telemetry, not a stored memory fact.** Extraction sets the reason and skips parsing (`LlamaService.ts:6179-6190`); the host returns before `applyExtractResults` unless the reason is `done` (`src/host/engineTurnMemory.ts:206-228`). It *does* reach the `KALSA_MEMORY_EXTRACT` console line: `emitSettledMemoryTelemetry` passes `details.stopReason` (`:84-102`), and `formatMemoryLine` serializes that enum (`src/memory/memoryTelemetry.ts:54-55, 69-87`). No extracted facts are applied for this outcome.
- **REFUTED — pause logs include user/model text:** `utilityGovernorPause` serializes only its closed `site` and `pauseReasonOf` enum (`LlamaService.ts:3167-3178`); the turn pause line has only `turnId`, `round`, `reason` (`:3137-3144`). The single cooling listener logs IDs, phase/outcome enums, temperature and duration numbers (`:4961-4972`). The memory telemetry formatter enumerates counters and fixed lifecycle fields (`memoryTelemetry.ts:69-87`); it does not serialize extracted fact text.
- **CONFIRMED — tests remain green under two behavior/logging sabotages.** In the scratch copy, changing `utilityGovernorPause` to always return `false` left `governorPauseWiring.test.ts` **EXIT=0** (4 tests); adding a second `KALSA_THERMAL_COOLING` line for each start/end left the wiring + state-machine suites **EXIT=0** (30 tests). The guard test checks call shapes/site names, not utility predicate semantics or emitted line cardinality (`governorPauseWiring.test.ts:18-58`). This leaves the utility refusal and one-pair evidence guarantees unpinned.

### Checks

- Targeted app Jest: `npx jest --runInBand src/engine/thermalResume.test.ts src/engine/governorPauseWiring.test.ts src/memory/memoryTelemetryOrdering.test.ts` — **EXIT=0**, 3 suites / 32 tests.
- Stop/switch targeted Jest: `npx jest --runInBand src/host/modelSwitchHold.test.ts src/host/modelSwitchRemote.test.ts src/host/sendSwitchGuard.test.ts src/engine/thermalResume.test.ts src/engine/governorPauseWiring.test.ts` — **EXIT=0**, 5 suites / 35 tests.
- Scratch `/tmp/kalsa-audit-luna-reaudit2-bad66ec2`: `npm ci` — **EXIT=0**; `node_modules` and `node_modules/jest` are real directories (`test -L` false). Scratch baseline targeted Jest — **EXIT=0**, 3 suites / 32 tests.
- Named writer sabotages independently reproduced: unwrap fallback cooling **EXIT=1**; remove translate guard **EXIT=1**; remove utility logger line **EXIT=1**; ignore fallback `endOnGovernorPause` return **EXIT=1**. Scratch `LlamaService.ts` restored byte-identically (**cmp EXIT=0**). The two green sabotages are listed above.
- `git diff --check b2c39305..bad66ec2` — **EXIT=0**; worktree clean. No full Jest, typecheck, native build, or device run.

### Verdict

**NO.** The runtime wiring looks correct by source inspection, including fallback cooling, stop, and context invalidation. The focused source guard still passes when utility pause detection is disabled and when duplicate thermal log lines are introduced, so the utility refusal and the per-episode evidence cardinality requested here are not protected against regression. No actual duplicate pair, unsafe retry, user/model text leak, or memory-fact write was found in this commit.

## Re-audit 3 — 2602729d

Read-only review of `2602729d398c6098b6a8e29827f860d2c0e75629` on `bad66ec2`. App worktree stayed clean. Scratch mutations only; no device run.

### Findings

- **CONFIRMED — exact utility-disable sabotage is red now.** `utilityGovernorPause` checks the structural pause reason, logs one `{site, reason}` line, and returns true (`src/engine/governorPauseLog.ts:33-42`). The new tests exercise all four reasons and assert `true` plus exactly one log (`governorPauseLog.test.ts:24-37`). In scratch, changing the paused-result return from `true` to `false` made those four cases fail (**EXIT=1**). A first, harsher mutation that removed the null guard failed TypeScript compilation (**EXIT=1**); the return-only mutation confirmed the behavioral assertions run and fail.
- **CONFIRMED — the prior duplicate-emitter sabotage is red.** LlamaService no longer contains raw governor/cooling prefixes; it calls each line builder once (`LlamaService.ts:4942-4949`; the wiring guard checks this at `governorPauseWiring.test.ts:45-55`). Adding a second `thermalCoolingLogLine(...)` call in that listener failed the wiring test (**EXIT=1**). Adding the prior raw `console.log("KALSA_THERMAL_COOLING duplicate")` mutation also failed (**EXIT=1**).
- **CONFIRMED — a close duplicate-output variant remains green.** In scratch I changed the listener to build one `line` and call `console.log(line)` twice. The source guard still saw exactly one builder call and both `governorPauseWiring.test.ts` and `governorPauseLog.test.ts` passed (**EXIT=0**, 14 tests), despite two identical device lines per event. Adding a `console.log(line)` side effect inside `thermalCoolingLogLine` likewise passed (**EXIT=0**). The new line-builder test checks returned string shape and newline absence (`governorPauseLog.test.ts:68-107`); its episode test checks callback phase counts, not console emission count (`:110-133`). This leaves the explicitly requested one-line-per-event evidence guarantee unpinned at the emission site.
- **CONFIRMED — extraction preserved serialized payload bytes and call sites.** `thermalCoolingLogLine` retains the previous ordered fields `turnId, round, phase, waitedMs, generationMs, batt_temp_tenths_c, outcome` (`governorPauseLog.ts:44-58`); `governorPauseLogLine` uses the prior turn and utility key order (`:19-25`). A scratch compatibility Jest fixture comparing against the old JSON expressions from `bad66ec2` passed for turn, utility, enter, and exit payloads (**EXIT=0**, 3 tests). The production diff only replaces inline construction at the same listener with `thermalCoolingLogLine`; the three utility checks remain at their prior call sites (`LlamaService.ts:6159, 6390, 6526`).
- **REFUTED — current implementation duplicates a cooling line:** the listener contains one `console.log(thermalCoolingLogLine(...))` (`LlamaService.ts:4942-4949`), and the builder only returns a string (`governorPauseLog.ts:44-58`). No actual duplicate output path appears in this commit; the issue is the close mutation that the tests miss.

### Checks

- Scratch copy `/tmp/kalsa-audit-luna-reaudit3-2602729d`: `npm ci` — **EXIT=0**; `node_modules` and `node_modules/jest` were real directories (`test -L` false).
- Targeted baseline Jest: `npx jest --runInBand src/engine/governorPauseLog.test.ts src/engine/governorPauseWiring.test.ts src/engine/thermalResume.test.ts` — **EXIT=0**, 3 suites / 40 tests.
- Utility return-disabled mutation — **EXIT=1** (4 failures); raw duplicate cooling line — **EXIT=1**; second builder call in listener — **EXIT=1**. Close variant logging the same built line twice — **EXIT=0**, 14 tests; builder-side logging variant — **EXIT=0**, 14 tests. Restored scratch source files matched originals (`cmp` **EXIT=0** each).
- Byte-compatibility fixture — **EXIT=0**, 3 tests. Its first draft had a fixture-only TypeScript union error (**EXIT=1**); the corrected fixture passed.
- `git diff --check bad66ec2..2602729d` — **EXIT=0**; app worktree status remained empty. No full Jest, typecheck, native build, or device run.

### Verdict

**NO.** The two exact sabotages from Re-audit 2 are caught, and the current extraction preserves payload bytes and call sites. However, a direct double-`console.log` at the listener using one builder call remains green, so the tests do not fully pin the one-line-per-event device evidence requirement.

### Source quotes

- **Utility decision:** `governorPauseLog.ts:34-42` — `const reason = pauseReasonOf(result);`, `if (reason === null) return false;`, `console.log(governorPauseLogLine({ site, reason }));`, `return true;`.
- **Cooling emission:** `LlamaService.ts:4942-4949` — `console.log(thermalCoolingLogLine({ turnId, round: roundForLog, phase: ..., detail }));` (one call in the current listener).
- **Builder has no emission side effect:** `governorPauseLog.ts:50-58` — `return \`KALSA_THERMAL_COOLING ${JSON.stringify({ ... outcome: event.detail.endReason })}\`;`.
- **The green variant’s untested call count:** `governorPauseLog.test.ts:126-129` — phase counts are asserted on `onCooling`; there is no `console.log` count assertion for that episode.

## Re-audit 4 — e1d3441d

Read-only review of `e1d3441d4032cdd243baf55a4a0f7df7452260f3` on `2602729d`. App worktree remained clean; tests and mutations ran only in `/tmp/kalsa-audit-luna-reaudit4-e1d3441d-39628`. No runtime harness or device run.

### Findings

- **CONFIRMED — exact prior duplicate-log mutation is caught.** The new guard checks one `console.` and one `thermalCoolingLogLine(` in the listener (`governorPauseWiring.test.ts:65-72`); duplicating `console.log(line)` made the test fail (**EXIT=1**).
- **CONFIRMED — close alias variants remain green.** Replacing the duplicate with `const logger = console; logger.log(line)` passed wiring + builder tests (**EXIT=0**, 16 tests). Adding that aliased emission inside `thermalCoolingLogLine` also passed (**EXIT=0**, 16 tests). Both bypass the substring pins: the listener still has only one `console.` and each builder contains no `console.` literal. Thus the one-emission guarantee is not robustly pinned.
- **CONFIRMED — commit scope and extraction are unchanged.** `git diff --stat 2602729d e1d3441d` shows only `governorPauseWiring.test.ts` changed; `git diff --quiet ... -- LlamaService.ts governorPauseLog.ts` returned **EXIT=0**. The current emitter remains `console.log(thermalCoolingLogLine({...}))` (`LlamaService.ts:4942-4949`), and the builder returns the fixed JSON line (`governorPauseLog.ts:49-58`).
- **CONFIRMED — source-only ceiling is respected.** The test documents that “LlamaService has no runtime harness” (`governorPauseWiring.test.ts:11-13`). No request for a runtime harness is warranted; the source pins are the available check, though the alias variants expose their limit.

### Checks

- Scratch `npm ci` — **EXIT=0**; `node_modules/llama.rn` exists as a directory and neither it nor `node_modules` is a symlink.
- Targeted baseline Jest (`governorPauseWiring`, `governorPauseLog`, `thermalResume`) — **EXIT=0**, 3 suites / 42 tests.
- Exact duplicate `console.log(line)` mutation — **EXIT=1**; aliased duplicate logger mutation — **EXIT=0**; aliased side effect in the builder — **EXIT=0**.
- App source files were identical between `2602729d` and `e1d3441d`; app worktree status was empty. No full suite, typecheck, or device run.

### Verdict

**NO on `67ade7a8..e1d3441d`.** The exact duplicate probe is red, but two close duplicate-emission variants are green, leaving the requested evidence cardinality unpinned against simple console aliasing.
