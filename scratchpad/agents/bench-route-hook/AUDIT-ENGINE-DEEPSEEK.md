# AUDIT — `/bench route` engine half (`e7e34a7e4`) + binding (`9e661f17..84839996`)

**Verdict: SHIP.** The override is consulted after the safety verdict and before the plan; admission
is untouched; `auto` is the parent plan exactly; the route facts name the context that really ran.
Only minor/declared gaps below.

## Override semantics — CONFIRMED

    policy.cpp:165-170  if (!valid_schema || !profile_valid_ || !have_profile_ ||
                             CRITICAL || Invalid || LOWBAT) return CPU;        (safety verdict first)
    policy.cpp:175-181  if (override == CPU) return CPU;
                        if (override == GPU) return gpu_fit == Fit ? GPU : CPU;
    policy.cpp:182-197  bench_force_gpu_prefill / generation / cool-mode plan  (auto path, untouched)

Scratch model (no repo edits) over `mode ∈ {auto,cpu,gpu}` × `state ∈ {FAST,WARM,COOLMODE,LOWBAT,
Invalid,CRITICAL}` × `fit ∈ {Fit,NoFit}` × 9 temperatures × 8 n_batch × ~400 prompts:
**0 violations** of (a) Invalid/CRITICAL → abort, no execution; LOWBAT → CPU on every mode;
(b) mode=cpu → CPU, mode=gpu → Fit?GPU:CPU, for every valid non-LOWBAT state; (c) every executed
piece ≥ 2 and ≤ n_batch. Samples: `LOWBAT+gpu → CPU, forced=false`; `FAST+gpu → GPU, forced=true`;
`FAST+cpu → CPU, forced=true`; `NoFit+gpu → CPU, forced=false`; `40 °C+gpu → Wait`.

- **Admission unchanged by the override — CONFIRMED**: the model shows the decision (Wait vs run),
  the token counts and the partition identical across auto/cpu/gpu for every cell; only
  `rule`/`engine` differ. ≥40 °C → `Wait` on every mode (the override cannot buy a batch the policy
  refuses), and the Invalid/CRITICAL `Abort` still runs regardless of the override.
- **`auto` == `d7019ea86` — CONFIRMED**: the Auto path skips both override branches and reaches the
  identical plan statements; the model shows 0 engine differences vs the parent plan, and the test
  `run_auto_matches_baseline` compares engine, `prefill_chunks`, count, prefill-KV position and every
  fact except `prefill_ms` (`tests/test-governor-bench-route.cpp:259-271`).
- PLAUSIBLE (comment nit): `policy.cpp:173-174` says a failed Fit gate "falls through to the plan";
  the code returns CPU at `:180`. The outcome is identical (every plan GPU branch is Fit-guarded, so
  NoFit ⇒ CPU), but the comment describes a mechanism that does not run.

## Evidence fields — CONFIRMED

    llama-governor.cpp:259-261  cpu_prefill = is_prefill && prefill_route_ == CPU; target = cpu_prefill ? ctx_decode : …
    llama-governor.cpp:285      const int64_t t0 = is_prefill ? ggml_time_us() : 0;   (before llama_decode)
    llama-governor.cpp:303-316  if (count < 64) { chunk.index = count; chunk.requested = policy_.prefill_override();
                                chunk.actual = cpu_prefill ? CPU : GPU; chunk.tokens = batch.n_tokens;
                                chunk.prefill_ms = (now - t0)/1000;
                                chunk.forced = mode != Auto && chunk.actual == mode; ++count; }
    llama-ext.h:320-328         llama_governor_route_chunk { index, requested, actual, tokens, prefill_ms, forced }

- `actual` is read from `cpu_prefill`, i.e. the context `llama_decode` actually targeted, so a
  safety/fit veto records `actual=cpu` with `requested=gpu, forced=false` — the test pins exactly
  that (`bench-route.cpp:226-228`).
- `index` is the count-based per-completion index; `tokens`/`prefill_ms` are the executed chunk's
  size and decode time (`t0` immediately before the decode). Facts are recorded only for
  `is_prefill` (n_tokens > 1) and only after a successful decode.
