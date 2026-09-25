# REPORT-APP — `/bench route cpu|gpu|auto` (app half)

Repo: kalsa app worktree `/Users/marco/Projects/kalsa-wt-bench-apk`. Branch detached: `e1d3441d` →
**`b9c63bf672711b6e0749adc7a500ec8cab88f5e2`** (one commit; `git branch --show-current` printed
before it; `git add` by name; no push; tree clean). Spec: `governor-archive-mining/SYNTHESIS.md` §4.
Insertion points: `bench-route-hook/RECON.md` §5 (app half only — engine/binding half is another
coder's; the interface is feature-detected against the current pin `463f11f9`).

## What was built

**1. Parse/persist — `src/bench/benchConfig.ts`** (devmodels pattern):
`route` subcommand (`:948-954`) validates `cpu|gpu|auto` against `ROUTE_MODES`, writes
`BENCH_ROUTE_KEY = "kalsa.bench.route"` via `setBenchRoute` (`auto` → `removeItem`, `:120-131`),
replies `bench: route=<mode> (next turn, no reload)`; `readBenchRoute` (`:107-117`) maps
absent/invalid/`auto` to the engine-decides default. Usage line, `formatBenchStatus`
(`route=` echo), header docs and the Keys list updated. The knob is explicitly documented as a
runtime push — it does not join the init-time/relaunch knobs.

**2. Push every turn — `src/engine/LlamaService.ts:1795-1810`**: inside
`refreshGovernorBeforeCompletion`'s `activeGovernorActive && engine === context` gate, after the
thermo write, `pushPrefillOverride(engine, await readBenchRoute())` under the existing
`withNativeCallTimeout` pattern; failure swallowed (a request is never a turn dependency). The
engine keeps every safety gate — the app only requests.

**3. New `src/engine/benchRoute.ts` (67 lines — one responsibility: the route hook's push and
evidence fields)**:
- `pushPrefillOverride` feature-detects `setPrefillOverride` (absent on the current pin): one
  `KALSA_BENCH_ROUTE {"applied":false,"reason":"unsupported"}` line per process, then
  `"unsupported"` — the turn carries on unchanged; present → method call (this-bound — the llama.rn
  wrappers read `this`).
- `governorRouteLogFields({turnId, routeMode, completionResult})` → `{turnId, route_mode,
  route_chunks}` with `route_chunks` copied from the completion result or `null` while the binding
  does not emit it.

**4. Evidence — `LlamaService.ts`**: `emitGovernorTelemetry` (`:1840-1845`) takes `turnId` +
`completionResult` and spreads the fields into `KALSA_GOVERNOR` (`:1879-1884`); both call sites
(`:5257`, `:5703`) pass the turn's id and `lastCompletionResult` (assigned after each completion,
matching the engine's per-completion stats reset). Join id: new `mintTurnId()` on the shared
`turnSeq` (`:517-524`, re-exported through `engineBackend.ts:73`), minted in
`engineTurnStream.ts:115` — where the first line logs — carried into `KALSA_WINDOW`
(`:128`, new `turnId` key) and into the turn via new `StreamTurnOptions.turnId`
(`LlamaService.ts:4117-4122`); `streamAssistantTurn` uses `options.turnId ?? mintTurnId()`
(`:4260`), so **window → telemetry → governor join on one id** (greedy `KALSA_BENCH_TOKENS` and the
tool-round line inherit it too).

## Tests (each red under its sabotage, all restored to EXIT=0)

| Area | Test | Sabotage | EXIT |
|---|---|---|---|
| Parse/persist round-trip | `benchConfig.test.ts` +3: cpu persists & `show` echoes; `auto` clears the key and reads `auto`; unknown mode refused with nothing written | drop the `route` subcommand | **1** (3 failed) |
| Unsupported-binding path | `benchRoute.test.ts`: absent → `"unsupported"` + exactly one `KALSA_BENCH_ROUTE` line after two calls; present → applied as a method call on the engine, no log | mute the unsupported log | **1** (1 failed) |
| Log-shape builder | `benchRoute.test.ts`: `{turnId, route_mode}` passthrough, `route_chunks` copied / `null` when absent or non-array | builder always `null` | **1** (1 failed) |
| KALSA_WINDOW join (spec §4) | `benchRoute.test.ts`: one mint per send, `options.turnId ?? mintTurnId()` in the turn, `turnId` in the window block (comment-stripped) | drop the window `turnId` | **1** (1 failed) |

## Commands (real exit codes)

- Targeted (7 suites: benchRoute, benchConfig, benchTurn, governorPauseWiring, governorPauseLog,
  thermalResume, turnEnsureDispatch) — **EXIT=0** (93 tests).
- `npx tsc --noEmit` — **EXIT=0**.
- One full `npx jest` at the end — **EXIT=0** (**238 suites, 2524 tests**; baseline 237/2514 →
  +1 suite/+10 tests).

## Not verified / declared

- **No device run.** `setPrefillOverride` and `route_chunks` do not exist on the current pin — the
  hook is inert-but-loud (one unsupported line) until the binding lands; the applied path and the
  real chunk facts were never executed.
- The spec's "reject if actual differs from requested" is left to the offline driver (the recon's
  open section); the app only records the evidence.
