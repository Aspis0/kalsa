# REPORT — governor thermal pause: cooling UX + auto-resume (owner decision "A", 2026-09-24)

Repos: binding `/Users/marco/Projects/llama.rn-kalsa` (branch `kalsarn-governor-engine`, HEAD must
stay `2ba2bbc9` until my commit) and app worktree `/Users/marco/Projects/kalsa-wt-bench-apk`
(detached on `0a72612c`).

## Plan (written before coding)

1. Binding `cpp/rn-llama.{h,cpp}`: `llama_rn_context::decode` classifies a flow-control `-2`
   (only when the governor did not fail) into `governorPause()` = "thermal" | "profile" | "reload",
   reset at every decode entry; batch size + refreshed policy stats are the distinguishing facts.
2. Binding `cpp/rn-completion.{h,cpp}`: the prompt-eval failure site records `c.governor_pause`
   when classified, logs a warning instead of the eval-failure error, and keeps the `LOG_ERROR`
   statement for real failures (source guard pinned to it).
3. Binding `cpp/jsi/JSICompletion.h`: `completionResult` emits `pause_reason` only when set — a
   distinct resolved outcome; the `"Governor decode failed: "` throw path (RNLlamaJSI.cpp:1314)
   is untouched because a pause never latches the failed state.
4. Binding `src/types.ts`: `NativeCompletionResult.pause_reason?: 'thermal' | 'profile' | 'reload'`;
   new jest source-guard file `src/__tests__/governorPauseSurface.test.ts` (the binding's jest
   harness reads cpp sources — no native build).
5. App new `src/engine/thermalResume.ts`: `pauseReasonOf` + `resumeWhileCooling` — bounded
   wall-clock cooling loop, thermo refresh between attempts, abort/stop-aware cancellable wait
   (plain RN timers may suspend in background; the bound is re-checked against wall clock on wake,
   so one refresh+retry always runs after foreground return).
6. App `LlamaService.streamAssistantTurn`: wrap the chat round's completion with the loop; cooling
   status rides the existing status-label channel (`chat.coolingStatus`), the prefill deadline is
   cleared while cooling and re-armed before each retry, `KALSA_THERMAL_COOLING` logged, and a
   bounded give-up fails visibly (`errors.coolingTimedOut`) — no error during the wait itself.
7. App prewarm: `classifyPrewarmResult` gains `"paused"` (console-only skip, no failure strike,
   dedupe released) so a paused prewarm stays silent and cannot poison the next send.
8. App composer: new phase `cooling` (`shell.held.cooling` hold, face `stop`, editable) recognized
   in `composerPhase` when `statusLabel === chat.coolingStatus` while sending; `HostRoot`/`composerView`
   pass the label like `thinkingStatus`.
9. i18n `en.ts` + `it.ts`: `chat.coolingStatus`, `shell.held.cooling`, `errors.coolingTimedOut`
   (both catalogues, as every existing key).
10. Tests: thermalResume (resume / profile-not-cooled / abort / stale / bound), prewarm paused,
    composer cooling phase; sabotage each fix to RED; then `tsc`, provenance, targeted jest, one
    full jest; commits in binding (on 2ba2bbc9) and app (on 0a72612c); report the pin bump the app
    needs afterwards.

## Results

### Commits (no push, no tag, no new branch)

- **Binding** `llama.rn-kalsa`, branch `kalsarn-governor-engine`: base HEAD `2ba2bbc9` →
  **`1f841412b10698e9b29d4290c1bb1442415c98f8`** `feat(governor): resolve flow-control pauses as a
  typed completion outcome` (7 files; lefthook pre-commit lint+types and commitlint passed).
  Working tree: only the pre-existing untracked `pnpm-lock.yaml`/`pnpm-workspace.yaml` — untouched.
- **App** `kalsa` (worktree `kalsa-wt-bench-apk`), branch detached: `0a72612c` →
  **`9d8b63d25abc0b110d9557cba7cf932c332fd670`** `feat(composer): visible cooling state + auto-resume
  on governor thermal pause` (16 files). `git branch --show-current` printed (empty) before both
  commits; `git add` by name; tree clean after (0 modified).

### App pin this needs (pin commit is yours, after push)