- **Reset per completion — CONFIRMED**: `reset_prefill_stats` clears the count
  (`runtime.cpp:219`), the binding calls it at every completion start
  (`cpp/rn-completion.cpp:807 parent_ctx->resetGovernorPrefillStats()`); the test shows
  `clear_cache` alone does not reset (3 → 6) and the reset restarts at index 0 (`bench-route.cpp:310-311`).
- **64-chunk cap — PLAUSIBLE (declared)**: `llama-ext.h:385 route_chunks[64]` and the
  `count < 64` guard stop recording silently (`llama-governor.cpp:303-304`); the app's
  `route_chunks_dropped` counts malformed entries, not truncation (`benchRoute.ts:151-162`), so a
  >64-chunk completion would lose facts undetectably. Bench prompts stay far below 64 (128-token
  rows ⇒ 2048 new tokens = 16 chunks); a `truncated`/`claimed_count` field would close it.

## Binding hops and TS interface — CONFIRMED

- The hop mirrors `setThermoProfile` exactly: `getContextOrThrow` → `throwIfContextBusy` →
  `hasGovernor()` → the setter, with an added up-front string validation and the enum mapping
  (`RNLlamaJSI.cpp:856-883` beside `:831-854`; `cpu=1, gpu=2, auto=0` matches
  `llama-ext.h:313-318`). `rn_governor::set_prefill_override` guards `nullptr/failed_`
  (`rn-governor.cpp:88-91`), refreshes stats (`runtime.cpp:239-247`), and the C wrapper is
  `runtime.cpp:330-332`.
