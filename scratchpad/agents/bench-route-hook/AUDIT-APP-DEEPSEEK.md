# AUDIT-APP — `/bench route cpu|gpu|auto` (app half, commit `b9c63bf6`)

Hostile, read-only. Worktree `/Users/marco/Projects/kalsa-wt-bench-apk`, detached
`b9c63bf672711b6e0749adc7a500ec8cab88f5e2` on `e1d3441d`; `git status --short` empty before and
after; no repo change, no sub-agents, no device run. Scratch `/tmp/kalsa-fix6` = `git archive
b9c63bf6` + the real `npm ci` `node_modules` (directory, `test -L` false; the commit touches no
manifest). Spec: `governor-archive-mining/SYNTHESIS.md` §4. Writer's report: `REPORT-APP.md`.

Evidence: 7-suite targeted set **EXIT=0** (93 tests, matching the report); 5-suite neighbors
**EXIT=0** (55); `tsc --noEmit` **0**; provenance **0**; 10 sabotages (see matrix).

The hook is inert on the current pin (`463f11f9` has no `setPrefillOverride`), so nothing here is
observable in production yet — but the evidence contract is what the campaign will eat, so the
findings below are about the future binding path.

## Sabotage matrix (scratch, serial)

| # | Mutation | Target | EXIT |
|---|---|---|---|
| S1 | turn ignores the passed id (`options.turnId ?? mintTurnId()` → `mintTurnId()`) | benchRoute | **1** |
| S2 | `KALSA_WINDOW` drops `turnId` | benchRoute | **1** |
| S3 | mute the unsupported `KALSA_BENCH_ROUTE` line | benchRoute | **1** |
| S4 | `route_chunks` always `null` | benchRoute | **1** |
| S5 | detached `setPrefillOverride` call (`this` lost) | benchRoute | **1** |
| S6 | `setBenchRoute("auto")` writes instead of clearing | benchConfig | **1** |
| S7 | `route_mode` hardcoded in the governor line | benchRoute | **0** ← F1 |
| S8 | governor line loses the route spread | benchRoute | **1** |
| S10 | free-text field added to `KALSA_BENCH_ROUTE` | benchRoute | **1** |

## F1 — CONFIRMED (medium): `route_mode` is the stored value at *emit* time, not the pushed mode

> `LlamaService.ts:1869-1873`
> ```
> ...governorRouteLogFields({
>   turnId,
>   routeMode: await readBenchRoute(),
>   completionResult,
> }),
> ```
> push, earlier: `:1818-1823` `await withNativeCallTimeout(pushPrefillOverride(engine, await readBenchRoute()), ENGINE_AUX_CALL_TIMEOUT_MS, "setPrefillOverride");`

Two reads of the same key, one before the turn and one after the completion. Consequences:

* A driver that treats the round's `KALSA_TELEMETRY` as turn-end and switches the arm can land the
  new value before the `KALSA_GOVERNOR` line is built — the per-round order is
  `emitTurnTelemetry` (`:5213`) → `emitFinalText`/`onDone` (`:5280`) → `await emitGovernorTelemetry`
  (`:5281`). The finished turn is then
  labelled with the wrong arm. With `/bench route auto` (key removed) the same race yields
  `route_mode: "auto"` for a turn that requested `gpu`.
* When the governor was attempted but not active — `activeGovernorAttempted` true,
  `activeGovernorActive` false (`:2783-2785`) — the push is skipped by the `:1787` guard, yet the line
  still carries a `route_mode`. The field is "the stored request at emit", never "what this turn
  applied".
* Sabotage **S7** (hardcode `route_mode: "auto"` in the emit site) stays green: the field's source is
  pinned only by presence, not by value.

Fix: capture the mode that the turn actually pushed (a per-turn local/ref set where
`pushPrefillOverride` runs) and emit that, plus a per-turn `route_push` status (F2).

## F2 — CONFIRMED (medium): a failed or timed-out push is indistinguishable from success

> `LlamaService.ts:1824-1828` — `} catch { // Never a turn dependency: a busy or released context keeps the engine's own route for this turn (the unsupported case already logged its one KALSA_BENCH_ROUTE line inside the helper). }`

The `withNativeCallTimeout` result is discarded; only the *unsupported* branch logs
(`benchRoute.ts:31-38`, once per process). A supporting binding whose `setPrefillOverride` rejects, or
hangs past `ENGINE_AUX_CALL_TIMEOUT_MS` (`:1735` = **15 s**), leaves no record at all — while the
governor line still echoes a mode. The campaign's rejection rule ("actual differs from requested",
SYNTHESIS §4) can only fire if the binding's per-chunk `requested` carries the *accepted* value; if
the push never landed, the chunk `requested` is the engine's previous override, so the app echo and
the chunks disagree in a way no single line reveals. Severity bounded by the driver cross-checking
`route_mode` against `route_chunks[].requested`, which is exactly what the app should have logged.