`kalsa/package.json:50` pins `github:Aspis0/kalsa.rn#463f11f9f47ff0b235267e3bb29136ad8cbbbb13`.
It must move to the binding commit **`1f841412b10698e9b29d4290c1bb1442415c98f8`** (after you push
`kalsarn-governor-engine`), then lockfile + `scripts/assert-engine-provenance.sh` (engine pin stays
`8eac584bb341`/`native/kalsallama.pin` — this change touches no vendored engine). Until that bump
the app is deliberately inert-but-correct: `pauseReasonOf` reads `pause_reason` structurally, the
field is absent at `463f11f9`, so behavior is exactly today's.

### file:line (final)

Binding:
- `cpp/rn-llama.h:177` `governorPause()` (+ member `:136`); `cpp/rn-llama.cpp:667` reset at decode
  entry, `:682` classify `-2` → `thermal`/`profile`/`reload` only while `!governor->failed()`.
- `cpp/rn-completion.h:139` `governor_pause`; `cpp/rn-completion.cpp:1722` set at the prompt-eval
  site, `LOG_WARNING` for the pause, `LOG_ERROR("failed to eval, n_eval…")` kept for real failures.
- `cpp/jsi/JSICompletion.h:188-192` `pause_reason` emitted only when set; `RNLlamaJSI.cpp:1314`
  `"Governor decode failed: "` throw untouched (prefix guard in `nativeSourceGuards.test.ts` still
  green).
- `src/types.ts:580` `pause_reason?: 'thermal' | 'profile' | 'reload'`.
- New test `src/__tests__/governorPauseSurface.test.ts` (4 source guards).

App:
- New `src/engine/thermalResume.ts` — `pauseReasonOf` (:29), `resumeWhileCooling` (:117), resume
  gate `GOVERNOR_PAUSE_RESUME_TEMP_TENTHS_C = 400` (engine `k_warn_c`, comment names the drift
  failure mode); new test file 13 cases.
- `src/engine/LlamaService.ts:4972` `runCompletionRound`, `:5046` the cooling loop wiring (phase
  hooks: clear/re-arm prefill deadline, `chat.coolingStatus` / thinking labels, guarded by
  `finished || aborted`; `KALSA_THERMAL_COOLING` enter/exit), `:5095` bound-expiry give-up →
  `errors.coolingTimedOut` via `emitEngineError` (the only persisted error, after the bound);
  prewarm skip `:1362` (console-only, no strike).
- `src/engine/prefixPrewarm.ts` class `"paused"` (order: error → interrupted → paused → generated →
  counters); `prewarmFailureIsPersistent("paused") = false`.
- `src/host/composerPhase.ts:45` cooling recognition (before prefill — a paused prefill has no
  tokens), input `:31`; `src/ui/shell/composerState.ts:116` phase rule (hold `shell.held.cooling`,
  face `stop` → faceEnabled true, stop works); `composerView.ts:27,77`, `HostRoot.tsx:192` label
  pass-through like `thinkingStatus`.
- i18n: `en.ts:549` `chat.coolingStatus`, `en.ts:1311` `shell.held.cooling`, `en.ts:784`
  `errors.coolingTimedOut`; `it.ts:545/1266/778` equivalents (both catalogues, as every key).

### Commands and exit codes

| Command | Exit |
|---|---|
| Binding sabotage (JSI emission removed): `npx jest src/__tests__/governorPauseSurface.test.ts` | **1** (the pause_reason guard failed) |
| Binding restored: same jest | 0 |
| Binding `npx tsc --noEmit` | 0 |
| Binding full `npx jest` (one full run) | **0** (15 suites, 55 tests) |
| App sabotage A (resume retry removed): `npx jest src/engine/thermalResume.test.ts` | **1** (4 failed) |
| App sabotage B (cooling branch removed): composerPhase+composerView jest | **1** (2 failed) |
| App sabotage C (prewarm `paused` removed): prefixPrewarm jest | **1** (1 failed) |
| All sabotages restored, targeted jest (7 files) | **0** (110 tests) |
| App `npx tsc --noEmit` | **0** |
| App `bash scripts/assert-engine-provenance.sh` | **0** (1119 files `kalsa.rn@463f11f9f47f`, engine `kalsallama@8eac584bb341` == pin) |
| App full `npx jest` (one full run, at the end) | **0** (232 suites, 2477 tests; baseline 231/2458 → +1 suite/+19 tests) |

### What I could not verify

- **No native build** for the binding (per instructions): the C++ path is pinned by source guards
  only; the classification (stats + batch kind) was reasoned from `llama-governor-runtime.cpp` but
  never executed on a device.
