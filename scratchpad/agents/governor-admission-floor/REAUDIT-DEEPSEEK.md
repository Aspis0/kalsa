# RE-AUDIT — engine `6581c7a7b` (binding `1e86815f`)

**Verdict: SHIP.** The row+1 fix is arithmetically sound (the `count <= 1` guard is now
unreachable), the two gates are right, and nothing unintended was removed.

## F1 — row+1 whole-admit — CONFIRMED

    llama-governor-policy.cpp:14   constexpr uint32_t k_table_tokens[] = { 128, 512, 1024, 2048 };
    llama-governor-policy.cpp:15   constexpr float k_cpu_delta_c[] = { 1.9f, 3.25f, 3.25f, 5.15f };
    llama-governor-policy.cpp:249  if (prompt_tokens - result.tokens == 1) {
    llama-governor-policy.cpp:250      result.tokens = prompt_tokens;
    llama-governor-policy.h:14     uint32_t tokens = 0;

Invariant: at each runtime iteration the admission returns the largest row `R <= r` that passes
`now_c + delta <= 39.5` or the floor's `table == 1 && below_warn` (`policy.cpp:224-230`). The new
remainder is `r - R`: 0 (whole), 1 → whole-admitted by `:249-251` → 0, or `>= 2`. The `<128` tail
(`:231-239`) returns `r >= 2` whole. So the loop's `count` can never be 1; the guard
`runtime.cpp:116 if (count <= 1)` is unreachable by that invariant — the added
`LLAMA_LOG_INFO` (`:117-119`) is a trap, not a live path. Verified in a scratch model of the policy
partition (no repo edits): post-fix **0 unpartitionable** for every `n < 8200` at
{0, 20, 30, 34.3, 34.4, 35, 36.2, 36.25, 36.3, 37.6, 37.7, 39.9} °C; pre-fix (`497ca1cca`)
**46 unpartitionable at 35.0** (129, 257, 385, 513, … ≡ 1 mod 128), reproducing the red.

Boundaries (post-fix, from the scratch model):
- exact rows 128/512/1024/2048 → `Admit` whole (unchanged);
- row+1 129/513/1025/2049 → `Admit` whole at 35.0 and 37.8 (`[129]`, `[513]`, `[1025]`, and at
  35.0 `2049 → [1024, 1025]`, the second admission whole-admitting 1025 — exactly the router test);
- row+2 130/514/1026/2050 → `Chunk R` + a `2` tail (129+2 etc.), min chunk 2;
- row-1 511/1023/2047 → partitions ending in 127 (`[128,128,128,127]` at 39.9), min chunk 127;
- 39.9 °C: 513 → `[128,128,128,129]` (the floor's 128s plus the final whole 129); 5000 → 39×128+8.
- Ceiling: the hunk is reached only with `table >= 1`, i.e. the selected row passed its delta or the
  floor broke at `table == 1 && below_warn`; `now_c >= 40` empties the table (`now_c + 1.9 >= 41.9 >
  39.5`) and hits `Wait` (`:237-239`). The warn line is never crossed. The extra token can exceed the
  chosen row's own delta estimate by 1/row (≤0.8 % at 128) — the comment's "no ceiling is bypassed"
  is true for the warn line and slightly loose for the row-granular delta. PLAUSIBLE-minor (doc).
- `n_batch`: `:250` sets `tokens = prompt_tokens` = the current `remaining` <= the input batch <=
  `n_batch` (the report's SIGABRT trap at 513), so the whole pass-through cannot violate the assert.
- GPU route: the whole-admit keeps `decision = CPUFallback` for a non-CPU request (`:258`), and the
  runtime's `:89-91` returns 0 → the batch is decoded on the requested engine; LOWBAT (CPU) is
  unaffected. CONFIRMED.

## F2 — latched CPU route gate — CONFIRMED

    llama-governor-runtime.cpp:58   if (prefill_route_ == prefill_route::CPU) {    llama-governor-runtime.cpp:62       if (policy_.thermal_state() == Invalid || CRITICAL) {
    llama-governor-runtime.cpp:63           return fail("prefill admission aborted");

The route latches only after a successful admission (`:85-88`), which requires a valid profile, so
`Unknown`/no-profile cannot be the latched case; `update_thermal` turns any later invalid sample into
`Invalid` (`:98-101`), and the chunk recursion (`decode_impl(chunk, false)`) re-enters this
gate for every chunk, so a mid-turn invalidation is caught. Same `fail` reason as the policy gate
(`:74-76`). The turns test goes red without it (rc would be 0, not -1). CONFIRMED.

## F3 — negative battery temperature — CONFIRMED

    llama-governor-policy.cpp:59   if (profile.batt_temp_tenths_c < 0) { return false; }

`profile_is_valid` has exactly one caller (`policy.cpp:98 update_thermal`), so the check invalidates
the profile at the update path → state `Invalid` → admission `Abort` (`:206-212`). 0.0 °C stays valid
(`< 0`), but the app's Kotlin module already maps `temperature > 0` to `sensorValid` — edge note only,
no gap.

## NaN — CONFIRMED

    llama-governor-policy.cpp:206  if (!profile_valid_ || !have_profile_ || !std::isfinite(now_c) ||

NaN/±Inf now takes the early gate; with a valid state the ternary returns `Wait` (`:207-209`),
pinned by the router check. Unreachable through the int32 API (`current_temperature_c()` is finite),
harmless as a direct-call guard.

## Removed behaviour — CONFIRMED nothing unintended

`git diff --stat 497ca1cca 6581c7a7b` = `llama-governor-policy.cpp` 18, `llama-governor-runtime.cpp`
10, the two test files 135/41. The only semantic change for a row+1 prompt is `Chunk R` → `Admit`
(`tokens == prompt_tokens` at `:252-259`); exact rows, row+2, the <128 tail, the `table == 0` Wait
and the 40.0 boundary are byte-identical. `result.rule` is assigned after the hunk, so the
router-rule value is unchanged for a whole-admit.

## Tests — red-capable CONFIRMED

Router `test_admission_row_plus_one` (`tests/test-governor-v02-router.cpp:413-433`) asserts
`Admit/129/513/1025` at 35.0 and `Chunk/1024` for 2049; pre-fix the first three return
`Chunk/128` (the scratch model reproduces it), so they fail. The NaN and negative-temperature checks
fail without their guards (an unguarded NaN admits the largest row; `poll(-50)` stays valid → FAST →
no Invalid/Abort). Turns `run_row_plus_one_prefills` (129/513/1025/2049 × 35.0/37.8) and
`run_latched_cpu_route_state_gate` (LOWBAT latches CPU, profile invalidated, rc=-1 + reason + KV
untouched) are red by read without the fix. Sabotage was modeled in `/tmp/model_policy.py` only;
neither repo was modified.

## Runs (built/verified, `-j 3` max)

| command | EXIT |
|---|---|
| `cmake --build build --target test-governor-v02-router test-governor-v0-turns test-governor-v0-hybrid -j 3 > /tmp/x-build.log 2>&1` | **0** (no work to do; binaries current, new test strings present) |
| `./build/bin/test-governor-v02-router > /tmp/x-router.log 2>&1` | **0** (`router_v02_golden=PASS`, `router_v02_metrics=PASS`) |
| `KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-turns -m <2.6B> > /tmp/x-turns.log 2>&1` | **0** (`governor_row_plus_one_prefills=PASS`, `governor_latched_cpu_route_state_gate=PASS`, `governor_v0_turns=PASS`) |
| `KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-hybrid > /tmp/x-hyb.log 2>&1` | **0**, not 77 (`governor_hybrid_rewind p=12 trim_ok=1 max_abs_diff=0.000e+00`) |

## Binding `1e86815f` — CONFIRMED

sha256(engine `6581c7a7b`:file) == `git show 1e86815f:vendor/llama.cpp/<file>` for both
`llama-governor-policy.cpp` and `llama-governor-runtime.cpp`;
`vendor/VERSIONS LLAMA_CPP_COMMIT=6581c7a7bb57bd95d31e1cfa3a5463aeed843f8e`;
`src/version.ts` 11223/6581c7a. `git show --stat 1e86815f` = 10 files (the two vendored + version
identity). Declared deviation verified benign: parent `1f841412` touches no `vendor/` file and its
pin was `497ca1cc`; `2ba2bbc9` is an ancestor of `1e86815f`. The declared lib-declaration drift
(`pause_reason` absent from the emitted d.ts) is outside this commit.

## Delivery — PLAUSIBLE (process)

`git branch -r --contains 6581c7a7b` and `… --contains 1e86815f` are empty; the app pin is behind, so
none of this is in a shipped artifact yet.

## What I could not verify

- No device run; the writer's sabotage exit codes (mine are the scratch model plus code reads).
- The unreachability of `count <= 1` is verified by a model over n < 8200 and 11 temperatures, not a
  proof over all inputs; the loop's `next.decision == Wait` branch (`runtime.cpp:111-113`) remains
  unreachable defensive code below 40 °C.
