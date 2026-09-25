# RE-AUDIT 3 — engine `e4a33422c` + `e44a8da0e` (binding `43a0da85`)

**Verdict: SHIP.** The latched-CPU partition is correct, the mid-plan Wait is now a labelled pause,
and the bypass list holds except one wording error (#7). The spinner test cannot false-fail; it can
pass vacuously.

## `e4a33422c` — latched CPU prefills over n_batch — CONFIRMED

    runtime.cpp:70-72   const uint32_t n_batch = ctx_prefill && ctx_decode ? min(...) : UINT32_MAX;
    runtime.cpp:73-87   if (prefill_route_ == CPU) { Invalid/CRITICAL -> fail; if (batch.n_tokens <= n_batch) return 0;
                        /* oversized: fall through */ }
    runtime.cpp:91-92   policy_.admit_prefill(requested, batch.n_tokens, now_c, n_batch);

The gate order is preserved (Invalid/CRITICAL first), the oversized batch takes the *same*
admission/partition path as an undecided route, and the inner chunks re-enter the latched branch
(≤ n_batch) and return 0, so execution stays on the CPU context. Scratch model (no repo edits) of the
two-batch luna repro: `[2]` (latch, whole) + `[127, 2]` = `cpu:2+127+2`; a latched 500 @35 with
n_batch 512 → `[128,128,128,116]`; a latched 2049 @34 with n_batch 2048 → `[1024,1025]`. Every
executed piece ≥ 2 and ≤ n_batch; the test's assertion matches
(`tests/test-governor-v0-turns.cpp:467-471`, run `governor_latched_cpu_route_n_batch_cap=PASS
chunks=cpu:2+127+2`).

## `e44a8da0e` — the planner's Wait — CONFIRMED

    runtime.cpp:125-136  next = policy_.admit_prefill(...);
                         if (next.decision == Wait) { stats_.last_router_rule = next.rule;
                             log_thermal_pause(__func__, current_temperature_c(), thermal_state()); return -2; }
                         if (next.decision == Abort || next.tokens == 0) { INFO; return -2; }
    runtime.cpp:26-32    log_thermal_pause(...) — one definition of the pause line (prefix unchanged)

- The Wait branch now precedes the `tokens == 0` guard; a policy Wait always carries `tokens == 0`
  (the early gate and the `table == 0` branch return the default-zeroed `result`:
  `policy.cpp:206-212`, `:235-244`), so the old guard swallowed it into a bare -2 — exactly the
  pre-fix 15-warns/24-pauses. Now the rule-0 stamp is written before the return
  (`last_router_rule = next.rule` = 0) and the same warn line is emitted, so the binding's
  classifier sees `rule == 0` and labels it thermal.
- The dead `return 0` is gone; the model confirms that under a **stable** profile there is no
  mid-plan Wait for any `n < 8300` at 35.0 or 39.9 °C and any n_batch (the outer Wait stops ≥ 40 °C
  before the loop), while a flip sequence pauses: `runtime_midplan(500,[35,35,40],512)` → pause with
  no piece executed (the planner collects chunk sizes before the execution loop, `runtime.cpp:139+`,
  so a mid-plan Wait runs nothing — the report's claim holds).
- Every executed piece in the flip model stays ≥ 2 and ≤ n_batch (0 violations over n < 4000 × 5
  temperature sequences).

## Bypass list — attack

1. Latched early return — FIXED (`:81-86`); model + test above. ✓
2. `CPUFallback → return 0` — safe: the policy stamps CPUFallback only with `tokens == prompt_tokens`
   (`policy.cpp:239-240`, `:271-276`) and every path caps `tokens ≤ n_batch`. ✓
3. `admission.tokens >= n_tokens → return 0` — safe: `tokens ≤ n_batch ⇒ n_tokens ≤ n_batch`. ✓
4. Planner mid-Wait — FIXED this round (above). ✓
5. `k_prefill_chunked` — each `count = min(policy tokens, remaining)` with the policy tokens ≤ n_batch;
   the execution loop consumes exactly those counts. ✓
6. `select_decode → return 0` (`runtime.cpp:187`) — reachable only for `is_prefill = n_tokens > 1`
   false (`llama-governor.cpp:246`), i.e. a 1-token batch ≤ n_batch (n_batch ≥ 1 enforced upstream). ✓
7. Non-policy governor pass-through (`policy_enabled_ == false`) — **REFUTED as written**: the report
   says "no callers found in tests or binding", but the hybrid test calls it —
   `tests/test-governor-v0-hybrid.cpp:155,251 llama_governor_init(model, model, cparams, cparams)`,
   and that 4-arg ctor delegates with `policy_enabled = false`
   (`src/llama-governor.cpp:15-16 : llama_governor(..., llama_governor_params{}, false)`). The
   production half of the claim holds: the binding uses
   `cpp/rn-governor.cpp:17 llama_governor_init_with_params_internal(...)` (policy on). The hybrid
   binary therefore exercises a no-cap pass-through by design, with tiny batches; the note is a
   wording defect, not a live hole.
- `return 0` census matches the list: only `:82, :109, :112, :187`; no unlisted bypass found.

## Spinner-thread test — no false-fail, possible vacuous pass — PLAUSIBLE

    tests/test-governor-v0-turns.cpp:556-577  pause_attempt = rc == -2; ...
        if (pause_warns != paused) { ... return false; }

- False FAIL: the two profiles differ only in `batt_temp_tenths_c` (identical valid fields,
  `:518-525`), so a concurrent reader sees one whole value (aligned int32; no torn profile); the only
  outcomes are a warm partitioned `rc == 0` with `'+'` in the chunk string, a top-level hot Wait, or a
  mid-plan hot Wait — all -2 pauses take the single warn line, so `warns == pauses` cannot break from
  the flip schedule. The log callback is restored after the join before any return (`:568-573`).
- Vacuous PASS: if the spinner never overlaps a planner admission, `paused == 0` and the parity
  `0 == 0` passes with no assertion that ≥ 1 pause occurred. With the writer's and my runs it was
  24/24, but the test does not pin it. Recommend `paused >= 1` (or ≥ half the attempts) before this
  is treated as a regression gate. Also note the test is a deliberate data race against the engine's
  "decode() and set_thermo_profile() must not overlap" contract (`llama-governor.h:15`) — the hazard
  under test; UB is inherent to it.

## Binding classifier — CONFIRMED thermal for the mid-plan Wait

    cpp/rn-llama.cpp:696-704  stats = governor->stats();
        if (batch.n_tokens > 1) { Unknown -> "profile"; else if (stats.last_router_rule == 0) -> "thermal"; else "unexplained"; }

The mid-plan Wait writes `stats_.last_router_rule = next.rule` (0) on the decode thread immediately
before returning -2 (`runtime.cpp:132`), and the binding reads the stats after that decode; the
profile is valid (not Unknown) → `"thermal"`, so the host may cool-and-retry. Declared caveat holds:
a concurrent `set_thermo_profile` calls `refresh_policy_stats()` (`runtime.cpp:237`), which rewrites
`last_router_rule = policy_.prefill_rule()` (`runtime.cpp:62`) — under the contract violation the
label can degrade to `"unexplained"` (safe: no cool-and-resume), which is why the test cannot assert
the stamp.

## Runs (one build at a time; `pgrep` clear; `-j 3`)

| command | EXIT |
|---|---|
| `pgrep -fl 'cmake\|ninja\|make'` before building | no builds running |
| `cmake --build … -j 3 > /tmp/x-build3.log 2>&1` | **0** (no work; binaries current, new strings present) |
| router | **0** |
| turns × 2.6B | **0** (`governor_latched_cpu_route_n_batch_cap=PASS chunks=cpu:2+127+2`, `governor_mid_plan_profile_flip=PASS attempts=24 pauses=24 warns=24`) |
| hybrid with `KALSA_HYBRID_GGUF` | **0** (not 77) |

## Binding `43a0da85` — CONFIRMED

sha256-equal for `llama-governor-policy.cpp`, `llama-governor-policy.h`,
`llama-governor-runtime.cpp` vs engine `e44a8da0e`; `VERSIONS=e44a8da0e7adcdea68dac3306521f04a5c766be0`;
`src/version.ts` 11226/e44a8da; 9 files = runtime + version/identity. `git branch -r --contains
43a0da85` empty (local, like the engine branch).

## Not verified / declared

- No device run; the rule-0 stamp is not asserted by the test (declared, and explainable by the
  concurrent `refresh_policy_stats`); the vacuous-pass gap above.