- **No device run**: no cooling UI, no resume, no foreground/background timer behavior was observed
  on the S23/Jelly; `refreshGovernorBeforeCompletion` returning hot-then-cool readings is exercised
  only through injected fakes.
- **Give-up after the 10-minute bound** has no unit test (it lives in `LlamaService`, which has no
  harness); it is covered by construction (loop returns the paused result → `:5095` check).
- **Speculative/MTP decode sites** in the binding (`rn-completion.cpp:1033,1132`) are not wired for
  pauses (the app runs the classic path; no draft model in use) — declared, not changed.
- The resume gate constant (400 tenths) mirrors engine `k_warn_c`; if the engine moves its warn
  line the constant must follow (comment at `thermalResume.ts` states this).
- Audits of `0a72612c` / engine `497ca1cca` / binding `2ba2bbc9` were still running; rebase risk
  accepted per instructions. No push, no DeepSeek audit run by me.


---

# Binding fix round (luna's audit of 1f841412)

One commit on top of `1e86815f`: **`b23fc0832bb6277854a0363b99b85a9532a1e52e`** (repo
llama.rn-kalsa, branch kalsarn-governor-engine; `git branch --show-current` printed before the
commit; `git add` by name; lefthook lint+types+commitlint green; no push; app worktree untouched;
untracked pnpm files untouched).

