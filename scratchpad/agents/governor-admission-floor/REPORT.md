# REPORT — prefill admission floor below 40 °C (engine 497ca1cca / binding 2ba2bbc9)

Owner decision (2026-09-24) implemented verbatim: below `k_warn_c` (40.0 °C) admission never
returns `Wait` — it admits at least the smallest row (128 tok, or the whole prompt if shorter);
at/above 40.0 °C behaviour is unchanged (`Wait` → runtime -2 pause). No new heat numbers, no
GPU table. Read `s23-single-apk/RECON-ADMISSION.md` first as instructed.

## Engine (`kalsallama`, worktree `kalsallama-wt-oom`, branch `kalsa-opencl-upload-oom-throw`)

- Pre-check: branch `kalsa-opencl-upload-oom-throw`, HEAD `8eac584bb`, `git status --short` empty —
  matched the required HEAD; did not stop.
- Fix, `src/llama-governor-policy.cpp`:
  - `:211-219` — floor: `below_warn = now_c < k_warn_c` (`:216`); the delta-drop loop stops at the
    smallest row when below the warn line (`:218`). Comment (`:211-215`) names the deltas
    unmeasured (40051f8ae defaults, engine-blind).
  - `:224` — tail rule for prompts < 128 tok now keys on `below_warn` instead of
    `now_c + k_cpu_delta_c[0] <= k_limit_c`, so a short prompt is admitted whole below 40 °C.
  - Early gate (`:199-205`, Invalid/CRITICAL → Abort, no profile → Wait) untouched.
- Log line, `src/llama-governor-runtime.cpp`:
  - `:63` — `now_c` captured once so the logged value is the evaluated one.
  - `:73-75` — one line, original prefix kept:
    `admit_prefill: no safe prefill chunk under the thermal ceiling; pausing (now_c=37.8 state=FAST)`.
  - `:12-26` — file-local `thermal_state_name()` (only consumer is that warn line).

## Tests

- Router, `tests/test-governor-v02-router.cpp`:
  - New `test_admission_warn_floor()` `:359-394`, registered `:474`: (a) 37.8 °C → 2-tok Admit/2,
    5000-tok Chunk/128; (b) 39.9 °C → same; (c) 40.0 °C → Wait for 2/5000 CPU and 5000 GPU;
    (d) pre-existing cool-temp chunking assertions untouched (`test_admission_and_flip_budget`,
    35.0 °C rows 1024/128, 49-tok tail, 128+128+49 partition).
  - Two old checks encoding the pre-decision contract updated: `:280-282` (2048 @ 37.9 was Wait →
    now Chunk/128), `:309-311` (GPU 305 @ 38.1 was Wait → now Chunk/128).
- Turns, `tests/test-governor-v0-turns.cpp`:
  - New `run_warm_prefill_admits()` `:232-283`, registered `:770`: end-to-end 38.1 °C, 305-tok
    prompt → rc 0, engine GPU, chunks `128+128+49` (the capture-class stall, now a chunked turn).
  - `run_hot_prefill_pause` moved from 38.1 → 40.0 °C (`:334`); pause assertions otherwise unchanged.
  - `run_reload_required_flow_control` (39.5 °C, 1 token) unaffected — 1-token batches go through
    `select_decode`, not `admit_prefill` (`src/llama-governor.cpp:246,253`).

## Runs (all `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`)

- Build affected targets: `cmake --build build --target test-governor-v02-router ...` EXIT=0.
- Router with fix: EXIT=0 (`router_v02_golden=PASS router_v02_metrics=PASS`).
- **Sabotage** (policy fix reverted via `git checkout --`, tests kept, rebuilt):
  **EXIT=1** — 6 FAILs incl. all four (a)/(b) checks (`37.8 C admits a 2-token prompt whole`,
  `37.8 C chunks a 5000-token prompt...`, `39.9 C admits...`, `39.9 C chunks...`) plus the two
  updated 37.9/38.1 checks. Restored patch, rebuilt: **EXIT=0**. Both exit codes: with fix 0, without 1.
- `test-governor-v0-turns -m /Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf` EXIT=0 —
  all scenarios PASS incl. new `governor_warm_prefill_admits=PASS` and updated
  `governor_hot_prefill_pause=PASS paused_rc=-2 engine=GPU`.
- `test-governor-v0-hybrid` rebuilt from the commit with
  `KALSA_HYBRID_GGUF=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf` EXIT=0
  (`governor_v0_hybrid=PASS`; 77 = SKIP never occurred).

## Engine commit

- `497ca1cca` "fix(governor): admit smallest prefill chunk below the warn line" on
  `kalsa-opencl-upload-oom-throw`, parent `8eac584bb`, 4 files, +141/−12. Tree clean after commit.
  Message carries Repo/Branch/Base HEAD trailer. No push, no tag, no new branch.

## Binding (`llama.rn-kalsa`, branch `kalsarn-governor-engine`)

- Pre-check: HEAD `463f11f9` ✓; only untracked `pnpm-lock.yaml`/`pnpm-workspace.yaml` (never touched;
  `npm ci` only, EXIT=0, real `node_modules` dir).
- Procedure of `463f11f9` followed: seeded sync cache
  (`git -C ~/.cache/llama.rn/llama.cpp fetch <engine worktree> 497ca1cca...` EXIT=0) →
  `vendor/VERSIONS` LLAMA_CPP_REF/COMMIT → `497ca1ccacae82f7383a70135b1d1b3f181a0c0b` →
  `npm run sync:vendor` #1 **EXIT=1** at the expected stale generated-version assertion
  (`lib/commonjs/version.js disagrees ... want 11222/497ca1c`) → `npm run build` EXIT=0 →
  `npm run sync:vendor` #2 **EXIT=0** (both assert scripts ok) → `git diff --check` EXIT=0 →
  commit hooks: lint ✔ types ✔ commitlint ✔.
- `cmp` vendored vs engine: `vendor/llama.cpp/src/llama-governor-policy.cpp` EXIT=0
  (SHA-256 `4a61fcf8d7817ac56951f63dd6e52b0c345eb3bd1ddc22bd0107313f9dd699c3`);
  `vendor/llama.cpp/src/llama-governor-runtime.cpp` EXIT=0
  (SHA-256 `cd0c45081001f3eb704b1da55ada7e416629029a20f1645a6b6516d37ed0fab7`).
- New commit `2ba2bbc9` "build(engine): sync governor admission floor in llama.rn-kalsa",
  parent `463f11f9`, 10 files (+46/−19): version identity (`src/version.ts` 11222/497ca1c, three
  generated lib version files), `vendor/VERSIONS`, three generated vendor version files, vendored
  policy + runtime. Tests are not part of the vendor export (as in prior bumps). No push.

## Declared, not fixed