Latency note: the 15 s budget is awaited before every completion (round, each cooling retry, each
utility call, prewarm). A hung setter delays the send path by up to 15 s per refresh. A dedicated
shorter bind (1–2 s) would cost nothing: the value is sticky, not per-turn critical.

Fix: log `KALSA_BENCH_ROUTE {applied:true|false, reason:"unsupported"|"timeout"|"error", mode}` once
per turn (or a `route_push` field on the governor line); keep the once-per-process line only for the
pin fact.

## F3 — CONFIRMED (low): the runtime-governor-fallback retry reuses the turnId, its marker is unkeyed

> `LlamaService.ts:5846` — `await streamAssistantTurn(messages, callbacks, signal, options);`

The retry passes the same `options`, hence the same `options.turnId` minted for the window. The
first attempt's `KALSA_WINDOW.nPast` then joins to the *retry's* telemetry/governor lines, and the
retry runs after a CPU reload, so `tokensEvaluated − nPast` is wrong for that id. The fallback's own
marker carries no id:

> `LlamaService.ts:2895` — `console.log(`KALSA_GOVERNOR_RUNTIME_FALLBACK ${JSON.stringify({ reason })}`);`

The spec says reject fallback turns, so this is bounded — but a duplicate-id record that *looks*
complete is what makes the rejection hard. Fix: add `turnId` to the runtime-fallback line (or a
`runtime_fallback: true` field on `KALSA_GOVERNOR`), or mint a fresh id for the retry.

## F4 — CONFIRMED (low): `route_chunks` is forwarded from the binding unvalidated

> `benchRoute.ts:65` — `route_chunks: Array.isArray(chunks) ? chunks : null,`

Chunk objects are logged verbatim. The spec's fields are numbers/literals
(`{index,requested,actual,tokens,prefill_ms,forced}`), but nothing in the app enforces that; the
`KALSA_TELEMETRY` precedent clamps `tool` names for exactly this reason (`turnTelemetry.ts:220-228`).
Project the six known fields (and drop the rest) before logging.

## Refuted / verified good

* **turnId join on the normal path — REFUTED as a problem.** One mint per send
  (`engineTurnStream.ts:115`), the unconditional window log carries it (`:126-147`, `turnId` at
  `:128`), the options literal carries it (`:287`), the turn reuses it (`LlamaService.ts:4260`
  `options.turnId ?? mintTurnId()`) and every per-round line (`KALSA_TELEMETRY` key at
  `turnTelemetry.ts:222-224`, truncation, greedy `KALSA_BENCH_TOKENS`, tool-round line,
  `KALSA_GOVERNOR`) uses the same local. Edit/regenerate/tool rounds/cooling retries all stay inside
  one `streamAssistantTurn` call → one id. The only id-reuse case is F3. S1/S2 red.
* **Stale persisted route surviving `auto` — REFUTED.** `setBenchRoute` removes the key
  (`benchConfig.ts:121-129`), `readBenchRoute` maps absent/invalid/`auto` to engine-decides
  (`:110-119`), the `/bench show` echo is live (`formatBenchStatus`), S6 red.
* **Override leaking into the wrong turn or into prewarm — REFUTED as an app-side bug.** The push
  lives in `refreshGovernorBeforeCompletion` (`:1814-1828`), so it also runs for the prewarm
  (`:1223`) and the utilities (`:6179/6416/6539`), but it pushes the *same* global knob each time and
  the prewarm emits no `KALSA_GOVERNOR`; the measured line is the chat completion's. Whether the
  engine-side override is turn-keyed is the binding half's contract (route_chunks carry
  `requested` per chunk).
* **Push while the governor is inactive — REFUTED as an action.** Never pushed: the gate is
  `activeGovernorActive && engine === context` (`:1787`). The *line* is F1's caveat.
* **Facade re-export — REFUTED as a cycle.** `engineBackend.ts:73` adds a value re-export of
  `mintTurnId`; `engineBackend` already re-exported `queueStaticPrefixPrewarm` from `LlamaService`,
  and `LlamaService` imports neither `engineBackend` nor the host layer, so no new edge and no new
  init side effect.
* **Text in logs — REFUTED except F4.** `KALSA_BENCH_ROUTE` is literal-only and pinned (S10 red);
  the window/governor additions are the turn counter and closed-set modes.
* **`withNativeCallTimeout` swallowing a real failure — CONFIRMED but pre-existing shape**; for this
  feature it is F2 (the swallowed one is a *request*, and the consequence is evidence, not the turn).
* **Tests** — S1–S6, S8, S10 all red with the named assertions; the report's own matrix reproduces.

## Verdict: **NO** (fix F1–F3 before a campaign runs; the code is inert on the current pin, so this
is a pre-binding contract fix, not a production bug).