**1. Thermal mislabel (CONFIRMED).** Verified luna's 513-token / 128-row / 39 °C / n_batch-2048
scenario against the now-vendored engine 6581c7a7b: the policy's new `prompt_tokens -
result.tokens == 1` rule admits the 129 tail whole, so the partition is {128,128,128,129},
remaining never reaches 1, and the `count <= 1` guard is unreachable — engine-side (the guard is
logged, not asserted, there). The binding now labels `thermal` **only on the governor's own
signal**: `last_router_rule == 0`, which is exactly what the policy's Wait returns stamp
(`llama_governor_prefill_admission{}` rule = 0, policy.h:15; every admit/chunk return stamps
{2,3,9}); Unknown state stays `profile`; anything after an admitted engine is the new
**`unexplained`** — never thermal, so no host cool-and-resumes a retry that would repeat the same
partition. `cpp/rn-llama.cpp:683-708` (comment rewritten and true); `src/types.ts:582` union
+= `unexplained`. An in-loop re-admission decline (temp crossing the warn line between the two
admission reads, rule already stamped) also lands in `unexplained` — a declared safe-direction
mislabel (no auto-resume) documented in the comment.

**2. pause_reason leak (CONFIRMED).** `governor_pause = ""` added to `rewind()`
(`cpp/rn-completion.cpp:104`) — rewind is where every completion starts (RNLlamaJSI.cpp:1175,
rn-tts.cpp:1959, rn-completion.cpp:2125/2179), so no later completion inherits a pause.

**3. Guard pinned behaviour, not substrings (CONFIRMED).** `src/__tests__/governorPauseSurface.test.ts`
rewritten: marker-sliced blocks compared token-for-token with comments stripped — the classifier
gate + full branch chain (a `false && …` gate loses its start marker → red), the pause-vs-LOG_ERROR
site, the rewind reset sequence, the emission guard — plus a union equality check
`src/types.ts` ↔ `lib/typescript/types.d.ts` (a stale d.ts fails). **Stays unpinned without a
native build** (file header states it): the engine really stamping rule 0 on Wait / {2,3,9} on
admit, the -2's runtime flow decode→completion→JSON→JS, row+1 reachability at runtime, sensor
freshness — `tests/` covers none of it without compiling.

**4. Regenerated declarations.** `lib/typescript/types.d.ts` (+`.d.ts.map`) regenerated and
committed — `pause_reason?: 'thermal' | 'profile' | 'reload' | 'unexplained'` at types.d.ts:530.
Mechanism worth knowing: `npx bob build --target typescript` **drops** the per-target
`{ project: tsconfig.build.json }` option (bob's build command passes only `target` through), so
it emits with the base `tsconfig.json` (rootDir repo root, example/scripts included, `types` field
validation fails) — only the full `npx bob build` applies the project option; direct
`tsc --project tsconfig.build.json` into an existing `lib/typescript` hits TS5055 (committed d.ts
are inputs). Kept only what the change requires: `index.d.ts`/`NativeRNLlama.d.ts.map` showed
pure printer drift and were restored; three untracked test `.d.ts` pairs (governorLaneRepack,
governorPauseSurface, nativeSourceGuards — never committed, pre-existing drift) were removed, not
committed; `lib/commonjs` and `lib/module` came out byte-identical (no diff).

**Sabotages (all EXIT=1, all restored to EXIT=0):** classifier `false && …` (marker not found —
the exact false luna demonstrated); `governor_pause = ""` removed from rewind; stale
`lib/typescript/types.d.ts` (union mismatch); JSI `res["pause_reason"]` removed.

**Commands:** targeted jest (governorPauseSurface + nativeSourceGuards) **EXIT=0** (11 tests);
each sabotage run **EXIT=1**; `npx tsc --noEmit` **EXIT=0**; one full `npx jest` at the end
**EXIT=0** (15 suites, 57 tests; baseline 15/55 — the guard file 4→6 tests). One intermediate
commit attempt failed on lefthook lint (regex char-class order, fixed) and one on commitlint
(header >100 chars, moved repo/branch/HEAD detail into the body).

**Not verified:** no native build or device run — C++ behaviour is pinned only by source-level
control-flow comparison; the 6581c7a7b row+1 reachability claim was traced by hand, not executed;
`unexplained` reaching the app host is future work behind the app pin (app untouched, under audit).

---

# Fix round 2 (deepseek audit of 67ade7a8..1caf7ed0: NO)

One commit on top of `1caf7ed0`: **`9bb7a1cb187ac59fa11780b5b4b1f75ec10797db`** (kalsa app,
worktree `kalsa-wt-bench-apk`, branch detached — printed before the commit; `git add` by name; no
push; tree clean after). Owner scope: F1, F6, F3/F4 only.

**F1 — false `coolingTimedOut` on switch/dispose.** `src/engine/LlamaService.ts:5100-5102`:
`if (aborted) return;` → `if (bailIfStopped()) return;` before the bound-expiry branch — a user/conversation
stop ends silently (finishOnce onDone), an invalidation (model switch / dispose — neither aborts
this controller) ends the way an invalidated turn always has (`turnInterrupted` via bailIfStopped,
LlamaService.ts:4680-4708), and only a live turn reaches `errors.coolingTimedOut`. The comment at
`:5103-5108` now states exactly that (the old "bound expired" claim was unreachable-false for
invalidated turns).

**F6 — enter+exit telemetry.** `src/engine/thermalResume.ts` gained `CoolingDetail`
(`elapsedMs`, `battTempTenthsC` from the freshest refresh, `endReason: "resumed" | "stopped" |
"timeout"` derived by the loop — bound-expiry flag vs `stopped()` vs natural exit) passed to every
`onCooling`; the listener (`LlamaService.ts:5052-5069`) logs `KALSA_THERMAL_COOLING` on `start` and
`end` **before** the `finished || aborted` guard — `{turnId, round, phase: enter|exit, waitedMs,
batt_temp_tenths_c, outcome}` — numbers only, no user/model text; the guard now covers only the
status-label/deadline actions. The old end-only line and `coolingWaitedFrom` are gone.

**F3/F4 — tests that go red.** New in `src/engine/thermalResume.test.ts` (+4 tests, 13→17):
the last gate (a stop landing *inside* `refreshThermo` never reaches the retry);
`GOVERNOR_COOLING_MAX_MS === 600_000` and `GOVERNOR_COOLING_POLL_MS === 10_000` plus the wait
actually receiving the default interval; boundary behaviour — **399 tenths resumes, exactly 400
waits** (400-first refresh → no attempt; phases `[start, wait, wait, resume, end]`). Existing episode
tests now assert `endReason` (`resumed` / `stopped` / `timeout`), pinning the F6 outcome derivation.

**Sabotages (each EXIT=1, each restored to EXIT=0):** drop the post-`refreshThermo` `isStopped()`
gate → 1 failed; cap `10*60_000` → `1*60_000` → 1 failed; poll `10_000` → `5_000` → 1 failed;
`< 400` → `<= 400` → 1 failed.

**Commands:** targeted (audit's 9-suite set) **EXIT=0** (124 tests; baseline 120); `npx tsc --noEmit`
**EXIT=0**; one full `npx jest` at the end **EXIT=0** (235 suites, 2489 tests; baseline 235/2485).

**Not fixed, per owner scope (declared):** F2 (tool-fallback `LlamaService.ts:5451` and the utility
completion sites bypass the cooling loop), F7 (OS CRITICAL paints `tooHot` and hides Stop),
F8 (`statusHistory` grows per poll, consumerless), F9 (cooling phase keyed on a translated string),
F10 (`sleepWithAbort`/`waitOrAbort` duplicated), F11 (no file-size ratchet over `src/engine`).

**Not verified:** no device run — the F1 path and both new log lines have no jest harness (F5,
pre-existing: `LlamaService` is untestable here), so the F1 fix is code-reviewed only; module-level
gates and numbers are pinned by the sabotages quoted above.

---

# Fix round 3 (luna app audit NO + binding re-audit F5)

One commit on top of `9bb7a1cb`: **`b2c3930540a5ec4ed1ed26f35b996c811cc8008b`** (kalsa app,
worktree `kalsa-wt-bench-apk`, branch detached — printed before the commit; `git add` by name; no
push; tree clean). Owner scope: items 1-5 only; `package.json` pin untouched; no copy polish.

**1. Non-thermal pauses end visibly (binding re-audit F5).** `GovernorPauseReason` +
`pauseReasonOf` now know `unexplained` (`src/engine/thermalResume.ts:21-42`). New pure mapping
`governorPauseEnding` (`thermalResume.ts:46`) decides the ending, and the one helper
`endOnGovernorPause` (`src/engine/LlamaService.ts:3122`) applies it at every completion site: logs
`KALSA_GOVERNOR_PAUSE {turnId, round, reason}` (numbers/literals only) and fails through the
existing `emitEngineError` path with existing copy — `errors.coolingTimedOut` for thermal (the
bound expiry it always named), `chat.serviceUnreachable` for profile/reload/unexplained. The silent
empty-reply paths (`LlamaService.ts` emitFinalText / onDone finals) are now unreachable for any
paused result.

**2. Tool fallback (luna F2)** — ends pauses through the same helper
(`LlamaService.ts:5550`, `round: MAX_TOOL_ROUNDS`) with `bailIfStopped()` ahead of it (same
invalidation honesty as the round). Chose the **smaller** option: no cooling loop there — a
thermal pause ends on the cooling give-up line instead of the false `toolRoundsExhausted`
**declared residual: no auto-resume at this site**.

**3. Failed retry (luna F3)** — the loop records `retryFailed` and ends the episode
`endReason: "failed"` while rethrowing unchanged (`thermalResume.ts` retry try/catch);
`stopped()` is checked first, so a stop-caused rejection reads `stopped`.

**4. Wait-only waitedMs (luna F4)** — `CoolingDetail.elapsedMs` = wall time − every retry's
generation; `generationMs` is its own field, added to the `KALSA_THERMAL_COOLING` exit JSON. The
single-retry case is exactly "enter → retry start". **Declared:** in multi-cycle episodes the wall
time between earlier retries still includes their generation.

**5. Applied budget (luna F8)** — new test drives a clock that advances only inside `wait`
(3 × 300_000 → exactly the default 600_000 → 3 attempts + timeout); a doubled default yields 5
attempts → red.

**New guard:** `src/engine/governorPauseWiring.test.ts` (source-level, house style) pins that both
completion sites call the one helper (def + 2 calls) and that it alone owns `KALSA_GOVERNOR_PAUSE`
and both copy keys (`strings.errors.coolingTimedOut` appears exactly once in the file). What stays
unpinned: the `emitEngineError → onError` runtime path (F5's no-harness gap, declared).

**Sabotages (each EXIT=1, each restored to EXIT=0):** drop `unexplained` from `pauseReasonOf`
(2 failed); drop the round's helper call (1); drop the fallback's helper call (1); label a throwing
retry `resumed` (1); count generation in `waitedMs` (1); default `maxCoolingMs = MAX * 2` (1).
One restore initially missed (comment lines between the anchor) and was re-applied before the next
sabotage; final tree verified green.

**Commands:** targeted (10 suites incl. neighbors) **EXIT=0** (135 tests); `npx tsc --noEmit`
**EXIT=0**; one full `npx jest` at the end **EXIT=0** (236 suites, 2500 tests; baseline 235/2489 →
+1 suite/+11 tests).

**Not fixed, declared:** luna F1 (app pin — owner bumps at release), luna F5 (OS CRITICAL hides
Stop during cooling), luna F6 (switch request dropped after the 5 s defer window), luna F7 (stop
during the send's own lazy load); thermal-at-tool-fallback gets no cooling wait (item 2's chosen
option). **Not verified:** no device run — the helper's runtime ending and both new log lines have
no jest harness (F5 gap); all module-level logic is pinned by the six sabotages above.

---

# Fix round 4 (luna re-audit NO + deepseek low RG2)

One commit on top of `b2c39305`: **`bad66ec2a7f72a8e3c77911c359bf361d1d27da6`** (kalsa app,
worktree `kalsa-wt-bench-apk`, branch detached — printed before the commit; `git add` by name; no
push; tree clean). Three fixes, no new copy.

**1. Tool fallback cools (luna re-audit F2).** The cooling configuration became one shared factory
`coolingRound(roundForLog, attempt)` (`src/engine/LlamaService.ts`, defined before the round loop,
same stop predicate / thermo refresh / `KALSA_THERMAL_COOLING` listener); both the round
(`resumeWhileCooling(coolingRound(round, runCompletionRound))`) and the fallback
(`resumeWhileCooling(coolingRound(MAX_TOOL_ROUNDS, runFallbackRound))`) use it — the fallback's
`engine.completion` call became the `runFallbackRound` arrow with its body untouched. A thermal
pause at the fallback now waits/resumes; `endOnGovernorPause` there only sees unresumable pauses
(bound → `coolingTimedOut`). Comments claiming "the fallback has no loop" corrected in
`LlamaService.ts` (helper doc + call site) and `thermalResume.ts` (`governorPauseEnding` doc).

**2. Utility completions refuse pauses.** New shared `utilityGovernorPause(result, site)`
(`LlamaService.ts`, next to the turn helper) logs `KALSA_GOVERNOR_PAUSE {site, reason}` (literals)
and returns whether the result is paused; no cooling wait. Memory extraction
(`:6147`-region) → `stopReason = "governor_paused"` (new internal literal in
`MemoryExtractStopReason` and its pre-existing mirrored union in
`src/memory/memoryTelemetry.ts:55` — extended, not refactored), never parsed; translation returns
its existing `{ text: "", truncated }` no-result; `completeOnce` returns the catch-shape no-result
(`{ text: "", aborted: false, engineSwapped: engine !== context }`) before parsing — each placed
after the KV-truth/abort checks so partial content is never consumed as output.

**3. RG2 — ignored return goes red.** `governorPauseWiring.test.ts` rewritten: pins **guarded**
calls (`if (endOnGovernorPause(...)) { return; }`) === 2 (a bare/`void` call no longer counts —
that was deepseek's hole), `resumeWhileCooling(` === 2 (round + fallback), each utility site
consumed *as a condition* with its site literal (`guardedSites` sorted equals
`[completeOnce, extractMemory, translate]`), one `KALSA_GOVERNOR_PAUSE` emitter per helper (2 in
comment-stripped source), and the give-up copy owned solely by the turn helper.

**Sabotages (each EXIT=1, each restored to EXIT=0):** unwrap the fallback (1 failed); drop the
translate check (1); mute the utility logger (1); ignore the fallback helper's return — modelled as
`void endOnGovernorPause(...)` (1).

**Commands:** targeted (11 suites incl. neighbors) **EXIT=0** (138 tests); `npx tsc --noEmit`
**EXIT=0** (one intermediate failure: the duplicated stop-reason union in `memoryTelemetry.ts`
caught the new literal — fixed); one full `npx jest` at the end **EXIT=0** (236 suites, 2502 tests;
baseline 236/2500 → +2 wiring pins).

**Not verified:** no device run — the fallback's runtime cooling and the three utility returns have
no jest harness (LlamaService F5 gap, stated in the wiring-test header); source-shape pins only.

---

# Fix round 5 (Luna Re-audit 2 — two sabotage-green mutations)

One commit on top of `bad66ec2`: **`2602729d398c6098b6a8e29827f860d2c0e75629`** (kalsa app,
worktree `kalsa-wt-bench-apk`, branch detached — printed before the commit; `git add` by name; no
push; tree clean). Tests round; the only production change is the extraction the task sanctioned.

**1. Utility pause detection now unit-testable.** The emitters were pure enough once moved out of
LlamaService: new `src/engine/governorPauseLog.ts` (59 lines — one responsibility: the
governor-pause evidence lines) holds `governorPauseLogLine`, `thermalCoolingLogLine`, and
`utilityGovernorPause` (decision + its single line). LlamaService imports them; its local helper
moved out, the turn helper emits via the builder, the cooling listener builds via the builder —
**zero raw evidence literals remain in its comment-stripped source**. Test
`src/engine/governorPauseLog.test.ts` (134 lines): all four pause reasons → `true` + exactly one
`KALSA_GOVERNOR_PAUSE` line parsing to `{site, reason}`; unpaused/unknown → `false` + no log; exact
enter/exit/turn payload shapes (enter never carries `outcome`, single-line each). Sabotage
(utility detection disabled — `return false`) → **EXIT=1** (4 failed), restored **EXIT=0**.

**2. Evidence cardinality pinned end to end.** (a) Runtime: a new test drives the real
`resumeWhileCooling` with a fake clock (advance only in `wait`) and a spy listener through a
multi-cycle timeout episode — exactly one `start` and one `end`, last call is `end` with
`endReason: "timeout"` (per-episode enter/exit pair). (b) Listener line shape: since the
`coolingRound` listener is unreachable from jest, its line-BUILDING moved into
`thermalCoolingLogLine` and is tested directly (payload + no-newline single emission).
(c) Source: the wiring test now pins that LlamaService contains **no** raw `KALSA_` literals and
calls each builder exactly once — a duplicate line added in the listener goes red there too.
Sabotage (second `thermalCoolingLogLine(...)` in the listener) → **EXIT=1** (1 failed), restored
**EXIT=0**.

**Wiring test updates (same file, same topic):** helper-region slice now ends at
`sessionErrorReason`; the turn-helper pin asserts `governorPauseLogLine(` + both copy keys; the
utility count is three call sites (definition moved out).

**Commands:** targeted (11 suites incl. neighbors) **EXIT=0** (147 tests); `npx tsc --noEmit`
**EXIT=0**; one full `npx jest` at the end **EXIT=0** (237 suites, 2512 tests; baseline 236/2502 →
+1 suite/+10 tests). Line counts: new module 59, new test 134 — both far under 350;
`thermalResume.test.ts` (350) deliberately untouched.

**Declared:** the `emitEngineError → onError` runtime path stays unpinned (LlamaService F5 gap);
the 5-second switch-queue drop untouched (owner scope, per Re-audit 2's PLAUSIBLE); no device run —
both new guarantees are jest-level (behaviour of the pure decision/line builders + episode
cardinality), not device logcat observations.

---

# Fix round 6 (Luna Re-audit 3 — double-log at the listener stayed green)

One commit on top of `2602729d`: **`e1d3441d4032cdd243baf55a4a0f7df7452260f3`** (kalsa app,
worktree `kalsa-wt-bench-apk`, branch detached — printed before the commit; `git add` by name; no
push; tree clean; amended once to clean a stray phrase in the message). Tests-only: production
untouched (`git diff` = `src/engine/governorPauseWiring.test.ts`, +52/−12).

**Fix.** The wiring test gained a `region()` slicer (comment-stripped source between stable
markers) and now pins each emission SITE's shape:
- the `coolingRound` `onCooling` listener (marker `onCooling: (phase, detail) => {` → the round
  loop that follows the factory): **exactly one `console.` call and exactly one
  `thermalCoolingLogLine(` call** — luna's `const line = …; console.log(line); console.log(line);`
  doubles the console count → red;
- `endOnGovernorPause`'s body (marker `function endOnGovernorPause` → `function sessionErrorReason`):
  **exactly one `console.` and one `governorPauseLogLine(`**, alongside the existing copy-key pins;
- the two builders only build: `governorPauseLogLine`'s body (→ `utilityGovernorPause`) and
  `thermalCoolingLogLine`'s body (→ EOF) contain no `console.` — closing re-audit 3's second cited
  variant.

**Sabotages (each EXIT=1, each restored to EXIT=0):** luna's exact double-`console.log` mutation at
the listener → 1 failed (the new listener pin); a `console.log` side effect inside
`thermalCoolingLogLine` → 1 failed (the builders-only-build pin).

**Commands:** targeted (wiring + log + thermalResume + prewarm + engineTurnEnsure) **EXIT=0**
(76 tests); `npx tsc --noEmit` **EXIT=0**; one full `npx jest` at the end **EXIT=0** (237 suites,
2514 tests; baseline 237/2512 → +2 emission pins).

**Not verified:** no device run — the one-line-per-event guarantee is pinned at source level
(region counts), not observed in logcat; `emitEngineError → onError` remains the declared F5 gap.