- The app's interface is `setPrefillOverride?(mode): Promise<void>`
  (`benchRoute.ts:11-13`, `:49-66`); the wrapper is `async setPrefillOverride(mode: 'cpu'|'gpu'|'auto'):
  Promise<void>` (`src/index.ts:730-734`), registered in `jsiBindingKeys` and the jest mock (that
  mock's contract requires every key installed). The emission carries the six fields with mode names
  (`JSICompletion.h:219-241`), emitted iff `hasGovernor()` (honest empty array otherwise); the app's
  `asRouteChunk` validates exactly those six and drops extras (`benchRoute.ts:97-138`).
- PLAUSIBLE (minor): the TS wrapper discards the JSI boolean, so a `false` resolve (e.g. a
  sticky-failed governor, `rn-governor.cpp:89`) reads as `route_push:"applied"` in the app's
  evidence. The shipped app interface is `Promise<void>`, so the binding matches it; the gap is in
  the evidence wording only. `throwIfContextBusy` remains structurally inert in governor mode
  (no `slot_manager`), so the "must not overlap" contract is app-sequencing-enforced — pre-existing.
- **Byte identity — CONFIRMED**: at `5b2f2bab` all six changed vendored files hash-equal the engine
  `e7e34a7e4` (no `DIFF` lines); `vendor/VERSIONS=e7e34a7e4…`; the hop commit `84839996` is the
  21-file surface above.

## Tests can go red — CONFIRMED by construction

`tests/test-governor-bench-route.cpp` (CMake `tests/CMakeLists.txt:375-377`, LABEL "model"):
`run_force_cpu_cool` (`:127-136` engine CPU + `cpu:` chunks + every fact `requested=actual=cpu,
forced`), `run_force_gpu_cool` (`:161-170` engine GPU + prefill context), `run_force_gpu_waits_at_40`
(`:198` rc=-2, count 0, both KVs untouched, not failed), `run_force_gpu_lowbat` (`:221-228` engine
CPU, `requested=gpu/actual=cpu/forced=false`), `run_auto_matches_baseline`, `run_facts_reset`. Under
the three sabotages the report lists, these assertions fail exactly as claimed (remove the consult →
the force scenarios see the plan's engine; override before safety → LOWBAT runs GPU and auto maps
wrong; short-circuit admission → 40 °C runs/count=1 and the reset fails). No test pins the
NoFit+GPU veto or the 64-cap (PLAUSIBLE-minor; the model covers the veto).
The binding guard is source-slice (declared; a no-native-build pin that cannot execute the hop), and
I ran it: `npx jest … governorPrefillOverrideSurface.test.ts` **EXIT=0** (6/6).

## Runs (pgrep clear before building; one build; `-j 3`)

| command | EXIT |
|---|---|
| `cmake --build build --target router turns hybrid bench-route -j 3` | **0** (no work; binaries current) |
| `test-governor-v02-router` | **0** |
| `test-governor-bench-route -m LFM2.5-2.6B` | **0** — 6/6: `force_cpu chunks=cpu:128+128+49`, `force_gpu chunks=128+128+49`, `gpu_waits_at_40 rc=-2`, `gpu_lowbat engine=CPU forced=0`, `auto_matches_baseline count=3`, `facts_reset first=3 accumulated=6 after=3` |
| `test-governor-v0-turns -m LFM2.5-2.6B` | **0** |
| `test-governor-v0-hybrid` (`KALSA_HYBRID_GGUF`) | **0** (not 77) |
| binding `npx jest …governorPrefillOverrideSurface.test.ts --runInBand` | **0** (6 tests) |

## Not verified / declared

No device run; the JSI hop is source-pinned, not executed natively; `lib/typescript` index-form drift
and untracked test declarations are declared; engine/binding branches remain unpushed.

# Re-audit — engine `543bc8479` (binding `2d03f9eb` + `6b3778ab`)

**Verdict: SHIP.** Atomic override, per-turn snapshot, causal `forced` and observable truncation
all check out against my scratch model; `auto` still equals `d7019ea86` and admission is untouched.

## Atomic override + per-turn snapshot — CONFIRMED

    policy.h:9-21        struct atomic_prefill_mode { std::atomic<...> value; copy ctor/assign load->store; }
    policy.cpp:165-172   const auto mode = prefill_override_.value.load();   (ONE load per call)
    policy.cpp:175-196   mode==CPU -> CPU, override_decided=true; mode==GPU -> Fit?GPU:CPU with decided=fit
    runtime.cpp:73-76    mode_used/override_decided taken at admission entry
    runtime.cpp:95-99    latch snapshots them with the route: turn_prefill_mode_/turn_override_decided_
    runtime.cpp:116-118  the planner reuses the entry's `requested` (no per-iteration re-read)
    llama-governor.cpp:310-320  facts stamped from the snapshot: requested=turn_prefill_mode_, forced=turn_override_decided_

One completion cannot mix modes (the model's two-batch turn with one mode yields facts all of that
mode and decision); a racing push affects the next turn's latch only. The policy stays copyable
(the wrapper's copy ops), fixing the router-test reassignment break.

## Causal `forced` — CONFIRMED (one wording nuance)

Truth table from the model (0 violations over mode × state × fit × 9 temps × 8 n_batch × ~400 prompts;
Invalid/CRITICAL modelled as abort): `CPU+valid → true`; `GPU+valid+Fit → true`; `GPU+Fit=NotFit →
false`; `CPU+LOWBAT → false`; `GPU+LOWBAT → false`; `Auto → false`. The two luna cases are pinned by
`tests/test-governor-bench-route.cpp:112-141` (`gpu_not_fit`) and `:178-206` (`cpu_lowbat`), both
`!chunk.forced`.
- Nuance (PLAUSIBLE, wording): `forced` means "the override branch decided the engine (not
  safety/fit preempted)", not "the engine would have differed without it" — a `cpu` push on a plan
  that would have picked CPU anyway (e.g. `gpu_fit=NotFit`, `generation=Unknown`) still reads
  `forced=true` in my model. The `llama-ext.h:326-329` comment matches the implemented definition
  ("true only when the prefill engine's decision came from the override"), so no code defect; the
  app's `route_mismatch` compares `actual` to the applied mode and is unaffected.

## `auto` == `d7019ea86` and admission unchanged — CONFIRMED

Model: 0 engine differences vs the parent plan for every state/fit/temp/prompt/n_batch; 0
decision/partition differences across auto/cpu/gpu; ≥40 °C Waits on every mode; Invalid/CRITICAL
still abort. The override branch is skipped entirely for Auto (`policy.cpp:175/178` false).

## Truncation observable — CONFIRMED

    llama-governor.cpp:321-322  else { stats_.route_chunks_truncated = true; }
    runtime.cpp:226             reset_prefill_stats clears the flag with the count
    JSICompletion.h:238         res["route_chunks_truncated"] = governor_stats.route_chunks_truncated;
    src/types.ts:597-601        route_chunks_truncated?: boolean

The evidence test runs 65 prefills in one completion → `count==64, truncated==1, index 63`, then the
reset clears both (`tests/test-governor-bench-route-evidence.cpp:50-82`; observed
`governor_bench_route_truncation=PASS count=64 truncated=1 cleared`). The app does not read the flag
yet (declared; the app's projection drops extras).

## JSI reject and hops — CONFIRMED

`RNLlamaJSI.cpp:874-879` now `throw std::runtime_error("setPrefillOverride failed")` instead of
resolving `false`; `createPromiseTask`'s worker try/catch turns that into `reject`
(`cpp/jsi/JSIUtils.cpp:81,120-138` — the outer `catch (const std::exception& e)` calls
`reject->call(rt, createJsiError(rt, msg))`), so the app's `route_push: "failed"` fires. The TS
wrapper and the app interface are unchanged (`Promise<void>`); `src/types.ts` and the regenerated
`lib/typescript/types.d.ts` carry `route_chunks_truncated`. Sync `2d03f9eb`: sha256-equal for all six
changed vendored files vs `543bc8479`, `VERSIONS=543bc84796bb4dcdb140463b4455a08b0f0bb9e0`;
`6b3778ab` = 6 files (JSI reject, emission, types, guard), version 11230/543bc84.

## Tests can go red — CONFIRMED by construction

`forced = mode != Auto` → `gpu_not_fit`, `gpu_lowbat` and `cpu_lowbat` fail (the report's routing
sabotage); the old `actual == mode` formula → `cpu_lowbat` false-positive fails; the truncation flag
never set → the evidence test fails (`stored=64 truncated=0`). Harness split into
`tests/governor-bench-route-harness.h` + two TUs keeps both files ≤350 lines; both CMake entries
carry the model fixture (`tests/CMakeLists.txt:375-381`).

## Runs (pgrep clear; one build; `-j 3`)

| command | EXIT |
|---|---|
| `cmake --build build --target router turns hybrid bench-route bench-route-evidence -j 3` | **0** (no work; binaries current) |
| `test-governor-v02-router` | **0** |
| `test-governor-bench-route -m LFM2.5-2.6B` | **0** — 7/7 (`force_cpu`, `force_gpu`, `gpu_waits_at_40`, `gpu_not_fit forced=0`, `gpu_lowbat forced=0`, `cpu_lowbat forced=0`, `auto_matches_baseline`) |
| `test-governor-bench-route-evidence -m LFM2.5-2.6B` | **0** — 2/2 (`facts_reset first=3 accumulated=6 after=3`, `truncation count=64 truncated=1 cleared`) |
| `test-governor-v0-turns -m LFM2.5-2.6B` | **0** |
| `test-governor-v0-hybrid` (`KALSA_HYBRID_GGUF`) | **0** (not 77) |
| binding `npx jest …governorPrefillOverrideSurface.test.ts --runInBand` | **0** (6 tests) |

## Not verified / declared

No device run; no native binding build (the JSI reject is source-pinned, its plumbing read in
`JSIUtils.cpp`); the app is unchanged and does not yet read `route_chunks_truncated`; the amend of
the first engine landing is declared (trailing blank line caught by the binding's
`git diff --check`); engine/binding branches remain unpushed.

# Re-audit 2 — engine `34c1ce533` (binding `f1fc5ef7`)

**Verdict: SHIP.** The setter now writes only the atomic mode; the stats lag is declared and no
live consumer regresses; the narrowed latch claim is true; the new test is red under the old refresh.

## The setter path — CONFIRMED (atomic store only)

    runtime.cpp:249-257  bool llama_governor::set_prefill_override(int mode) {
                             if (!policy_enabled_) return false;
                             // Atomic mode store only ... do not re-add the stats refresh ...
                             return policy_.set_prefill_override(mode);
                         }
    policy.cpp:352-359   validate 0..2 -> prefill_override_.value.store(...)   (atomic claim changed nothing else)
    llama-governor.h:98  bool policy_enabled_ = false;   (ctor-set, never reassigned; the ctor param ctor sets true)

Reads: `policy_enabled_` (immutable after construction), the `mode` argument; writes: the atomic
only. `refresh_policy_stats()` is gone from the setter — the function that wrote plain `stats_`
members (`runtime.cpp:51-62`) the decode thread writes too. No other stat/state is touched.

## Decode behaviour and the stats lag — CONFIRMED, one PLAUSIBLE-minor

    runtime.cpp:51-56    refresh: prefill_engine = policy_.prefill_engine() (Undecided) / CPU (CPU route) / untouched (GPU route)
    runtime.cpp:62       refresh: last_router_rule = policy_.prefill_rule()
    llama-governor.cpp:251-253  decode_impl refreshes at entry; runtime.cpp:97 stamps prefill_engine at the latch

- The only consumer changed is a stats read between the push and the next decode: it now sees the
  pre-push `prefill_engine` and rule. The app's only read is `emitGovernorTelemetry` after the round
  (`src/engine/LlamaService.ts:1850`), whose decodes refreshed at their entry and whose latch stamped
  `prefill_engine` → current. The binding's pause classifier reads the stats after its own decode, so
  its rule comes from that decode's admission — and removing the setter's refresh closes a window
  where a late push could have overwritten the rule between the admission and the classifier's read.
- PLAUSIBLE-minor (declared): a hypothetical stats read between push and decode sees the old value;
  `llama-ext.h:456-461` now says the value "is consulted at the next prefill admission", so the
  documented semantics match. No such consumer found in the app.

## Narrowed latch claim — CONFIRMED

`llama-governor.h:15-19` names `set_prefill_override()` as the one overlap-safe exception;
`runtime.cpp:95-101`, `llama-governor.cpp:300-306`, `llama-governor.h:105-109` say one admission
latch reports one mode/decision and a prefill → decode → prefill inside one reset interval
re-latches. Re-latch sites verified: `llama-governor.cpp:247-248` (a prefill after a non-prefill
phase), `runtime.cpp:211` (`clear_cache`) and `:224` (`reset_prefill_stats`). The test's
`clear_cache` + `reset_prefill_stats` sequence is exactly a re-latch. Accurate.

## New test — CONFIRMED red-capable

`tests/test-governor-bench-route-setter.cpp` (CMake `tests/CMakeLists.txt:383-386`, LABEL "model"):
- `run_push_after_prefill_is_lazy` (`:22-77`): after a GPU prefill, a CPU push must leave
  `prefill_engine == GPU` and `last_router_rule == baseline` (`:44-45`), then `clear_cache` +
  `reset_prefill_stats` and the next prefill must run `cpu:…` with `requested=actual=cpu, forced`.
  With the old refresh restored: `prefill_engine` stays GPU (GPU route) but the rule flips 3→9 →
  the `:45` check fails (the report's `engine=1 rule=9 want rule=3`).
- `run_push_before_first_admission_is_lazy` (`:84-119`): push GPU while Undecided, stats must still
  read CPU (`:93`), the first admission must run GPU with `requested=actual=gpu, forced` (`:102-108`).
  With the refresh: `prefill_engine` would read GPU at `:93` → fails (`engine=1 want CPU`).
- Observed: `governor_bench_route_setter_lazy_after_prefill=PASS engine=1->0 count=3`,
  `…_lazy_before_admission=PASS engine=1 count=3` (EXIT=0, 2/2).

## Binding `f1fc5ef7` — CONFIRMED (sync only)

sha256-equal for `llama-ext.h`, `llama-governor.h`, `llama-governor.cpp`,
`llama-governor-runtime.cpp` vs engine `34c1ce533`; `VERSIONS=34c1ce5333ada7b43bec494838a7baecfff952b6`;
`src/version.ts` 11231/34c1ce5; 12 files = the four vendored sources + version/identity (no binding
source change); the guard jest passes unchanged (EXIT=0, 6 tests).
- PLAUSIBLE-minor (residual, binding side): `rn_governor::set_prefill_override` reads
  `failed_` (`cpp/rn-governor.cpp:81 if (governor_ == nullptr || failed_)`) — a plain bool written
  by `decode` (`:46,:53`). Under the now-permitted overlap that read can race a decode-time write;
  harmless on the supported targets and the app sequences the push, but "atomic only" is the
  engine's property, not the binding wrapper's. Dropping or atomising that check would close it.

## Runs (pgrep clear; one build; `-j 3`)

| command | EXIT |
|---|---|
| `cmake --build build --target router turns hybrid bench-route bench-route-evidence bench-route-setter -j 3` | **0** (rebuilt) |
| `test-governor-v02-router` | **0** |
| `test-governor-bench-route-setter -m LFM2.5-2.6B` | **0** — 2/2 (`lazy_after_prefill engine=1->0`, `lazy_before_admission engine=1`) |
| `test-governor-bench-route -m LFM2.5-2.6B` | **0** — 7/7 |
| `test-governor-bench-route-evidence -m LFM2.5-2.6B` | **0** — 2/2 |
| `test-governor-v0-turns -m LFM2.5-2.6B` | **0** |
| `test-governor-v0-hybrid` (`KALSA_HYBRID_GGUF`) | **0** (not 77) |
| binding `npx jest …governorPrefillOverrideSurface.test.ts --runInBand` | **0** (6 tests) |

## Not verified / declared

Concurrency is not executed (overlap-safety by construction: one atomic store vs plain members the
setter no longer writes); no TSAN/threaded host run, no device run, no native binding build,
`NativeRNLlama.d.ts.map` drift reverted, untracked pnpm files untouched; engine/binding unpushed.

# Re-audit 3 — engine `5484efb9d` (binding `ce55eff6` + `6bc327d0`)

**Verdict: SHIP.** The engine diff is comments and tests only (no behaviour change), the stated
latch contract is true, the new test pins both halves and is red-capable, and the binding's
`failed_` is now a correct atomic.

## No behaviour change — CONFIRMED

`git diff -U0 34c1ce533 5484efb9d -- src/` filtered to added/removed non-comment lines returns
**NONE**: the five `src/` files changed only comment/blank lines (`llama-ext.h`, `llama-governor.h`,
`llama-governor.cpp`, `llama-governor-runtime.cpp`, `llama-governor-policy.h`); the rest of the
commit is `tests/CMakeLists.txt` + `tests/test-governor-bench-route-latch.cpp` (168 lines). The
binding sync `6bc327d0` copies the same five header/source files.

## The comments are true — CONFIRMED

- Per-latch engine: the route latch block runs only while `prefill_route_ == Undecided`
  (`runtime.cpp:89-103`) and the re-arm sites are a prefill entry from another phase
  (`llama-governor.cpp:246-249` `is_prefill && allow_chunking && last_phase != phase::Prefill`),
  `clear_cache` (`runtime.cpp:211`) and `reset_prefill_stats` (`runtime.cpp:224`) — exactly the
  "decode / clear_cache / stats reset" of the public note (`llama-ext.h:457-466`).
- "A latched route runs the whole prompt": later same-phase batches re-enter `admit_prefill` (so the
  per-batch safety runs) but the latch block is skipped and the engine stays; the admission's
  `engine`/`requested` on those calls cannot move the route. The test's second same-phase 2-token
  prefill under a new LOWBAT profile still lands on the prefill (GPU) context (`latch.cpp:44-52`).
- Per-batch safety: Invalid/CRITICAL abort (`runtime.cpp:81-83` policy gate), ≥40 °C Wait
  (`:84-89`), the small-prompt floor and the n_batch cap (`policy.cpp:215-234`) all run on every
  `admit_prefill` call because the old latched fast path was removed in `a20257476`; the comments
  (`runtime.cpp:89-100`, `llama-governor-policy.h:94-102`) say so and the test pins the abort and
  the Wait mid-latch.
- The "switching mid-prompt would split the prompt's KV across the two contexts" rationale matches
  the two-context design (`cpu_prefill` selects `ctx_decode`; the cpu-route handoff logic at
  `llama-governor.cpp:271-283`), and the test's position assertions confirm the KV lands on one side.
- Minor wording (PLAUSIBLE, harmless): the public note says "the first admission after a decode,
  clear_cache() or reset_prefill_stats()"; the first prefill of a fresh governor (no prior decode,
  `last_phase == None`) also arms the latch. The precise phrasing lives at
  `llama-governor.cpp:246-248`.

## The new test pins both halves and is red-capable — CONFIRMED

`tests/test-governor-bench-route-latch.cpp` (CMake `tests/CMakeLists.txt:387-389`, LABEL "model"):
- GPU-latched governor (CPU-default plan + `gpu` override), then a LOWBAT profile mid-phase: the
  same-phase second prefill must stay on the GPU context (`:46` `position_matches(prefill, 3)` and
  `!position_matches(decode, 3)`) — the per-latch half.
- Then one decode token, then a new prefill: the engine re-latches to CPU and the fact reads
  `requested=gpu, actual=cpu, forced=false` (`:65-68`) — the "next latch" half.
- CRITICAL (43 °C) mid-phase: the second call aborts immediately, rc=-1, sticky failed, position
  untouched (`:102`) — per-batch abort.
- 40 °C mid-phase: rc=-2, not failed, no new fact (`:132-133`) — per-batch Wait.
- Red under the report's sabotages by construction: dropping the `last_phase != Prefill` guard lets
  the LOWBAT second prefill reroute (`lowbat rerouted mid-latch`); removing CRITICAL from the abort
  gate makes the second call return -2; forcing `below_warn` true makes the 40 °C call run.
- Observed: `latch_lowbat=PASS kept_gpu=1 relatch=cpu`, `latch_critical=PASS rc=-1 failed=1`,
  `latch_40c=PASS rc=-2 count=1` (EXIT=0, 3/3).

## Binding `failed_` — CONFIRMED atomic and behaviour-preserving

    cpp/rn-governor.h:53-55  // Atomic: decode() writes it on the decode thread while the override
                             // setter (allowed to overlap decode) reads it from a pool worker.
                             std::atomic<bool> failed_{false};
    cpp/rn-governor.h:42     bool failed() const { return failed_; }          (implicit load, seq_cst)
    cpp/rn-governor.cpp:45-46,53  if (failed_ || ...) { failed_ = true; }     (implicit load/store)
    cpp/rn-governor.cpp:81,90     if (governor_ == nullptr || failed_) …      (the setter read, now safe)

The bool semantics are unchanged (a one-way sticky flag); `rn-governor.cpp` is textually untouched and
compiles against the atomic — I ran `clang++ -std=c++17 -fsyntax-only cpp/rn-governor.cpp` with the
binding include paths: **EXIT=0**. No by-value `rn_governor` copy exists (it is held by pointer), so
the atomic's non-copyability is not a problem. Keeping the read (rather than dropping it) preserves
the intended reject-on-a-dead-governor behaviour from round 1 §4.

## Sync `6bc327d0` — CONFIRMED

sha256-equal for all five changed vendored files vs engine `5484efb9d`;
`VERSIONS=5484efb9dbc88cebb1be5d982640513ad87a233e`; `src/version.ts` 11232/5484efb; 12 files =
the five vendored sources + version/identity.

## Runs (pgrep clear; one build; `-j 3`)

| command | EXIT |
|---|---|
| `cmake --build build --target router turns hybrid bench-route bench-route-evidence bench-route-setter bench-route-latch -j 3` | **0** (rebuilt) |
| `test-governor-v02-router` | **0** |
| `test-governor-bench-route-latch -m LFM2.5-2.6B` | **0** — 3/3 (`lowbat kept_gpu=1 relatch=cpu`, `critical rc=-1 failed=1`, `40c rc=-2 count=1`) |
| `test-governor-bench-route -m LFM2.5-2.6B` | **0** (7 PASS) |
| `test-governor-bench-route-evidence -m LFM2.5-2.6B` | **0** (2 PASS) |
| `test-governor-bench-route-setter -m LFM2.5-2.6B` | **0** (2 PASS) |
| `test-governor-v0-turns -m LFM2.5-2.6B` | **0** |
| `test-governor-v0-hybrid` (`KALSA_HYBRID_GGUF`) | **0** (not 77) |
| binding `npx jest …governorPrefillOverrideSurface.test.ts --runInBand` | **0** (6 tests) |
| `clang++ -fsyntax-only cpp/rn-governor.cpp` (binding include paths) | **0** |

## Not verified / declared

No device run; no native binding build (the JSI hop stays source-pinned; only `rn-governor.cpp` was
syntax-checked here); `throwIfContextBusy` remains the pre-existing best-effort busy check; the
detached-HEAD commit and re-attach of `5484efb9d` is declared (pure fast-forward); declaration-map
drift and untracked files declared; engine/binding branches remain unpushed.
