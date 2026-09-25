# RE-AUDIT 4 — engine `a20257476` + `d7019ea86` (binding `9e661f17`)

**Verdict: SHIP.** Every prefill batch now passes admission, the latch reads the policy's engine
stamp, and the executed engine matches the owner's intended truth over the whole cell grid I modelled.

## The change — CONFIRMED

    runtime.cpp:70-73    n_batch = min(ctx_prefill, ctx_decode) cparams      (fast path deleted in a20257476)
    runtime.cpp:73-96    requested = policy_.prefill_engine(); admission = policy_.admit_prefill(...);
                         if (Undecided) { prefill_route_ = admission.engine == CPU ? CPU : GPU;
                                          stats_.prefill_engine = admission.engine; }
    policy.cpp:239       result.engine = requested;   (tail whole arm, d7019ea86)
    policy.cpp:274       result.engine = requested;   (row ladder, every admitted piece, d7019ea86)
    llama-governor.cpp:259-261  const bool cpu_prefill = is_prefill && prefill_route_ == CPU;
                         target = cpu_prefill ? ctx_decode : (is_prefill ? ctx_prefill : ctx_decode);

The latch is now the only place the route is decided, and since the policy stamps
`engine = requested` on every admitted piece, the route equals the requested engine; `decode_impl`
sends a GPU-route prefill to `ctx_prefill` and a CPU-route prefill to `ctx_decode`. Wait/Abort
return before the latch, so nothing executes on them.

## Intended truth over the cells — CONFIRMED (scratch model, no repo edits)

Model over `requested ∈ {CPU, GPU, GPU_COOLMODE}` × 16 temperatures (0…42) × 10 n_batch (2…4096) ×
~600 prompts, with the runtime latch exactly as coded:

- **0 violations** of: every executed piece ≥ 2 and ≤ n_batch; the executed route == the requested
  engine (GPU_COOLMODE → the GPU context); no execution on Wait/Abort.
- **Whole GPU admission → GPU**: a whole non-CPU piece stamps `engine = GPU` (`policy.cpp:239/272`)
  → latch GPU → `CPUFallback → return 0` (`runtime.cpp:94-96`) → `ctx_prefill`. Covered by the
  router check `"GPU whole prefill is admitted on the requested engine"` (`router.cpp:303-306`) and
  the turns context assertions (prewarm/whole → prefill KV, `run_hot_prefill_pause`).
- **CPU request or LOWBAT → CPU**: `engine = CPU` → latch CPU → `ctx_decode`; `run_low_battery_prefill`
  asserts `stats.prefill_engine == CPU` + decode KV at 304 (`turns.cpp:663-665`), and the chunked
  latched partition carries the `cpu:` prefix.
- **≥ 40 °C → Wait even on a latched route**: with no fast path, the latched route's later batch
  reaches the policy gate like any other; at 40.0 `below_warn` is false → `Wait` → `-2`, rule 0,
  nothing executed. Model: for every request class and n_batch, a 40 °C first batch Waits and the
  LOWBAT-then-hot repro (`2@35` then `129@40`, n_batch 128) pauses with rule 0 — the test
  `run_latched_cpu_route_state_gate` asserts exactly that (`turns.cpp:416-418`
  `warm_rc == -2 && !is_failed && last_router_rule == 0` and decode KV still at 15), plus the
  invalid-profile follow-up returning -1 with "prefill admission aborted" (`:437-439`).
- Rule stamps: Wait → 0, admitted → 9 (CPU) / 3 (GPU) (`policy.cpp:271`, verified in the model).

## Side effects of admitting every batch — CONFIRMED, one nit

- `stats_.last_router_rule` is now written for every prefill batch (the latched path used to skip
  it). That is what makes the binding's classifier label a latched-route 40 °C Wait `thermal`
  (rule 0) instead of reading a stale admitted rule — the test pins it (`:417`).