The join machinery on the normal send path is correct, and parse/persist/`auto`/feature detection are
right. But the app's only per-turn route record is a value re-read *after* the turn (`route_mode`),
it never says whether the request was applied (`route_push`), and the one rejected-turn class
(runtime fallback) reuses the turn's id with an unkeyed marker. Those three are exactly the fields
the measurement needs to attribute heat to an arm; they are a few lines each and should land before
the binding half freezes the interface. F4 is a one-liner (project the six chunk fields).

---

# Re-audit (fix commit `1350724c`, F1–F4)

Worktree clean at `1350724cc5e5c4919462f139ec6996798518ea71`, read-only, no delegation. Scratch
`/tmp/kalsa-fix7` = `git archive 1350724c` + the real `npm ci` `node_modules`. Evidence: 9-suite
targeted set **EXIT=0** (113 tests, matching the report), 5-suite neighbors **EXIT=0** (59),
`tsc --noEmit` **0**, provenance not needed (no manifest change), 11 mutations (9 red, 2 green).

## F1 — CONFIRMED fixed

The record is captured at the push and consumed at the emit:

> `LlamaService.ts:1830-1834` — `const routeMode = await readBenchRoute(); turnRoutePush = { mode: routeMode, outcome: await pushPrefillOverride(engine, routeMode) };`
> `benchRoute.ts:148-150` — `route_mode: input.routePush?.outcome === "applied" ? input.routePush.mode : null,` / `route_push: input.routePush?.outcome ?? "skipped",`

The emit region (`:1874-1884`) no longer calls `readBenchRoute` (source-pinned, and I re-read it);
attempted-but-inactive / no-push turns now log `route_mode: null` + `route_push: "skipped"` instead of
a stored-value echo. Sabotages **A1** (ungate `route_mode`) → **1**, **A2** (rejecting setter reported
`applied`) → **1**. My round-1 S7 lives as their ungated-`route_mode` sabotage and is red.

## F2 — CONFIRMED fixed, two nits

`RoutePushOutcome` is closed (`benchRoute.ts:15-20`); the push owns its own bound and never throws:

> `benchRoute.ts:67-80` — `await Promise.race([ target.setPrefillOverride(mode), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(ROUTE_PUSH_TIMEOUT), BENCH_ROUTE_PUSH_TIMEOUT_MS); }), ]);` … `} catch (error) { return error === ROUTE_PUSH_TIMEOUT ? "timeout" : "failed"; } finally { if (timer !== undefined) clearTimeout(timer); }`

The old 15 s `withNativeCallTimeout` wrapper and its swallowing catch are gone from the call site.
**Timer leak after resolve — REFUTED** for the committed code (the `finally` clears it); sabotage
**A7** (drop the `finally`) stays green but jest prints "Jest did not exit one second after the test
run has completed" — the guard is real, only unpinned. **Nits:** (a) the bound's *value* is not
pinned — **A11** (`2_000` → `15_000`) stays green, though the 2 s budget is a product decision;
(b) on `failed`/`timeout` the attempted mode is dropped (`route_mode: null`, no `route_requested`), so
an analyst sees *why* the push failed but not *what* it asked for — the applied-gate fix
over-corrects by one field. A setter still pending past the bound can land late on a later prefill;
that is now honestly recorded as `timeout` but remains an interface requirement for the binding half.

## F3 — CONFIRMED fixed

> `LlamaService.ts:5842-5846` — `const retryTurnId = options.turnId ?? mintTurnId(); const retryAttempt = (options.turnAttempt ?? 1) + 1; const retryOptions: StreamTurnOptions = { ...options, turnId: retryTurnId, turnAttempt: retryAttempt };`
> `:2909` — `KALSA_GOVERNOR_RUNTIME_FALLBACK ${JSON.stringify({ reason, turnId, attempt })}`
> `:1877` — `attempt: turnAttempt,`; `turnTelemetry.ts:230` — `attempt,` (default 1, additive)

Sabotages **A5** (marker loses `turnId`/`attempt`) → **1**, **A9** (`+ 1` → `+ 2`) → **1**; the
declared gaps (truncation/tool lines, the window line) are acceptable for a rejected-turn class.
**Nit:** the `?? mintTurnId()` fallback contradicts its own comment ("never a fresh mint") — if a
caller ever lacked `options.turnId`, the two attempts would not share a key. Every current caller sets
it (`engineTurnStream.ts:115`), so the branch is defensive-only.

## F4 — CONFIRMED fixed

> `benchRoute.ts:97-119` `asRouteChunk` projects the six spec fields with closed-set
> `requested ∈ cpu|gpu|auto` / `actual ∈ cpu|gpu`, drops malformed entries; `:144-155` counts them in
> `route_chunks_dropped` (null when absent/non-array). Sabotage **A4** (raw chunks forwarded) → **1**.
> **Nit:** `index`/`tokens`/`prefill_ms` accept `NaN`/`Infinity` (`typeof === "number"`);
> `JSON.stringify` then writes `null` into a numeric field — `Number.isFinite` would keep it strict.

