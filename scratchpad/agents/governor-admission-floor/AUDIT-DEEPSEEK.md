# AUDIT — prefill admission floor below 40 °C (engine `497ca1cc`, binding `2ba2bbc9`)

**Verdict: SHIP.** The floor implements the owner decision exactly and the residual below-40 stall is
pre-existing, not introduced. Notes only.

## The floor — CONFIRMED

    llama-governor-policy.cpp:10   constexpr float k_warn_c = 40.0f;
    llama-governor-policy.cpp:11   constexpr float k_limit_c = k_warn_c - 0.5f;
    llama-governor-policy.cpp:15   constexpr float k_cpu_delta_c[] = { 1.9f, 3.25f, 3.25f, 5.15f };
    llama-governor-policy.cpp:216  const bool below_warn = now_c < k_warn_c;
    llama-governor-policy.cpp:217  while (table > 0 && now_c + k_cpu_delta_c[table - 1] > k_limit_c) {
    llama-governor-policy.cpp:218      if (table == 1 && below_warn) { break; }
    llama-governor-policy.cpp:224      if (prompt_tokens < k_table_tokens[0] && below_warn) {
    llama-governor-policy.cpp:230          result.decision = llama_governor_decision::Wait;

- At `table == 1` the loop would need `now_c + 1.9 > 39.5` (i.e. `now_c > 37.6`, the comment's number,
  `:214`) to empty; the break keeps 128. At ≥40.0 `below_warn` false → the loop empties and the tail
  also fails → `Wait` (`:230`); exactly 40.0 waits (`40.0 < 40.0` false), as the owner asked.
- Prompts <128 → `table == 0` → the tail admits the whole prompt below 40 (`:224-228`); at ≥40 Wait.
- No zero/negative index: `k_table_tokens[] = {128,512,1024,2048}` (`:14`), the loop guards
  `table > 0`, and `result.tokens = k_table_tokens[table - 1]` (`:235`) runs only with `table >= 1`.
- Precedence CONFIRMED: the early gate is before the table —
  `:199-205 if (!profile_valid_ || !have_profile_ || state_ == Invalid || state_ == CRITICAL || prompt_tokens == 0) ... Abort/Wait`
  — so the floor never admits in CRITICAL/Invalid. LOWBAT is not in the gate; `prefill_engine()`
  returns CPU (`:160-164`) and the floor admits *CPU* chunks below 40, which is right: LOWBAT removes
  the GPU, not the prefill.
- NaN/invalid temperature — **PLAUSIBLE-minor**: `NaN < 40` is false and `NaN + delta > limit` is
  false, so the table is not reduced and the largest row would be admitted. Unreachable through the
  C API (`batt_temp_tenths_c` is an int32; `current_temperature_c()` is finite); only a direct policy
  caller can do it. No `isfinite` guard on `admit_prefill`'s `now_c`.

## Residual stall below 40 for a 1-token remainder — CONFIRMED (pre-existing, not fixed)

    llama-governor-runtime.cpp:108  const int32_t count = std::min<int32_t>(next.tokens, remaining);
    llama-governor-runtime.cpp:109  if (count <= 1) {
    llama-governor-runtime.cpp:110      return -2;

The chunk-size loop runs before any decode, and a prompt of length ≡ 1 (mod the chosen row) leaves a
1-token remainder: the policy tail admits 1 (`:224-228`), but the runtime refuses `count <= 1` and
returns -2. So a 129-token prompt at 37.8 °C still stalls the turn with `-2` below the warn line —
the report's "128 tokens, or the whole prompt if shorter" holds for the *policy* but not for a
*remainder*. The same refusal exists before this commit (a 129-token prompt at 35 °C also -2s), so
the commit does not introduce it, and the reported S23 incident (a 2-token batch, RECON-ADMISSION
`:52`) is fixed. Recommend merging a 1-token tail into the previous chunk below the warn line, in a
separate change. The rest of the loop is safe: with monotone deltas and the floor, the outer call
passes ⇒ every later `next` is admitted, so the mid-loop `Wait → return 0` (`:104-106`) is
unreachable defensive code, `count` advances by ≥2, and no zero-size chunk is emitted.

## Removed behaviour / tests — CONFIRMED legitimate

The two changed router checks encoded the pre-decision contract
(`tests/test-governor-v02-router.cpp:280-282`, `:309-311`): 2048 @ 37.9 and GPU 305 @ 38.1 were
`Wait`, now `Chunk/128`, matching the owner rule. Without the floor they fail (the writer's sabotage:
6 FAILs). The new `test_admission_warn_floor` (`:359-393`) pins 37.8/39.9 short-Admit, 5000-Chunk-128,
and 40.0 Wait for 2/5000/GPU — red under a `<=` boundary or a reverted floor.
`run_hot_prefill_pause` moved 38.1 → 40.0 (`tests/test-governor-v0-turns.cpp:334`), matching the new
boundary; `run_warm_prefill_admits` (`:232-283`) is the end-to-end S23 shape. `grep -rn "decision ==
llama_governor_decision::Wait" tests/*.cpp` finds no stale 37.x/38.x Wait expectation.

## Log line — CONFIRMED prefix kept; PLAUSIBLE-minor instrument risk

    llama-governor-runtime.cpp:73   LLAMA_LOG_WARN("%s: no safe prefill chunk under the thermal ceiling; pausing "
    llama-governor-runtime.cpp:74                  "(now_c=%.1f state=%s)\n",

The old text through `pausing` is intact; the suffix adds `now_c` and the state. `grep -rn pausing`
over the lab/app/binding scripts finds no parser of the line (only docs quote it verbatim, e.g.
`s23-single-apk/RECON-ADMISSION.md:12`, and should be refreshed to the new tail — which is exactly
the missing datum that RECON had to reconstruct from the battery heatmap). `thermal_state_name`
(`:12-26`) is file-local in an anonymous namespace, one consumer, no new API; the engine had no other
state-name helper, so no duplication.

## Clean code / process — CONFIRMED

4 files (policy, runtime, two tests), no new file; the policy comment (`:211-215`) states WHY and the
trap (unmeasured `40051f8ae` defaults — the commit exists, `git show -s 40051f8ae`; `k_limit=39.5`,
`1.9` ⇒ `>37.6` verified); no secrets; commit message carries Repo/Branch/Base HEAD; worktree clean;
`git branch -r --contains 497ca1cc` empty (no push).

## Binding `2ba2bbc9` — CONFIRMED

sha256(engine `497ca1cc`:file) == `vendor/llama.cpp/<file>` for both
`src/llama-governor-policy.cpp` and `src/llama-governor-runtime.cpp`; `vendor/VERSIONS:9
LLAMA_CPP_COMMIT=497ca1ccacae82f7383a70135b1d1b3f181a0c0b`; `src/version.ts:1 BUILD_NUMBER = '11222'`,
`:2 BUILD_COMMIT = '497ca1c'`; 10 files = the two vendored files plus version/identity stamps (tests
are not in the export). The declared lib-declaration drift is pre-existing and outside this commit.

## Runs (rebuilt, `-j 3` max)

| command | EXIT |
|---|---|
| `cmake --build build --target test-governor-v02-router test-governor-v0-turns test-governor-v0-hybrid -j 3 > /tmp/x-build.log 2>&1` | **0** (relinked router+turns; hybrid already current at 13:14) |
| `./build/bin/test-governor-v02-router > /tmp/x-router.log 2>&1` | **0** (`router_v02_golden=PASS`, `router_v02_metrics=PASS`; new test strings present) |
| `KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-turns -m <2.6B> > /tmp/x-turns.log 2>&1` | **0** (`governor_warm_prefill_admits=PASS`, `governor_hot_prefill_pause=PASS`, `governor_v0_turns=PASS turns=3`) |
| `KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-hybrid > /tmp/x-hyb.log 2>&1` | **0**, not 77 (`governor_hybrid_rewind p=12 trim_ok=1 max_abs_diff=0.000e+00`) |

## Delivery — PLAUSIBLE (process)

`git branch -r --contains 497ca1cc` and `… --contains 2ba2bbc9` are both empty; the app pin is still
`native/kalsallama.pin = 8eac584bb…` (the parent), so this floor is not in any shipped artifact yet.

## What I could not verify

- No device run: the 37.7–38.4 °C incident path is host-reproduced only; the deltas' "unmeasured"
  status is the comment's/RECON's claim.
- The writer's sabotage exit codes; only the three targeted binaries above were run.
- Whether any *un-committed* lab script parses the warn line with an end anchor (none found in the
  trees available here).