- `benchConfig.ts` grew to ~984 lines — pre-existing excess, declared, not refactored.
- Remote-backend turns mint an id whose telemetry lives on the remote side (route is a
  local-governor hook; out of scope).

---

# Fix round 1 (deepseek audit of `b9c63bf6`: NO → all four)

One commit on top of `b9c63bf6`: **`1350724cc5e5c4919462f139ec6996798518ea71`** (kalsa app,
worktree `kalsa-wt-bench-apk`, branch detached — printed before the commit; `git add` by name; no
push; tree clean).

**F1 — `route_mode` is the pushed value.** `refreshGovernorBeforeCompletion` records
`turnRoutePush` **at the push** (`LlamaService.ts`, inside the governor gate: `readBenchRoute` once,
then `pushPrefillOverride`); the record resets at turn start (`streamAssistantTurn`) and the emit
consumes it — `emitGovernorTelemetry` no longer calls `readBenchRoute` (source-pinned: the emit
region contains no `readBenchRoute(`). `governorRouteLogFields` emits `route_mode` **only when the
push was applied**; attempted-but-inactive / no push → `route_mode: null` + `route_push: "skipped"`.

**F2 — per-turn `route_push`.** Values `applied | unsupported | failed | timeout | skipped` on
`KALSA_GOVERNOR`. The push is now self-bounded **inside** `benchRoute.ts` with its own
**2-second** timer (`BENCH_ROUTE_PUSH_TIMEOUT_MS`) — chosen because the 15 s
`ENGINE_AUX_CALL_TIMEOUT_MS` exists for native work that gates the turn, while this setter is a
sticky dev request that answers in ms when healthy, and the push runs before every completion,
each cooling retry, each utility call and the prewarm; 2 s caps that added latency per refresh and
stays far above a healthy answer. Rejecting setter → `failed`, still-pending at the bound →
`timeout`, method absent → `unsupported` (the one-per-process `KALSA_BENCH_ROUTE` line), else
`applied`; the bounded push never throws, so the refresh call site lost its catch. The outcome is
recorded on the governor line (F1's record), not re-derived.

**F3 — retry keyed, not re-minted.** The runtime-fallback retry keeps the send's `turnId`
(`retryTurnId = options.turnId ?? mintTurnId()` — mint only if the window never logged) and gains
`retryAttempt = (options.turnAttempt ?? 1) + 1`, passed through new `StreamTurnOptions.turnAttempt`.
The marker logs `{reason, turnId, attempt}` with **the attempt the retry will run**, and both
`KALSA_GOVERNOR` (`attempt: turnAttempt`) and `KALSA_TELEMETRY`
(`formatTelemetryLine(turnId, r, attempt)`, default 1 — additive key) carry it, so attempt-1 lines
separate from the reloaded attempt 2's. **Declared:** `KALSA_ANSWER_TRUNCATED` and the tool-round
line are not attempt-keyed (pre-existing shapes).

**F4 — validated chunks.** `asRouteChunk` projects each entry onto the six spec fields with
closed-set literals (`requested ∈ cpu|gpu|auto`, `actual ∈ cpu|gpu`), drops malformed entries and
counts them in `route_chunks_dropped` (null when `route_chunks` is absent/non-array). Pure, in
`benchRoute.ts` (157 lines total, one responsibility: the route hook's push + evidence).

**Tests** — `benchRoute.test.ts` rewritten to the contract (208 lines): F1 applied-gate + skipped
case; F2 rejecting→`failed`, hung→`timeout` (fake timers, the exported bound); F4 projection, drop
count, absent/non-array; F3 source pins (marker keys, retry id/attempt, governor attempt, telemetry
attempt call, no `readBenchRoute` in the emit region). `turnTelemetry.test.ts` pins attempt default
1 / explicit 2.

**Sabotages (each EXIT=1, each restored to EXIT=0):** F1 ungated `route_mode` (deepseek's **S7**,
2 failed); rejecting setter reported `applied` (2 failed — covers the timeout branch too); raw chunks
forwarded (1 failed); marker without `attempt` (1 failed).

**Commands:** targeted (9 suites incl. ciswire/bench/governor neighbors) **EXIT=0** (113 tests);
`npx tsc --noEmit` **EXIT=0**; one full `npx jest` at the end **EXIT=0** (238 suites, 2531 tests;
baseline 238/2524 → +7).

**Not verified:** no device run — `setPrefillOverride`/`route_chunks` still absent on the pin
(feature-detected, inert); the two mid-edit repair steps on `LlamaService` (a mis-placed retry-scope
hoist, caught by tsc and re-anchored before any test ran) left no residue; attempt not added to
`KALSA_ANSWER_TRUNCATED`/tool-round lines (declared above).

---

# Fix round 2 (luna NO + deepseek nits)

One commit on top of `1350724c`: **`bde448cae2a222ba325aae055cbfe161412a1d5d`** (kalsa app,
worktree `kalsa-wt-bench-apk`, branch detached — printed before the commit; `git add` by name; no
push; tree clean).

**1. Strict chunk facts (luna).** `asRouteChunk` (`benchRoute.ts`) now requires non-negative
integer `index`/`tokens` and finite non-negative `prefill_ms` — NaN, Infinity, negatives and
fractions count as malformed and land in `route_chunks_dropped` instead of serializing to `null`
inside numeric fields.

**2. `route_mismatch` (luna / SYNTHESIS:156).** `governorRouteLogFields` emits
`route_mismatch: true | false` when a **forced** mode (`cpu`/`gpu`) was applied and any executed
chunk's `actual` differs from it; `null` when not forced, not applied, or when there are no chunks
to compare (an unverified claim must not serialize as a clean `false`). The app records the spec's
rejection verdict — it never blocks the turn; routing stays the engine's. Pure, tested both ways.

**3. `KALSA_TELEMETRY.turnId` pinned (luna).** `turnTelemetry.test.ts` asserts `turnId` on the
payload — dropping it now goes red.

**4. Deepseek nits.**
- `route_requested` added to the builder output: the mode THIS turn asked for, present even on
  `failed`/`timeout` (`route_mode` remains the applied-only field; skipped → both null).
- The shipped bound pinned: `BENCH_ROUTE_PUSH_TIMEOUT_MS === 2_000` in the push describe.
- `?? mintTurnId()` fallbacks **removed**: `StreamTurnOptions.turnId` is now required, the turn
  consumes `options.turnId` verbatim, and the retry rides the spread — quoted why (every caller
  supplies it: the first-line phase mints it; a retry-side mint is exactly what would split one
  send across two ids) and negative-pinned (`not.toContain("?? mintTurnId()")`). The two test files
  that construct `StreamTurnOptions` now pass a `turnId` like every real caller
  (`engineBackend.test.ts`, `remoteEngine.lifecycle.test.ts` — 27 option literals).
- Stray 4-space `try {` at `LlamaService.ts:1503` (round-1 hoist artifact) re-indented.

**Sabotages (each EXIT=1, each restored to EXIT=0):** fractional/NaN `index` accepted again (1
failed); `route_mismatch` never recorded (1 failed); telemetry `turnId` dropped (1 failed) — its
first anchor missed (comment lines) and was re-run against the real text; `route_requested` always
null (1 failed); bound `2_000 → 15_000` (1 failed); id-mint fallback re-added (1 failed).

**Commands:** targeted (10 suites incl. ciswire/bench/governor/backend/remote neighbors) **EXIT=0**
(150 tests); `npx tsc --noEmit` **EXIT=0**; one full `npx jest` at the end **EXIT=0** (238 suites,
2535 tests; baseline 238/2531 → +4). `benchRoute.ts` 180 / test 275 lines — under 350;
`turnTelemetry.ts` untouched this round (sabotage restored byte-identically).

**Not verified:** no device run — `setPrefillOverride`/`route_chunks` still absent on the pin
(feature-detected, inert); the mismatch verdict and strict numerics are exercised only through the
pure builder; luna's PLAUSIBLE late-apply-after-timeout remains a binding-half interface item.

**Addendum — Luna Re-audit of `bde448ca`: a dropped chunk makes `route_mismatch` unknown.**
Follow-up commit on top of `bde448ca`: **`48103c9e2cd5f9638ef1c0c6916a50bb957a26eb`** (branch
detached, printed before the commit, `git add` by name, no push, tree clean). The verdict required
`dropped === 0` alongside forced-applied + chunks-present (`benchRoute.ts:163-173`): with any
malformed entry dropped, `route_mismatch` is now `null` — an executed chunk's `actual` is unknown,
so the verdict is — never a clean `false`. Test: the mismatch case gained a NaN-index chunk hiding
behind a matching kept one (`dropped: 1` → `null`). **Sabotage (drop the `dropped === 0` term) →
EXIT=1** (1 failed), restored **EXIT=0**. Commands: targeted `benchRoute` **EXIT=0** (16 tests);
`npx tsc --noEmit` **EXIT=0**; one full `npx jest` **EXIT=0** (238 suites, 2535 tests). Not
verified: no device run.

---

# Truncation

One commit on top of `9d4ef64f` (now origin/main): **`3bcfd08d2dae280192111a2229e63b1881b581a1`**
(kalsa app, worktree `kalsa-wt-bench-apk`, branch detached — printed before the commit; `git add`
by name; no push; tree clean).

The binding (`6b3778ab`, `src/types.ts:597-601`, **not pinned yet**) emits
`route_chunks_truncated: boolean` beside `route_chunks`. In `src/engine/benchRoute.ts`
`governorRouteLogFields` now:

- reads it structurally (same `as { …?: unknown }` shape as `route_chunks` — the pin predates it);
- emits `route_chunks_truncated: boolean | null` (non-boolean → null) on `KALSA_GOVERNOR`;
- folds it into the verdict: **true → `route_mismatch: null`** — unseen chunks could hide a
  mismatch, the identical rule as `route_chunks_dropped > 0`; only a fully-seen, fully-matching
  forced arm may print `false`. Absent (unpinned binding) leaves the verdict to the chunks as
  before.

**Tests** — `benchRoute.test.ts` (+1, 16→17): the three exact-shape expectations gain the new key;
new case pins `true → mismatch null` (visible chunks all match), `false → verdict computed`,
absent/non-boolean → `null` with the chunk-based verdict unchanged. **Sabotage (drop the
`truncated !== true` term from the gate) → EXIT=1** (1 failed), restored **EXIT=0**.

**Commands:** targeted (`benchRoute`) **EXIT=0** (17 tests); `npx tsc --noEmit` **EXIT=0**; one full
`npx jest` **EXIT=0** (238 suites, 2536 tests; baseline 238/2535 → +1).

**Not verified:** no device run — the native producer is not pinned yet, so only the structural read
and the pure builder are exercised; a real truncated emission is unobserved.