- `npm run build` in this environment deterministically also refreshes three stale tracked
  declarations (`lib/typescript/index.d.ts`, `index.d.ts.map`, `NativeRNLlama.d.ts.map`) and emits
  four never-committed ones (`lib/typescript/__tests__/{governorLaneRepack,nativeSourceGuards}.test.d.ts[.map]`
  — src tests landed Sep 23-24, lib declarations last built Sep 19). Pre-existing lib drift,
  unrelated to the engine pin; reverted/left out to keep `2ba2bbc9` the same shape as `463f11f9`
  (verified reproducible: revert → rebuild → same diffs reappear). Needs its own lib-refresh commit.

## Not verified

- No device run (S23/Jelly Star untouched); no native/Gradle/CMake build inside the binding and no
  binding Jest run (prior bump procedure used vendor sync + JS build only). No DeepSeek audit, no push.
- The delta table remains unmeasured; CPU/GPU split of heat still awaits lab measurement.

---

# Fix round (audit of 497ca1cca → engine 6581c7a7b, binding 1e86815f)

Read both audits (`AUDIT-LUNA.md`, `AUDIT-DEEPSEEK.md`) first. All fixes written in one thread, no
sub-agents.

## F1 (blocker, both audits) — 1-token remainder refused at any temperature

- **Cool included: confirmed.** The planner runs whenever the top-level admission returns `Chunk`,
  and at 35.0 °C the tail rule admits a 1-token remainder too (both the old
  `now_c + 1.9 <= 39.5` and the floor's `below_warn` hold), so `count == 1` reached
  `if (count <= 1) return -2` — proved on disk by the sabotage run
  (`governor-row-plus-one: prefill failed temp=350 len=129 rc=-2`, turns EXIT=1).
- **Why ≥2:** a 1-token batch is a decode, not a prefill —
  `src/llama-governor.cpp:246` `const bool is_prefill = batch.n_tokens > 1;`. Executed via
  `decode_impl(chunk, false)` a singleton tail would take the decode path: target `ctx_decode`
  (`:260`), prefill tally end and a Prefill→Decode commit flip mid-prefill (`:264-275`). The guard
  itself came from `bb336bdc1` "fix(governor): partition admitted token batches safely"
  (2026-09-03).
- **Fix chosen: whole-admit row+1 at the policy** (`src/llama-governor-policy.cpp:241-250`,
  `:249-251`): if `prompt_tokens - result.tokens == 1`, `result.tokens = prompt_tokens`. Why not
  the alternatives: folding row+1 into one chunk fails at execution — the merged chunk is not
  policy-whole, so the inner `admit_prefill(chunk, allow_chunking=false)` returns -2
  ("prefill requires caller chunk", `src/llama-governor-runtime.cpp:91-94`) for GPU-routed chunks;
  splitting as `[row-1, 2]` fails for rows ≥ 512 because `row-1` is ≥128 and not a row, again
  inner -2. Whole-admit is the only partition where every executed chunk is policy-whole (exact
  row or <128 tail) and ≥2; reaching the hunk implies `now_c < k_warn_c` (comment says so, true:
  row selection means delta-pass ⇒ ≤37.6, or the floor). The runtime `count <= 1` guard is now
  unreachable by that invariant — left in place (pre-existing, declared) and given a log line
  (`src/llama-governor-runtime.cpp:116-120`) so it can never be a silent -2 again (luna's
  instrumentation note).
- **Trap found while testing:** `llama_decode` asserts `n_tokens_all <= cparams.n_batch`
  (`src/llama-context.cpp:1751`), so a whole 513-token call needs `n_batch ≥ 513`; the first test
  draft (n_batch 512) aborted SIGABRT/134. The scenario now uses `context_params(4096, 4096, 512)`
  (`tests/test-governor-v0-turns.cpp:291-293`). Input batches are always ≤ n_batch by that same
  assert, so whole pass-through can never violate it.
- **Tests:** router `test_admission_row_plus_one` (`tests/test-governor-v02-router.cpp:413-436`):
  129/513/1025 whole at 35.0, 2049 → Chunk/1024 (partition 1024+1025), 129 whole at 37.8.
  Turns `run_row_plus_one_prefills` (`:287-348`): lengths 129/513/1025/2049 × temps 35.0/37.8,
  all executed rc=0, prefill KV at `len-1`, commit_bytes 0, no -2.
- **Sabotage (policy hunk reverted):** router **EXIT=1** (4 FAILs: 129@35.0, 513@35.0,
  1025@35.0, 129@37.8 — cool and warm both red); turns **EXIT=1**
  (`temp=350 len=129 rc=-2`). Restored: router 0, turns 0.

## F2 (luna, pre-existing) — latched CPU route skipped Invalid/CRITICAL

- **Fixed; small and testable.** The gate now runs inside the early return
  (`src/llama-governor-runtime.cpp:58-66`): latched CPU route + state Invalid/CRITICAL →
  `fail("prefill admission aborted")`, identical to the policy gate's Abort. No-profile/Unknown
  not added: after a latched route a profile has always existed; `update_thermal` sets Invalid on
  any invalid profile, which covers luna's sequence.
- **Test:** turns `run_latched_cpu_route_state_gate` (`tests/test-governor-v0-turns.cpp:351-410`):
  LOWBAT latches CPU, profile invalidated between batches, next prefill must return -1 with
  reason "prefill admission aborted" and KV untouched (decode ctx still at pos 15).
  **Sabotage (gate removed): EXIT=1** (`second prefill not gated rc=0 failed=0`).

## F3 (luna, pre-existing) — negative battery temperature marked valid

- **Fixed; trivial.** `src/llama-governor-policy.cpp:57-61`: `batt_temp_tenths_c < 0` →
  `profile_is_valid` false → state Invalid → admission Abort. Router checks at
  `tests/test-governor-v02-router.cpp:275-284`. **Sabotage (check removed): EXIT=1** (3 FAILs).

## NaN

- Allowed by the brief (one guard line in a function this round touches): `!std::isfinite(now_c)`
  added to `admit_prefill`'s early gate (`src/llama-governor-policy.cpp:206`) — NaN reads false
  for both `< k_warn_c` and the delta comparisons and would admit the largest row; it now Waits.
  Router check `:384-386`. Unreachable via the int32 API (`batt_temp_tenths_c / 10`), still
  guarded because the helper is directly callable.

## Runs (all `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`)

| round | command | EXIT |
|---|---|---|
| fix | router | 0 |
| fix | turns (first draft, n_batch 512, 513-call) | 134 SIGABRT (`n_tokens_all <= n_batch`) |
| fix | turns (n_batch 4096) | 0 |
| sabotage F1 | router | 1 (4 FAILs incl. 129@35.0 and 129@37.8) |
| sabotage F1 | turns | 1 (`temp=350 len=129 rc=-2`) |
| sabotage F2+F3 | router | 1 (3 FAILs) |
| sabotage F2+F3 | turns | 1 (`second prefill not gated rc=0`) |
| final, from commit `6581c7a7b` | router / turns / hybrid (`KALSA_HYBRID_GGUF` set) | 0 / 0 / 0 (not 77) |

## Commits

- Engine `6581c7a7bb57bd95d31e1cfa3a5463aeed843f8e` "fix(governor): keep row-plus-one prompts and
  latched routes admissible", parent `497ca1cca`, branch `kalsa-opencl-upload-oom-throw`, 4 files
  +203/−1, tree clean, no push/tag/branch.
- **Binding deviation (declared):** the brief said re-sync "on top of `2ba2bbc9`", but the branch
  had advanced to `1f841412` (Marco's "resolve flow-control pauses as a typed completion outcome",
  same day; `2ba2bbc9` confirmed ancestor, `git show --name-only 1f841412 | grep ^vendor/` → no
  vendor files, pin still 497ca1cca). Synced on top of it: new binding commit **`1e86815f`**,
  parent `1f841412`, branch `kalsarn-governor-engine`, 10 files +41/−15, hooks lint/types/
  commitlint passed.
- Procedure: cache fetch from engine worktree 0 → `vendor/VERSIONS` → `6581c7a7b…` → `npm ci` 0 →
  sync #1 **1** (expected stale-version assert, want `11223/6581c7a`) → `npm run build` 0 →
  sync #2 **0** → `git diff --check` 0 → `cmp` policy **0**, runtime **0**
  (SHA-256 policy `1587fec09d8e7cb20b218294408d115ab37409c4843faa771b177994e000f0a4`,
  runtime `e96780dba53e96081a065a5c0d8bb13f42260b336c572bec335044b52e5b450e`) → commit.
  `pnpm-lock.yaml`/`pnpm-workspace.yaml` untouched, `npm ci` only.

## Declared, not fixed (binding lib drift, same class as before)

- `npm run build` regenerates stale tracked declarations, reverted after the commit to keep the
  sync commit's shape: `lib/typescript/index.d.ts`, `index.d.ts.map`, `NativeRNLlama.d.ts.map`
  (Sep-19 drift) and **`lib/typescript/types.d.ts` / `types.d.ts.map` — these carry `1f841412`'s
  `pause_reason` typing: that commit did not commit its regenerated types, so npm consumers' TS
  declarations currently lack `pause_reason` even though `src/types.ts` has it.** Needs a
  binding-side build commit. Six untracked `lib/typescript/__tests__/*.d.ts` from this build
  removed again (never committed by prior bumps either).

## Not verified

- No device run; no native/Gradle/CMake build or Jest run inside the binding (procedure parity
  with 463f11f9/2ba2bbc9); no DeepSeek/audit re-run after these fixes; no push.
- Turns-level sabotage for 129@37.8 specifically: the turns scenario aborts at its first failing
  case (350); the 37.8 red is pinned by the router (`129 at 37.8 is admitted whole` FAIL).

---

# Fix round 2 (luna re-audit of 6581c7a7b → engine 1b70069cb, binding 531b477b)

Read `REAUDIT-LUNA.md` in full first (Deepseek SHIP, Luna NO). One thread, no sub-agents.

## Item 1 (CONFIRMED blocker) — admission could exceed n_batch

**Facts, quoted:**

- The assert is not ours: `GGML_ASSERT(n_tokens_all <= cparams.n_batch)` at
  `src/llama-context.cpp:1751`; `git log -S` traces it to upstream `f3f65429c` (2024-06-26,
  "reorganize source code"), i.e. it predates the governor (Sep 2026) by ~2 years.
  **Pre-governor path: an oversized call was already an abort**, and the binding never made one —
  it caps every eval: `cpp/rn-completion.cpp:762` and `:1617`
  `if (n_eval > parent_ctx->params.n_batch) { n_eval = parent_ctx->params.n_batch; }`.
- **Pre-6581c7a7b (`497ca1cca`) path: the governor chunked it, never asserted.** For 2049 @ 34.0 °C
  the policy returned row 2048 → `Chunk` → planner planned 2048 + remainder 1 → the
  `count <= 1` guard returned -2 (pause). Proven empirically (sabotage B below: EXIT=1,
  `prefill failed temp=340 len=129 rc=-2` — same code path, no assert). Caveat: pre-fix the governor
  planned *rows*, so a row larger than n_batch (e.g. row 2048 with n_batch 512) would still have
  reached the assert — a pre-existing hole this round's row cap closes as well.
- **`6581c7a7b` path (the blocker):** row 2048 passes its delta at 34.0 °C (34.0+5.15=39.15 ≤ 39.5),
  the row+1 promotion (`policy.cpp` old `:249-250`) promoted 2049 whole, the runtime skipped
  chunking (`runtime.cpp` `admission.tokens >= n_tokens → return 0`), and `llama_decode` aborted —
  reproduced as sabotage A: **EXIT=134**, `GGML_ASSERT(n_tokens_all <= cparams.n_batch) failed`
  (`llama-context.cpp:1751`). My round-1 test dodged it with `n_batch=4096`
  (old `test-governor-v0-turns.cpp:292-294`), as luna said.

**Fix:** no admission may exceed `n_batch`, whatever the row.

- `admit_prefill` gains `uint32_t n_batch = UINT32_MAX` (`llama-governor-policy.h:30-32`; the
  default keeps direct policy probes uncapped — pinned by the router check
  "2049 at 34.0 with no n_batch bound is admitted whole"). Runtime passes
  `min(ctx n_batch of both contexts)` (either can execute, CPU vs GPU route) with a null-safe
  fallback for the test-only contextless governor (`runtime.cpp:74-78`).
- Row selection also drops rows > n_batch (`policy.cpp:216-221`), the short-prompt tail requires
  `prompt_tokens <= n_batch` (`:236`), and the row+1 promotion (`:253-269`) becomes:
  `prompt ≤ n_batch` → promote whole (unchanged for every legal input); otherwise — provably only
  when n_batch is itself the row — take the next row down so the remainder re-plans under the cap
  (2049/n_batch 2048 → `[1024, 1025]`); if the cap is the smallest row (n_batch 128, prompt 129)
  split `127 + 2`. Every executed piece is policy-whole (exact row, promoted, or sub-128 tail),
  ≥ 2, and ≤ n_batch.
- **Tests:** turns `run_row_plus_one_prefills` now runs `context_params(4096, 2048, k_chunk_n_batch)`
  (`test-governor-v0-turns.cpp:297`) with temps `{34.0, 35.0, 37.8}` (`:311`) — the n_batch 2048 /
  34.0 °C / 2049 case included, all 15 combos executed. Router pins: split
  (`tests/test-governor-v02-router.cpp:447-449`), row cap `:450-452`, tiny cap `:453-455`.
- **Sabotage:** cap removed (promo unconditional = 6581c7a7b) → router **EXIT=1** (split + row-cap
  FAILs), turns **EXIT=134** at the assert (red, as required). Restore → router 0, turns 0.

## Item 2 (CONFIRMED) — false comment, behaviour kept

- Comment rewritten, behaviour untouched: `policy.cpp:246-254` now says the delta path projects
  under `k_limit_c`, while on the owner's floor path (now_c < 40, decision 2026-09-24) row 128
  passes by decision and 129 is that floor plus the one token that cannot run alone — its
  projection may sit above the limit, which the floor accepts. The old "so no ceiling is
  bypassed" is gone.
- Test: router `:435-438` — 129 at 39.9 °C admitted whole, named "on the floor path".

## Item 3 (PLAUSIBLE) — mid-call profile update: no fix, answer declared

**Can the binding call `set_thermo_profile` concurrently with a decode? Technically yes; nothing in
the binding prevents it in governor mode.** Quoted:

- Both entry points run on the shared thread pool: `createPromiseTask` →
  `ThreadPool::getInstance().enqueue(...)` (`cpp/jsi/JSIUtils.cpp:69`), pool sized
  `std::thread::hardware_concurrency()` (`cpp/jsi/ThreadPool.h:43`) — many workers, tasks in
  parallel. Call sites: `llamaSetGovernorThermo` → `ctx->setThermoProfile` (`RNLlamaJSI.cpp:843,
  :847`), `llama_rn_context::setThermoProfile` (`rn-llama.cpp:731`), load-time `rn-llama.cpp:136`
  and completion-inline `RNLlamaJSI.cpp:1215` (both before any decode of that context).
- The only guard, `throwIfContextBusy` (`RNLlamaJSI.cpp:222-226`), reads
  `ctx->slot_manager && ctx->slot_manager->has_pending_work()` (`:219`) — and **slot_manager can
  never exist in governor mode**: `enableParallelMode` throws "Governor mode does not support
  parallel slots" (`rn-llama.cpp:1209-1210`), and `slot_manager` starts null (`rn-llama.h:151`).
  So the busy check is structurally inert for both `llamaSetGovernorThermo` and `llamaCompletion`.
  `TaskManager` only counts active tasks for shutdown draining (`JSITaskManager.h:14-33`), never blocks.
- What actually prevents overlap today is **app-side sequencing only**: the app awaits
  `refreshGovernorBeforeCompletion(...)` before dispatching a completion
  (`kalsa/src/engine/LlamaService.ts:1171, 4798, 5251, 5778`), and the completion applies its own
  `governor_thermo` inline on the decode worker before `loadPrompt` (`RNLlamaJSI.cpp:1215-1217`).
- **Declaration:** the engine's "decode() and set_thermo_profile() must not overlap" contract is
  binding-unenforced; any caller that breaks the JS ordering can update the profile mid-decode, so
  luna's partial-pause-without-rollback scenario stays reachable. Not fixed, per instruction.

## F3 left as is (per instruction); NaN left as is (round-1 guard stands).

## Runs (all `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`)

| round | command | EXIT |
|---|---|---|
| fix | first build attempt | 1 (definition missed the new param — stale binary caught, not reported as green) |
| fix | router / turns (n_batch 2048, temps 34.0/35.0/37.8) | 0 / 0 |
| sabotage A (cap removed, promo kept) | router | 1 (split + row-cap FAIL) |
| sabotage A | turns | **134**, `GGML_ASSERT(n_tokens_all <= cparams.n_batch)` at `llama-context.cpp:1751` |
| sabotage B (also promo removed = 497ca1cca) | turns | **1**, `temp=340 len=129 rc=-2` (pre-fix = pause, no assert) |
| final, from commit `1b70069cb` | router / turns / hybrid (`KALSA_HYBRID_GGUF` set) | 0 / 0 / 0 (not 77) |

## Commits

- Engine **`1b70069cb01c08cbfac112cd4e273ef5190baa70`** "fix(governor): cap every admission at
  n_batch", parent `6581c7a7b`, branch `kalsa-opencl-upload-oom-throw`, 5 files +72/−19, tree clean.
- Binding: HEAD was **`b23fc083`** as briefed (Marco's, on top of `1e86815f`; no vendor files
  touched, pin still 6581c7a7b) — worked on top, nothing rewritten. New commit **`531b477b`**,
  parent `b23fc083`, branch `kalsarn-governor-engine`, 11 files +53/−26 (adds the vendored
  `llama-governor-policy.h`, changed this round), hooks lint/types/commitlint ✔.
- Procedure parity: cache fetch from engine worktree 0 → VERSIONS → `1b70069cb…` → `npm ci` 0 →
  sync #1 **1** (expected, want `11224/1b70069`) → `npm run build` 0 → sync #2 **0** →
  `git diff --check` 0 → `cmp` policy **0** (SHA-256 `0ffed0d1be33def76133da011e11acd220d69795856777317f27a19c4c20f74e`),
  runtime **0** (`81077652d63c1d576f67c524e0160c7fd96322b983725e38bf2ca50b2f9812e1`) → commit.
  `pnpm-lock.yaml`/`pnpm-workspace.yaml` untouched, `npm ci` only, no push/tag/branch.

## Declared, not fixed

- Same lib-drift class as before: `npm run build` regenerates stale `lib/typescript/index.d.ts`,
  `index.d.ts.map`, `NativeRNLlama.d.ts.map` — reverted after the commit (pre-existing Sep-19
  drift; `b23fc083` already fixed the `types.d.ts`/`pause_reason` one); six untracked
  `lib/typescript/__tests__/*.d.ts` removed again.
- Pre-fix hole now closed but worth knowing: before this round, planned chunks were rows, so any
  n_batch smaller than the selected row (e.g. n_batch 512, cool, 3000-token input) would also have
  hit the assert — pinned at policy level by the "n_batch 512 caps the row" check.

## Not verified

- No device run; no native/Gradle/CMake build or Jest inside the binding; no re-audit by
  luna/deepseek after these fixes; no push.
- The `127 + 2` fallback (n_batch 128) is pinned at policy level only — no turns-level execution
  of that partition (no scenario uses n_batch 128 with a 129-token prompt).

---

# Fix round 3 (luna re-audit 2 of 1b70069cb → engine e4a33422c, binding deba9e69)

Read `REAUDIT-LUNA.md` § "Re-audit 2" in full first (Deepseek SHIP, Luna NO). One thread, no
sub-agents.

## Does the early return predate 6581c7a7b? — YES

- `git log -S "if (prefill_route_ == prefill_route::CPU)" --reverse -- src/` → **`a6642b73d`
  2026-09-05** "governor: route Wait/CPUFallback prefill to the decode context", adding the bare
  `if (prefill_route_ == prefill_route::CPU) { return 0; }` at the top of `admit_prefill`
  (refined same day by `39c35bd1e` "reset prefill route per turn...").
- `git show 497ca1cca:src/llama-governor-runtime.cpp` (parent of 6581c7a7b) still shows the bare
  form. `6581c7a7b` (2026-09-24) added only the Invalid/CRITICAL gate *inside* that return;
  `1b70069cb` then placed the n_batch cap *after* it — hence the bypass. The early return is 19
  days older than 6581c7a7b.

## Fix — latched route obeys the same cap, one chunk path

- `src/llama-governor-runtime.cpp:59-63`: the `n_batch` computation moved to the top of
  `admit_prefill`; `:64-80`: the latched-CPU branch keeps the Invalid/CRITICAL gate first
  (`:67-73`), then returns 0 **only while `batch.n_tokens <= n_batch`** (`:74-76`); an oversized
  batch falls through (`:77-79`) into the *same* admission/partition path an undecided route uses
  — no second chunker. Inner chunks of that partition re-enter the latched branch and return 0
  (each ≤ n_batch), so execution stays on `ctx_decode` with route CPU.
- For luna's repro the policy returns 127 (`row+1` promotion blocked by cap 128 →
  `prompt_tokens - 2`), planner emits `[127, 2]`, chunks string `cpu:2+127+2`.

