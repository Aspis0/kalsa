# App audit — `/bench route cpu|gpu|auto`

Range `e1d3441d..1350724c` in `/Users/marco/Projects/kalsa-wt-bench-apk`; HEAD `1350724cc5e5c4919462f139ec6996798518ea71`, worktree clean. Read-only app review; scratch-only mutations. No device run. The current binding lacks `setPrefillOverride` and `route_chunks`, so the applied route path remains unverified on device.

## Findings

- **CONFIRMED — malformed numeric chunk facts survive projection.** `benchRoute.ts:101-108` checks only `typeof === "number"` for `index`, `tokens`, and `prefill_ms`, and `:112-118` copies them. Thus NaN, Infinity, negative values, and fractional indexes/token counts are accepted; JSON serialization can turn non-finite values into `null` without incrementing `route_chunks_dropped`. A scratch assertion requiring NaN/Infinity to be dropped failed (**EXIT=1**), confirming the gap.
- **CONFIRMED — the app does not reject route/request mismatches required by the spec.** The spec says “Reject if actual differs from requested on any chunk” (`SYNTHESIS.md:154-156`). The builder emits an applied `route_mode` from the requested push and independently forwards every structurally valid chunk (`benchRoute.ts:146-154`); it neither checks `chunk.requested` against the push nor exposes an invalid-turn verdict when `actual !== requested`. Both values are logged, so a careful offline consumer can reject the record; **PLAUSIBLE** evidence mislabeling remains if a consumer groups by `route_mode` without enforcing the spec.
- **CONFIRMED — telemetry turn-ID regression is not caught by the tests.** Current code includes `turnId` in the `KALSA_TELEMETRY` object (`turnTelemetry.ts:226-230`), but removing that property in scratch left `turnTelemetry.test.ts` + `benchRoute.test.ts` green (**EXIT=0**, 21 tests). The tested joins pin `KALSA_WINDOW` and the governor spread (`benchRoute.test.ts:168-183`), but not the telemetry payload’s ID.
- **REFUTED — current normal-path join is miswired.** The send mints one ID (`engineTurnStream.ts:115`), logs it on `KALSA_WINDOW` (`:126-129`), and passes it into stream options (`:284-288`). `streamAssistantTurn` reuses that ID and serializes turn work through `withEngineJob` (`LlamaService.ts:4245-4285`); telemetry and governor lines both receive it (`turnTelemetry.ts:220-230`, `LlamaService.ts:1877-1882`). Runtime fallback keeps the ID and increments the attempt (`LlamaService.ts:5842-5848`).
- **REFUTED — added route evidence logs user/model text.** Unsupported logging emits fixed `applied:false` and `reason:"unsupported"` (`benchRoute.ts:54-65`). Route records project only the six closed fields (`:112-118`); route mode, status, and attempt are enums/numbers, and `turnId` is a monotonic counter. No prompt, response, path, or model name is serialized by these additions.
- **CONFIRMED — no unbounded JS wait; per-refresh latency is bounded.** A supported setter is awaited in a race capped at 2,000 ms and its timer is cleared (`benchRoute.ts:35,67-80`). That can add up to 2 s each time; the helper is used for each completion/retry as documented at `:31-33`. A timed-out native call is not cancelled, so a late or reordered apply is **PLAUSIBLE** on the not-yet-available binding; device ordering is unverified.

## Scratch checks

Scratch `/tmp/kalsa-audit-bench-route-1350724c-933`: `npm ci` **EXIT=0**; `node_modules` and `node_modules/llama.rn` were real directories, not symlinks. Targeted baseline (`benchConfig`, `benchRoute`, `turnTelemetry`) **EXIT=0**, 3 suites / 58 tests. Applied-route ungating sabotage **EXIT=1**; dropping the window ID **EXIT=1**; dropping `KALSA_TELEMETRY.turnId` **EXIT=0**; added non-finite-chunk rejection assertion **EXIT=1** against current behavior. `git diff --check e1d3441d..1350724c` **EXIT=0**. No full suite, typecheck, native build, or device test.