- `stats_.prefill_engine` is set once per turn from `admission.engine` (= requested) in the
  `Undecided` block; later batches keep the same value by construction (stable profile). ✓
- Dwell / `state_since_ms_` / LOWBAT exit: untouched by both commits — `update_thermal` is the only
  writer (`policy.cpp:96-103`), so no dwell side effect; a LOWBAT exit changes `requested` for the
  **next** turn, whose route is Undecided again and latches from the new engine. ✓
- PLAUSIBLE (minor, telemetry): a turn whose **first** batch Waits never latches, so
  `prefill_engine` keeps the previous turn's value in `KALSA_GOVERNOR` for that paused turn. The
  pause is typed and the next successful turn overwrites it; pre-existing shape, no code impact.

## Red-capability of the new tests — CONFIRMED by construction

- `run_latched_cpu_route_state_gate`: restoring the a20257476 fast path makes the in-cap 2-token
  batch return 0 at 40 °C → `waited` false → FAIL (the writer's sabotage: EXIT=1,
  `latched prefill did not wait at 40 C rc=0 rule=9`).
- Router `"GPU whole prefill is admitted on the requested engine"` (`:303-306`) and the NPU stamp
  (`:54-57`) FAIL under the old constant-`CPU` stamp / CPU routing.
- Turns context assertions (`chunks=512+512+128+128+49` on the prefill context vs `cpu:…` on the
  decode context) FAIL under the round-4 CPU routing (writer's sabotage 2: EXIT=1).
- `test_planner_remainders_never_wait` (`router.cpp:465-497`) FAILs if any remainder Waits/Aborts
  or returns < 2 tokens; it is the policy-side stand-in for the removed spinner test's precondition
  (the runtime branch is unreachable under the threading contract — declared).
- The removed spinner test's vacuous-pass gap is gone with it; no data-race test remains.

## Declared, contract-violation-only hazards (not blockers)

A mid-call `set_thermo_profile` (forbidden by `llama-governor.h:15-17`) can still: (a) make a later
chunk Wait after partial progress (execution-loop item 4); (b) leave the turn on a latched CPU
route while `requested` becomes GPU (the route wins; the owner's whole-GPU rule is not re-evaluated
mid-turn); (c) overwrite `last_router_rule` via `refresh_policy_stats` (`runtime.cpp:226`) and
degrade the label to `unexplained`. All require the documented overlap; the app's sequencing awaits
the thermo refresh before the completion. The `CPUFallback` name remains a documented misnomer
(`runtime.cpp:94-97`), and the redundant `CPUFallback → return 0` is declared. If an NPU request
ever reached the runtime, the latch `== CPU ? CPU : GPU` would map it to GPU — unreachable today
(`prefill_engine()` never returns NPU), and the policy stamp is tested.

## Runs (pgrep clear before building; one build; `-j 3`)

| command | EXIT |
|---|---|
| `cmake --build … -j 3 > /tmp/x-build4.log 2>&1` | **0** (no work; binaries current — the new router strings are present) |
| router | **0** |
| turns × 2.6B | **0** (latched gate, low battery, chunked, hot pause, row+1 all PASS; `run()` fixture bytes `1720320 == expected 1720320`; the latched gate is registered first, `turns.cpp:1001`) |
| hybrid with `KALSA_HYBRID_GGUF` | **0** (not 77) |

## Binding `9e661f17` — CONFIRMED

sha256-equal for `llama-governor-policy.cpp`, `llama-governor-policy.h`, `llama-governor-runtime.cpp`
vs engine `d7019ea86`; `VERSIONS=d7019ea867ab9d506479341cc57ebd58d3d6a7c7`; `src/version.ts`
11228/d7019ea; 10 files. `git branch -r --contains d7019ea86` and `… --contains 9e661f17` are empty
(local-only).

## Not verified

No device run; the runtime planner-Wait defensive branch has no runtime-level test (cannot exist
under the contract, declared); the no-policy 4-arg ctor path (bypass #7) is unchanged.