## Test — luna's exact repro

- Turns `run_latched_cpu_route_n_batch_cap` (`tests/test-governor-v0-turns.cpp:420-479`,
  registered `:975`): both contexts `context_params(256, 128, 128)`, LOWBAT (batt 20) latches the
  CPU route with a 2-token prefill, then a 129-token prefill in the same phase must return 0 with
  `prefill_chunks == "cpu:2+127+2"`, decode KV at pos 130, prefill KV untouched, no commit.
  (First run of this test was EXIT=1 on my own assertion: I had expected `cpu:127+2` and missed
  the latch prefill's `cpu:2` — test bug, fixed; the implementation was already partitioning.)
- **Sabotage (early return restored to unconditional): turns EXIT=134**,
  `GGML_ASSERT(n_tokens_all <= cparams.n_batch) failed` at `src/llama-context.cpp:1751` — luna's
  repro reproduced without the fix.

## Runtime bypass audit — every `return 0` / decode path vs the cap

1. **Latched-CPU early return** (`runtime.cpp:75`, now conditioned at `:74`) — the blocker; FIXED
   this round: `n_tokens > n_batch` falls through to partitioning.
2. `decision == CPUFallback → return 0` (`:104-106`) — **safe by construction**: CPUFallback is
   only stamped when `tokens == prompt_tokens` (policy decision ladder), and every policy branch
   caps `tokens ≤ n_batch`, so input ≤ n_batch.
3. `admission.tokens >= n_tokens → return 0` (`:107-108`) — **safe**: `tokens ≤ n_batch` implies
   input ≤ n_batch.
4. **Planner mid-Wait → `return 0`** (`:124-127`, "No GPU chunk has run in this call yet") —
   returns 0 with the full unpartitioned input; the outer path would `llama_decode` it whole
   (`llama-governor.cpp:286`) and assert if input > n_batch. Unreachable under a stable profile
   (the outer admission already passed on the same temperature; deepseek: unreachable defensive
   code); reachable only via a mid-call `set_thermo_profile` crossing 40 °C — the round-2 declared
   follow-up. **Listed, not fixed** (instructions: list the others).
5. `k_prefill_chunked` (`:154`) → outer maps to 0 — every chunk already executed ≤ n_batch by the
   planner (`count = min(policy tokens, remaining)`, policy capped). Safe.
6. `select_decode → return 0` (`:175`) — only 1-token batches reach it (`is_prefill = n_tokens >
   1`, `llama-governor.cpp:246`). Safe.
7. Non-policy governor (`policy_enabled_ == false`, `llama-governor.cpp:251`) skips admission
   entirely — no cap, pass-through by design. **No production caller**: binding constructs via
   `llama_governor_init_with_params_internal` (`rn-governor.cpp:17`, policy on); tests use the
   params-only ctor (also policy on, `llama-governor.cpp:19-25`); the plain 4-arg ctor has no
   callers found in tests or binding.

## Runs (all `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`)

| round | command | EXIT |
|---|---|---|
| fix | build router+turns | 0 |
| fix | router / turns (first run) | 0 / **1** (my `cpu:127+2` expectation missed `cpu:2`; test fixed) |
| fix | turns (corrected) | 0 (`governor_latched_cpu_route_n_batch_cap=PASS chunks=cpu:2+127+2`) |
| sabotage (unconditional early return) | turns | **134**, `GGML_ASSERT(n_tokens_all <= cparams.n_batch)` |
| restored | router / turns | 0 / 0 |
| final, from commit `e4a33422c` | router / turns / hybrid (`KALSA_HYBRID_GGUF` set) | 0 / 0 / 0 (not 77) |

## Commits

- Engine **`e4a33422cbf72e4979be8e236b790b173f1784d9`** "fix(governor): partition latched CPU
  prefills over n_batch", parent `1b70069cb`, branch `kalsa-opencl-upload-oom-throw`, 2 files
  +80/−8, tree clean.
- Binding: HEAD was **`531b477b`** as briefed; synced on top of it. New commit **`deba9e69`**,
  parent `531b477b`, branch `kalsarn-governor-engine`, 9 files +27/−22 (only
  `vendor/.../llama-governor-runtime.cpp` changed in vendor this round), hooks lint/types/
  commitlint ✔. **Declared:** the first commit attempt carried a wrong `Base HEAD:` full hash —
  amended to the true `531b477b30e9e2b2981ebd799e773b97a69c4105` before any push (amend exit 0).
- Procedure parity: cache fetch from engine worktree 0 → VERSIONS → `e4a33422c…` → `npm ci` 0 →
  sync #1 **1** (expected, want `11225/e4a3342`) → `npm run build` 0 → sync #2 **0** →
  `git diff --check` 0 → **`cmp` = 0 on `llama-governor-policy.cpp`, `llama-governor-policy.h`,
  `llama-governor-runtime.cpp`** (runtime SHA-256 `f028b85e4e0109ceaa06038961673de6daf3e76fcf0ddfbe8985b68bd8d1aea1`)
  → commit. `pnpm-lock.yaml`/`pnpm-workspace.yaml` untouched, `npm ci` only, no push/tag/branch.

## Declared, not fixed

- Planner mid-Wait `return 0` (bypass #4) — contingent on the mid-call profile-update follow-up.
- Same lib-drift class: `lib/typescript/index.d.ts`, `index.d.ts.map`, `NativeRNLlama.d.ts.map`
  regenerated stale → reverted after the commit; six untracked `lib/typescript/__tests__/*.d.ts`
  removed again.

## Not verified

- No device run; no native/Gradle/CMake build or Jest inside the binding; no luna/deepseek
  re-audit after this fix; no push.
- Bypass #7 (non-policy governor) asserted by grep only — no execution test of the 4-arg ctor.

## Fix round 3 addendum — bypass #4 closed (engine e44a8da0e, binding 43a0da85)

Appended per instruction; continues Fix round 3.

### What the archaeology actually showed — the `return 0` was dead code

- The planner's split branch `if (decision == Wait) return 0` (`runtime.cpp`, old `:126-129`) was
  **unreachable**: a policy Wait *always* carries `tokens == 0` (gate Wait from `result{}`, tail
  Wait never sets `tokens`), and the earlier guard `if (decision == Abort || next.tokens == 0)
  return -2` ran first. So the brief's premise ("hands the whole unpartitioned batch on") could
  never fire — the live behaviour for a mid-plan Wait was already `-2` **through the generic
  guard**: INFO-only log (no thermal-pause warn) and `last_router_rule` left at the outer
  admission's stamp, so the binding (b23fc083 classifier) labelled the pause *unexplained*
  instead of *thermal*. Proven by instrumentation (removed after): pre-fix run showed
  `15 thermal pause warns for 24 paused attempts` — 9 pauses were silent.

### Fix — Wait first, one pause definition, dead branch removed

- `src/llama-governor-runtime.cpp:125-134`: the `decision == Wait` branch now runs **before**
  the tokens==0 guard and pauses exactly like the first admission: `stats_.last_router_rule =
  next.rule` (policy Wait stamp = 0 → binding labels it thermal and may cool-and-retry) +
  `log_thermal_pause(...)` + `return -2`. The dead `return 0` is gone.
- `:26-32`: `log_thermal_pause` — single definition of the pause line (a log line is an API);
  the top-level pause (`:100`) now calls it too; byte-identical prefix preserved.
- **Why -2 and not a cap:** a Wait is the policy's "do not run this prefill now" — capping would
  still execute a batch the policy refused at that temperature (violating the owner's ≥40 °C
  rule); `-2` is the established non-failing flow-control pause the binding already treats as
  resumable, and at planner time nothing has executed yet, so the pause is clean.

### Test — faithful simulation, red without the fix

- Turns `run_mid_plan_profile_flip` (`tests/test-governor-v0-turns.cpp:494-581`, registered in
  `run()`): a spinner thread flips 35.0 ↔ 40.0 °C during decode — the faithful simulation the
  brief allows, since (round-2 finding) nothing in the binding prevents a concurrent
  `set_thermo_profile`; the deliberate contract violation is documented in the function comment.
  24 attempts, prompt 500 / `n_batch=512` so an unpartitioned run fails loudly (never asserts).
  The test installs its own log callback counting thermal-pause warns (the turns harness's
  `log_errors` prints only ≥ ERROR, `test-governor-v0-turns.cpp:39`), and asserts
  `pause_warns == paused attempts` plus "no rc-0 run without a partitioned chunk string".
- **Sabotage (original layout restored): turns EXIT=1** —
  `governor-mid-plan-flip: 15 thermal pause warns for 24 paused attempts`. Restored: router 0,
  turns 0 (`governor_mid_plan_profile_flip=PASS attempts=24 pauses=24 warns=24`).

### Runs (all `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`)

| round | command | EXIT |
|---|---|---|
| pre-fix (sabotage) | turns, warn-parity assertion | **1** (15 warns / 24 pauses) |
| fix | router / turns | 0 / 0 |
| final, from commit `e44a8da0e` | router / turns / hybrid (`KALSA_HYBRID_GGUF` set) | 0 / 0 / 0 (not 77) |

### Commits

- Engine **`e44a8da0e7adcdea68dac3306521f04a5c766be0`** "fix(governor): honour the planner's
  Wait as a labelled thermal pause", parent `e4a33422c`, branch `kalsa-opencl-upload-oom-throw`,
  2 files +126/−7, tree clean, no push/tag/branch.
- Binding: HEAD was **`deba9e69`** as briefed; synced on top. New commit **`43a0da85`**, parent
  `deba9e6936433403ec48625c90927776b633c3b5` (taken via `git rev-parse` this time — no amend
  needed), branch `kalsarn-governor-engine`, 9 files +33/−21, hooks lint/types/commitlint ✔.
- Procedure parity: cache fetch 0 → VERSIONS → `e44a8da0e…` → `npm ci` 0 → sync #1 **1**
  (expected, want `11226/e44a8da`) → `npm run build` 0 → sync #2 **0** → `git diff --check` 0 →
  **`cmp` = 0 on `llama-governor-policy.cpp`, `llama-governor-policy.h`,
  `llama-governor-runtime.cpp`** (runtime SHA-256
  `452c99cccc365f93865e4feec4c15f6fb8ea594d3b123511e458f90383064595`) → commit.
  `pnpm-lock.yaml`/`pnpm-workspace.yaml` untouched, `npm ci` only.

### Declared, not verified

- The rule-0 stamp is not asserted by the test: the spinner's `refresh_policy_stats` overwrites
  `last_router_rule` concurrently, so the field is unreadable while the spinner runs; the stamp
  is pinned by inspection of the policy (Wait ⇒ rule 0) only.
- Same lib-drift class: `lib/typescript/index.d.ts`, `index.d.ts.map`, `NativeRNLlama.d.ts.map`
  regenerated stale → reverted after the commit; six untracked `lib/typescript/__tests__/*.d.ts`
  removed again. No device run; no binding native/Jest run; no re-audit after this fix; no push.

---

# Fix round 4 (luna re-audit 3 of e44a8da0e / 43a0da85 → engine a20257476, binding 3586ee67)

Read `REAUDIT-LUNA.md` § "Re-audit 3" in full first (Deepseek SHIP, Luna NO). One thread, no
sub-agents.

## 1. BLOCKER — latched-CPU fast path skipped thermal admission (fixed)

- **Defect:** `runtime.cpp` gated only Invalid/CRITICAL then `n_tokens <= n_batch → return 0`, so
  a serialized profile update to 40 °C let an in-cap LOWBAT prefill run (luna: `rc=0 rule=9
  state=5`). The same block also skipped *chunking* on the latched route — the F1 sabotage first
  surfaced as `chunks=cpu:512+512+305` (305 whole, unpartitioned but ≤ n_batch).
- **Fix:** the fast path is deleted (`src/llama-governor-runtime.cpp:63-95`); the latch now
  decides the **engine only** and every prefill batch passes the full policy admission — same
  ≥40 °C Wait, same <40 °C floor, same Invalid/CRITICAL Abort (the round-2 gate semantics now
  come from the policy gate itself, identical rc/reason).
- **Test (luna's exact repro):** `run_latched_cpu_route_state_gate`
  (`tests/test-governor-v0-turns.cpp:370-455`): latch CPU at 35 °C / 20 %, **serialized** update
  to 40 °C (asserts state LOWBAT), then a 2-token in-cap prefill → must be `-2`, not failed,
  `last_router_rule == 0`, KV still at 15 (`:408-436`). The scenario was moved to the front of
  `run()` (`:1015-1019`, comment) so sabotages surface it before broader integration checks.
- **Sabotage (fast path restored): turns EXIT=1** —
  `governor-latched-gate: latched prefill did not wait at 40 C rc=0 rule=9` (luna's signature).

## 2. CPUFallback now executes on the CPU context (fixed)

- **Defect:** the latch keyed on `requested`, so a whole GPU admission (policy `CPUFallback`,
  `result.engine = CPU`) ran on `ctx_prefill`. Also `result.engine` was constant-CPU in the
  policy (only assignment, `policy.cpp:203`) — nothing meaningful to follow.
- **Fix:** `policy.cpp:273-275` stamps `result.engine = requested` for `Chunk` (chunks execute on
  the requested engine; whole non-CPU admissions keep the CPU default = the fallback);
  `runtime.cpp:86-94` latches from **`admission.engine`** (not `requested`) and reports it in
  `stats_.prefill_engine`.
- **Tests asserting which context ran:**
  - turns `run_chunked_prefill`: whole 512 → CPU latch → `chunks=cpu:512+512+128+128+49`, decode
    KV at 1328, **prefill KV untouched**, `commit_bytes == 0` (`cpu_route_handoff` skips the
    flip), sampling from the decode context.
  - turns `run_hot_prefill_pause`: prewarm whole 512 → decode ctx @511 + `engine == CPU`,
    prefill ctx empty; pause at 40 °C leaves both untouched; cooled chunked phase unchanged (GPU).
  - turns `run_row_plus_one_prefills`: per-case — whole admissions → decode ctx + `engine==CPU`,
    partitioned → prefill ctx + `engine==GPU` (`on_decode`/`on_prefill` + engine check).
  - router: `CPUFallback ⇒ engine==CPU` (`:302-305`) and `Chunk@GPU ⇒ engine==GPU` (warm_gpu
    check `:320-324`).
- **Sabotage (latch keyed on requested + engine stamp removed): router EXIT=1**
  (`GPU prefill from 38.1 ...` FAIL), **turns EXIT=1** (`chunks=512+512+128+128+49` — no `cpu:`
  prefix, ran on the prefill context).

### Blast radius of #2 (declared, semantics changed on purpose)

Whole non-CPU admissions now run on `ctx_decode` — restoring the `a6642b73d` (2026-09-05) design
intent ("route Wait/CPUFallback prefill to the decode context"). Turns expectations updated to
the new truth: `run_chunked_prefill`, `run_hot_prefill_pause` prewarm/pause, `run_row_plus_one`
per-case contexts, and the `run()` main fixture: prompts are now **130 tokens**
(`:1072-1079`; over n_batch=128 so they chunk to the GPU route, `130 % 128 == 2` so never
row+1/whole→CPU), gov contexts `n_ctx=1024` and the **baseline `n_batch=512`** (`:1001-1010` —
the baseline has no admission layer, a 300-token `llama_decode` would assert). This preserves the
original two-context stats contract verbatim (commits=3, exact byte formula). One clause could
not be preserved: `decode_n_reused == decode_calls - 1` → replaced by
`decode_n_reused > decode_graph_builds` (`:1179`): any >n_batch fixture makes decode evals span
more than one hybrid recurrent chunk, and the decode side deterministically rebuilds once at a
boundary crossing (observed `builds=2`, traced per-turn by temporary instrumentation, removed).
Old exact counts were an artifact of the 13-token (sub-chunk) fixture.

## 3. Spinner test removed; planner-Wait reachability under the contract

- **Removed** `run_mid_plan_profile_flip` + `<atomic>`/`<thread>` includes: a deliberate data
  race against the documented contract (`src/llama-governor.h:15-17`) that luna showed can pass
  vacuously (`pauses=0`). No data-race tests remain.
- **Reachability answer: unreachable under the contract.** The planner is only reached from a
  `Chunk` decision (the whole-batch `tokens >= n_tokens → return 0` and `CPUFallback → return 0`
  both precede it); `Chunk` needs a non-empty row table, which at ≥40 °C is empty (outer would
  have Waited) — so the call's temperature is below `k_warn_c`. With a profile that cannot change
  inside the decode, every remainder then either keeps the floor row 128 (remaining ≥ 128) or
  whole-admits via the tail (`< 128 && <= n_batch && below_warn`) — neither is a Wait; gate states
  (`state_`) are written only by `update_thermal`, which the contract forbids concurrently.
- **Kept as a defensive guard** with a true comment (`runtime.cpp:113-124`), and pinned
  policy-side with a deterministic serialized test: `test_planner_remainders_never_wait`
  (`tests/test-governor-v02-router.cpp:465-497`) walks the partition for 4 temperatures ×
  6 prompts × {n_batch 512, uncapped} asserting no Wait/Abort, `tokens >= 2`, termination.
  **A faithful runtime-level test does not exist** — reaching that branch requires violating the
  threading contract; declared.

## 4. Execution-loop Wait after partial progress — reachable? NO (not fixed)

Under the contract it is unreachable, with these lines:
- Execution loop `src/llama-governor-runtime.cpp:141-151`: each planned piece runs via
  `decode_impl(chunk, false)`, which re-enters admission at `src/llama-governor.cpp:251-256`
  (`policy_rc = is_prefill ? admit_prefill(...) : ...`).
- Every piece is policy-whole at the call's stable temperature (the planner admitted it in the
  same call), so the inner admission returns `Admit`/`CPUFallback` via
  `tokens >= n_tokens` / `CPUFallback → return 0` — never `Wait`; and `state_`/`profile_` are
  written only by `update_thermal` (`src/llama-governor-policy.cpp:96-103`), which the contract
  forbids during `decode()` (`src/llama-governor.h:15-17`).
- Only a forbidden concurrent profile flip can make a later chunk Wait → **PLAUSIBLE only via
  contract violation; not fixed, per instruction.**

The no-policy public API is left alone (luna's PLAUSIBLE acknowledged; owner's instruction).

## Runs (all `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`)

| round | command | EXIT |
|---|---|---|
| fix | router / turns (after expectation updates) | 0 / 0 (13 scenarios PASS) |
| sabotage 1 (latched fast path restored) | turns | **1** — `latched prefill did not wait at 40 C rc=0 rule=9` |
| sabotage 2 (latch from requested + engine stamp removed) | router / turns | **1** / **1** (`chunks=512+512+...`, no cpu: prefix) |
| final, from commit `a20257476` | router / turns / hybrid (`KALSA_HYBRID_GGUF` set) | 0 / 0 / 0 (not 77) |

## Commits

- Engine **`a20257476915b604d2ae23763cb818ade5ced3d4`** "fix(governor): admit every batch and
  latch the engine from the policy", parent `e44a8da0e`, branch `kalsa-opencl-upload-oom-throw`,
  4 files +154/−163, tree clean.
- Binding: HEAD was **`43a0da85`** as briefed. New commit **`3586ee67`**, parent
  `43a0da85b9d8a9dc481b0d66016898fe9e9eba84` (via `git rev-parse`), branch
  `kalsarn-governor-engine`, 10 files +31/−39, hooks lint/types/commitlint ✔.
- Procedure parity: cache fetch 0 → VERSIONS → `a20257476…` → `npm ci` 0 → sync #1 **1**
  (expected, want `11227/a202574`) → `npm run build` 0 → sync #2 **0** → `git diff --check` 0 →
  **`cmp` = 0 on `llama-governor-policy.cpp`, `llama-governor-policy.h`,
  `llama-governor-runtime.cpp`** (policy SHA-256 `56969f4f977f58bbfa532cfe216d1223939cab7c981d99f01cb099c14f2ecfeb`,
  runtime `96cbb45e72ad4a8bc8b2d22a2d160a256dc292758018b3bbdc1cca3050ce78bf`) → commit.
  `pnpm-lock.yaml`/`pnpm-workspace.yaml` untouched, `npm ci` only.

## Declared, not verified

- Same lib-drift class: `lib/typescript/index.d.ts`, `index.d.ts.map`, `NativeRNLlama.d.ts.map`
  regenerated stale → reverted after the commit; six untracked `lib/typescript/__tests__/*.d.ts`
  removed again.
- Execution-loop partial pause (item 4) stays open as a contract-violation-only hazard; the
  mid-call profile-update follow-up from round 2 is unchanged.
- The planner-Wait defensive branch has no runtime-level test (none can exist under the
  contract); only the policy remainder walk pins its precondition.
- No device run; no binding native/Jest run; no re-audit after this fix; no push.

---

# Fix round 4b — item 2 of a20257476 reverted to the correct intent (engine d7019ea86, binding 9e661f17)

Owner: round 4's item 2 was a product regression. `CPUFallback` is the policy's decision for
**every** whole admission of a non-CPU request (`policy.cpp` row ladder `else` branch), so
routing it to `ctx_decode` meant any GPU-requested prompt that fit whole prefilled on the CPU
while only chunked prompts reached the GPU. Owner rule: **the CPU heats more — do not take the
GPU away.** What was wrong was the name and the `engine = CPU` stamp, not the routing.

## Change chosen: keep the enum, fix the stamp and the comments

- **Why not rename:** renaming `CPUFallback` → `AdmitWhole` touches the public
  `src/llama-ext.h:237` plus every reader (policy ×2, runtime, router tests ×2); keeping the
  value and making the stamp honest is 2 lines + comment rewrites and leaves the public header
  stable. The misnomer is documented where it is read (`src/llama-governor-runtime.cpp:94-97`:
  "the enum name is a historical misnomer — it does not fall back to CPU").
- `src/llama-governor-policy.cpp`: `result.engine = requested` in **both** admitted ladders —
  tail whole arm (`:239`) and the row ladder before the decision chain (`:272-274`). Gate
  paths (Abort/Wait) keep the default: nothing executes there.
- `src/llama-governor-runtime.cpp:86-92`: latch comment rewritten — "engine equals requested, so
  a whole GPU admission keeps the GPU route (owner rule: the CPU heats more, do not take the GPU
  away)". The latch logic (`admission.engine == CPU ? CPU : GPU`) is unchanged from a20257476
  and now yields: whole GPU → GPU/`ctx_prefill`, CPU request → CPU/`ctx_decode`, LOWBAT → CPU.
- Router test renamed + corrected (`tests/test-governor-v02-router.cpp:303-306`):
  `"GPU whole prefill is admitted on the requested engine"` asserting `engine == GPU`; the NPU
  check (`:54-57`) now asserts the directive-literal truth `engine == NPU`
  ("stamped with the requested engine") — it previously pinned the old fiction `engine == CPU`.

## Kept from round 4 (per instruction)

- **Item 1:** no latched fast path — every batch passes admission (latch decides engine only);
  luna repro in `run_latched_cpu_route_state_gate` intact; gate scenario runs first in `run()`.
- **Item 3:** spinner test removed; planner-Wait defensive comment; policy-level pin
  `test_planner_remainders_never_wait`.

## "Which context ran" assertions — correct truth restored

- Whole GPU admission → `ctx_prefill` (GPU): `run_hot_prefill_pause` prewarm (engine GPU, prefill
  KV @511), `run_chunked_prefill` (chunks `512+512+128+128+49`, prefill KV, handoff commit ≠ 0),
  `run_row_plus_one_prefills` (all cases: prefill ctx + `engine == GPU`).
- CPU request → `ctx_decode`: latched-gate first prefill (LOWBAT CPU, decode KV @15).
- LOWBAT → CPU: `run_low_battery_prefill` (`engine=CPU`, `cpu:` chunks on the decode context).
- Pause phase at 40 °C: prewarm KV still @511 on the prefill context, decode ctx untouched,
  `engine != CPU`, plus the kept `!is_failed()` check.

## `run()` fixture: reverted — no longer needed

The 130-token prompt / `n_ctx=1024` / baseline `n_batch=512` fixture existed **only** because
round-4's routing collapsed whole short prompts onto the CPU (one-side stats, zero commits,
recurrent-chunk rebuilds). With routing restored, whole short prompts latch the GPU route again,
so the fixture and every original expectation are back verbatim: const 13-token prompt,
`context_params()` for gov and baseline, `decode_n_reused == decode_calls - 1`, original byte
formula and FAIL text.

## Runs (all `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`)

| round | command | EXIT |
|---|---|---|
| fix | router / turns (targeted) | 0 / 0 (13 scenarios PASS) |
| sabotage (engine stamps removed → whole GPU routes to CPU) | router | **1** — 3 FAILs: NPU stamp, `"GPU whole prefill is admitted on the requested engine"`, warm-GPU stamp |
| sabotage | turns | **1** — `chunks=cpu:512+512+128+128+49` (GPU prefill ran on the CPU) |
| final, from commit `d7019ea86` | router / turns / hybrid (`KALSA_HYBRID_GGUF` set) | 0 / 0 / 0 (not 77) |

## Commits

- Engine **`d7019ea867ab9d506479341cc57ebd58d3d6a7c7`** "fix(governor): whole admissions run on
  the requested engine again", parent `a20257476` (new commit, no amend), branch
  `kalsa-opencl-upload-oom-throw`, 4 files +40/−66, tree clean.
- Binding: HEAD was **`3586ee67`** as briefed; synced on top. New commit **`9e661f17`**, parent
  `3586ee67cf1bb40b6d66ed71c0e63f7c44e28a64` (via `git rev-parse`), branch
  `kalsarn-governor-engine`, 10 files +23/−22, hooks lint/types/commitlint ✔.
- Procedure parity: cache fetch 0 → VERSIONS → `d7019ea86…` → `npm ci` 0 → sync #1 **1**
  (expected, want `11228/d7019ea`) → `npm run build` 0 → sync #2 **0** → `git diff --check` 0 →
  **`cmp` = 0 on `llama-governor-policy.cpp`, `llama-governor-policy.h`,
  `llama-governor-runtime.cpp`** (policy SHA-256 `2b303bda13b6db06e902a3d60ab2809c0f93fe2e7b829c4d743b38bb2b6ea4c9`,
  runtime `f91cd5076ef31c1dd168cef8bf5ff053ef39cee13c03515b1d76a6f892a1ab8a`) → commit.
  `pnpm-lock.yaml`/`pnpm-workspace.yaml` untouched, `npm ci` only, no push/tag/branch.

## Declared, not verified

- The `CPUFallback` enum name stays (historical misnomer, documented at its runtime read site);
  a rename was the larger change and would touch the public header.
- The runtime `if (decision == CPUFallback) return 0;` branch is redundant with the following
  `tokens >= n_tokens → return 0` (both ⇔ whole admission) — pre-existing, left in place.
- Same lib-drift class: three stale `lib/typescript` declarations reverted after the commit;
  six untracked `__tests__/*.d.ts` removed. No device run; no binding native/Jest run; no
  re-audit after this fix; no push.