## Verdict

**NO.** The current common-path ID wiring is correct and the hook is bounded, but non-finite chunk data is treated as valid despite being counted as malformed, and requested/actual mismatches are not rejected in the app’s evidence path. The telemetry-ID mutation also stays green, leaving the core join vulnerable to regression.

## Re-audit — bde448ca

Read-only review of `bde448cae2a222ba325aae055cbfe161412a1d5d` on `1350724c`; app worktree clean. Scratch `/tmp/kalsa-audit-bench-route-bde448ca-9466` used a real `npm ci`; all probes stayed there. No device run; the current binding still lacks `setPrefillOverride` and `route_chunks`.

### Findings

- **CONFIRMED — strict numeric chunk validation is fixed.** `benchRoute.ts:101-114` now requires non-negative integer `index`/`tokens` and finite non-negative `prefill_ms`, rejecting malformed facts before projection. Removing the index checks made the test red (**EXIT=1**).
- **CONFIRMED — normal ID plumbing and required options are sound, including remote dispatch.** The sole production host send mints one ID (`engineTurnStream.ts:115`), places that ID in the options (`:284-288`) and `KALSA_WINDOW` (`:126-129`). `engineBackend.ts:178-189` forwards the options unchanged to local or remote; `RemoteEngine.ts:241-248` accepts the same options. The local turn reads `options.turnId` directly (`LlamaService.ts:4282-4285`), and retry spreads the options while incrementing only `turnAttempt` (`:5847-5850`). Repository scan found no other production stream caller; `npx tsc --noEmit` passed. The remote implementation does not use `turnId` for remote telemetry, so it produces no local `KALSA_TELEMETRY`/`KALSA_GOVERNOR` join; remote inference is not CPU-vs-GPU device evidence.
- **CONFIRMED — one false-clean mismatch case remains.** `routeMismatch` compares only the filtered `chunks` (`benchRoute.ts:156-170`), while malformed count is returned separately (`:157-162,178`). In scratch, a valid matching GPU chunk plus a dropped chunk with `actual:"cpu"` yielded `route_chunks_dropped:1` and `route_mismatch:false`; an assertion requiring an inconclusive `null` failed (**EXIT=1**). That false value says all chunks match despite one executed chunk being unknown; a consumer that accepts `route_mismatch:false` without also rejecting nonzero `route_chunks_dropped` can retain invalid heat evidence.
- **PLAUSIBLE — mismatch check may be using the wrong requested value.** The spec requires rejecting `actual != requested` per chunk (`SYNTHESIS.md:150-156`), but the implementation compares `chunk.actual` to the global `appliedMode` (`benchRoute.ts:163-169`) and does not inspect `chunk.requested` for the verdict. Since the binding contract is not available to test whether per-chunk `requested` always equals the app-level forced mode, this could not be confirmed on device.
- **REFUTED — telemetry-ID test gap is fixed.** `turnTelemetry.test.ts:93-96` asserts payload `turnId`; removing it made the test red (**EXIT=1**). Earlier probes also went red: applied-route ungating (**EXIT=1**), dropping `KALSA_WINDOW.turnId` (**EXIT=1**), missing mismatch logic (**EXIT=1**), `route_requested:null` (**EXIT=1**), restoring `?? mintTurnId()` (**EXIT=1**), and changing the bound to 15 s (**EXIT=1**).
- **REFUTED — added route logs contain user/model text.** `benchRoute.ts:171-178` emits the counter ID, requested/applied modes, outcome, mismatch, and validated chunk projection only. Unsupported logging stays fixed literals (`:54-65`).
- **CONFIRMED — waits remain bounded, with a plausible late native apply.** The setter timeout is pinned at 2,000 ms (`benchRoute.test.ts:44-46`) and `Promise.race` clears its timer (`benchRoute.ts:67-80`). A send can pay that bound on each refresh. Timeout does not cancel the native call, so a delayed setter may still apply later; this is unverified until the binding exists.

### Checks