## `turnRoutePush` global vs concurrent writers — REFUTED as a live hazard, PLAUSIBLE as fragility

All writers and the reader live inside the engine FIFO: `withEngineJob` (`:883`) serializes job bodies
(the header even states it: `:1095-1096` "streamAssistantTurn is also withEngineJob. FIFO is the
join"), the prewarm (`:1177`) and each utility (`:6101`, `:6411`, …) push inside their own job, and
`streamAssistantTurn` is itself wrapped (`:4248`), so no foreign job body can interleave between this
turn's push and its `emitGovernorTelemetry` read. The reset `:4285 turnRoutePush = null;` runs at the
turn top before any push; **A6** (removal) is red via the source pin. The runtime-fallback retry runs
in a fresh job after the dispose/init, but re-enters `streamAssistantTurn` and resets first (verified
by reading `:5888`). Residual: the record is module-global and only the FIFO plus that reset keep it
correct, and the pin checks the reset's *presence*, not its placement — a version threaded from the
push to the emit (or keyed by turnId) would remove the coupling.

## Regression: one stray edit

> `LlamaService.ts:1503` — `    try {` inside the block whose body sits at 12 spaces and whose
> `} catch {` is at 10 (`:1519`), a de-indent introduced by the fix commit ("left no residue" in the
> report). Semantically inert; the app has no lint script (`package.json` has no `lint`), so nothing
> catches it. Cosmetic only.

## Re-audit verdict: **SHIP**

All four findings are addressed and pinned (A1–A6, A9, A11 in line with the writer's matrix). The two
greens are a value (2 s bound) and the timer-clear guard, neither of which changes behaviour; the
remaining notes (requested-mode loss on failure, the defensive `?? mintTurnId()`, NaN pass-through,
the de-indent) are cosmetic or declared. No evidence-corrupting path found in the committed code on
the normal send path; the late-landing setter stays a binding-interface requirement.

---

# Truncation (commit `3bcfd08d`)

Read-only; worktree clean at `3bcfd08d2dae280192111a2229e63b1881b581a1`. Scratch `/tmp/kalsa-fix8` =
`git archive 3bcfd08d` + the real `npm ci` `node_modules`. `npx jest src/engine/benchRoute.test.ts`
**EXIT=0** (17 tests), `tsc --noEmit` **0**, 5 sabotages all **EXIT=1**.

**Name and type match — CONFIRMED.** Binding: `src/types.ts:599 route_chunks_truncated?: boolean`
("True when the completion executed more prefill chunks than route_chunks can hold") and
`cpp/jsi/JSICompletion.h:238 res["route_chunks_truncated"] = governor_stats.route_chunks_truncated;`
— emitted inside the same `if (ctx->hasGovernor())` block that builds `route_chunks`, so the two
travel together. App: `benchRoute.ts:161-163` reads the identical key structurally
(`const truncated = typeof truncatedRaw === "boolean" ? truncatedRaw : null;`) and `:194` emits the same key name in the
`KALSA_GOVERNOR` payload (the spread), so the wire name is byte-identical on both sides.

**Logic — CONFIRMED.** `route_mismatch` gains one conjunct (`:183`): a `true` truncation forces
`null` ("unseen chunks could hide the mismatch"), `false` lets the verdict be computed, and
absent/non-boolean yields `null` for the flag with the verdict exactly as before — the old-pin
behaviour. Nothing else in the object moved.

**Pin reality — CONFIRMED inert.** `package.json:50` pins `kalsa.rn#9e661f17…`, which is an ancestor
of the binding's `6b3778ab` and contains zero occurrences of `route_chunks_truncated`; the app
therefore logs `route_chunks_truncated: null` until the pin bumps, and the structural read is the
right shape for that window.

**Sabotages (scratch, real tree):** S1 truthy structural read (false→null, "yes"→true) → **1**;
S2 `dropped === 0 && truncated !== true` → `dropped === 0` → **1**; S3 gate inverted
(`truncated === true`) → **1** (2 failed); S4 emitted field always `null` → **1**; S5 emitted key
renamed (`route_chunks_trunc`) → **1** (suite fails to compile against the declared return type).
The new test asserts the flag, the `null` verdict on truncation, the clean `false` verdict without
it, and both absent/non-boolean reads — it goes red on every mutation that changes the contract.

**Verdict: SHIP.** Name/type/logic match the binding exactly, the null-truncation rule is the safe
one (an unverified verdict never serializes as a clean `false`), the app stays correct on the pinned
binding that lacks the field, and the test has teeth.