- Scratch `npm ci` — **EXIT=0**; `node_modules` and `node_modules/llama.rn` were real directories, not symlinks.
- Targeted Jest (`benchRoute`, `turnTelemetry`, `benchConfig`, `engineBackend`, `remoteEngine.lifecycle`, `engineBackendStream`) — **EXIT=0**, 6 suites / 98 tests. `npx tsc --noEmit` — **EXIT=0**; `git diff --check 1350724c..bde448ca` — **EXIT=0**.
- Required prior mutations: strict-numeric guard removal **EXIT=1**; mismatch always null **EXIT=1**; telemetry ID removal **EXIT=1**; route ungated **EXIT=1**; window ID dropped **EXIT=1**. New dropped-mismatch case above remains a false-clean result.
- No full suite, native build, or device test.

### Verdict

**NO.** Most prior findings and the stream-option change are sound, but a dropped mismatching chunk can still produce `route_mismatch:false`, which is unsafe as a rejection verdict unless every downstream reader separately filters `route_chunks_dropped`.

### Source quotes

- `benchRoute.ts:159-169`: `const chunks = projected === null ? null : projected.filter((chunk): chunk is RouteChunk => chunk !== null);` then `chunks.some((chunk) => chunk.actual !== appliedMode)`. Dropped chunks cannot affect the false/true result.
- `benchRoute.ts:178`: `route_chunks_dropped: dropped,` — this warning is separate from the mismatch verdict.
- `engineTurnStream.ts:115`: `const turnId = mintTurnId();`; `:287`: `turnId,`; `:128`: `turnId,` in the window payload.
- `turnTelemetry.ts:226-230`: `turnId,` and `attempt,` are serialized into `KALSA_TELEMETRY`.
- `LlamaService.ts:4285`: `const turnId = options.turnId;`; `:5848-5850`: retry spreads `...options` and changes only `turnAttempt`.

## Re-audit 2 — 48103c9e

**SHIP** on `e1d3441d..48103c9e`. The prior dropped-mismatch case now returns `route_mismatch:null`: the verdict requires `dropped === 0` (`benchRoute.ts:165-176`), and the test asserts null with a dropped chunk (`benchRoute.test.ts:147-154`). In scratch with a real `npm ci`, the earlier stronger probe (kept GPU match + dropped NaN-index CPU mismatch) passed (**EXIT=0**); removing the `dropped === 0` guard made the test fail (**EXIT=1**). Targeted `benchRoute` Jest: **EXIT=0**, 16 tests. `npm ci`: **EXIT=0**, real `node_modules` and `node_modules/llama.rn` directories, no symlinks. `git diff --check bde448ca..48103c9e`: **EXIT=0**; app worktree clean. No device run; binding support remains unverified.

## Truncation — 3bcfd08d

**CONFIRMED — name, type, and behavior match the binding contract.** Binding `src/types.ts:599` declares `route_chunks_truncated?: boolean`; `cpp/jsi/JSICompletion.h:238` emits `res["route_chunks_truncated"] = governor_stats.route_chunks_truncated`. Engine runtime resets the flag at each completion (`llama-governor-runtime.cpp:226`) and sets it when the bounded chunk array is full (`llama-governor.cpp:305-320`). The app reads that exact optional boolean (`benchRoute.ts:160-164`) and gates a clean route verdict on `truncated !== true` (`:178-185`); the test covers true → null, false → computed, absent → legacy behavior (`benchRoute.test.ts:187-214`).

Scratch `/tmp/kalsa-audit-bench-route-3bcfd08d-17327`, real `npm ci`: **EXIT=0**; `node_modules` and `node_modules/llama.rn` are real directories. Targeted truncation Jest: **EXIT=0** (1 passed). Repeated sabotage replacing the truncation gate with unconditional true: **EXIT=1**, as the `true → null` assertion fails. App `git diff --check 9d4ef64f..3bcfd08d`: **EXIT=0**; app worktree clean. Binding's pre-existing untracked pnpm files were left untouched. No device run.

**SHIP** for this truncation change and its behavior over the audited range.
