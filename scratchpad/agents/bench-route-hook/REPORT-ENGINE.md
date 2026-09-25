# REPORT — engine + binding half of `/bench route cpu|gpu|auto`

Read first (as briefed): `../bench-route-hook/RECON.md`,
`../governor-archive-mining/SYNTHESIS.md` §4, and the app half
`kalsa-wt-bench-apk/src/engine/benchRoute.ts` @ 48103c9e — its interface was not changed:
`setPrefillOverride(mode): Promise<void>` on the context (all `setThermoProfile` hops,
`throwIfContextBusy` included) and the completion result `route_chunks` array, one entry per
executed prefill chunk, reset per completion like `governor_pause`. One thread, no sub-agents.

Heads: engine `d7019ea86` (= pushed `kalsa-phone-v1-1-5`) → **`e7e34a7e4`**; binding `9e661f17`
(= pushed) → **`5b2f2bab` + `84839996`**. Recon line numbers re-verified against current HEAD
(rounds 1-4b had moved the runtime; recon was pinned at `1b70069cb`).

## Engine (`kalsallama`, branch `kalsa-opencl-upload-oom-throw`, commit `e7e34a7e4`)

- **One encoding for the whole feature**: `enum class llama_governor_prefill_mode {Auto=0, CPU=1,
  GPU=2}` (`src/llama-ext.h:313-318`) — the setter's int argument and the
  `route_chunk::{requested,actual}` fields share it (no parallel magic numbers).
- **API**: `LLAMA_API bool llama_governor_set_prefill_override(governor, mode)`
  (`src/llama-ext.h:455-459`, next to `set_thermo_profile`); `llama_governor_route_chunk`
  (`:320-328`) + `stats.route_chunks[64]` / `route_chunk_count` (`:385-386`; overflow keeps the
  first entries and stops — declared).
- **Consult after safety**: `prefill_engine()` (`src/llama-governor-policy.cpp:164-195`) keeps the
  Invalid/CRITICAL/LOWBAT/invalid-profile gate first; only then the override (`:171-182`);
  force-GPU keeps the `gpu_fit == Fit` gate (same gate `bench_force_gpu_prefill` uses, which the
  override precedes — a runtime push supersedes the init-time knob); `auto` falls through to the
  untouched plan. Admission (≥40 °C Wait, floor, n_batch cap) is never consulted-into: it runs on
  whatever `prefill_engine()` returns, exactly as before.
- **Hop**: governor method `set_prefill_override` (`runtime.cpp:239-247`, mirrors
  `set_thermo_profile`: `policy_enabled_` guard + `refresh_policy_stats()` so
  `stats.prefill_engine` updates immediately) → C wrapper (`:330-332`); policy setter validates
  0..2 (`policy.cpp:326-334`). Threading-contract comment extended with the new method
  (`llama-governor.h:15-17`).
- **Facts**: recorded in `decode_impl` right after a successful prefill `llama_decode`
  (`src/llama-governor.cpp:300-319`): `index` (count-based, per completion), `requested` (the
  active mode), `actual` (from `cpu_prefill` — the context that actually executed, so the
  policy-disabled path stays honest too), `tokens`, `prefill_ms`, and `forced = mode != Auto &&
  actual == demanded(mode)` (`:315`) — a safety/fit veto therefore records `forced:false` with the
  true `actual`, per spec (LOWBAT+`gpu` → actual cpu, forced false).
- **Reset**: `reset_prefill_stats` clears `route_chunk_count` (`runtime.cpp:219`); the binding
  calls it in `beginCompletion` (`rn-completion.cpp:807`), i.e. per completion, same as
  `governor_pause`'s reset (`rn-completion.cpp:104`).

## Engine tests — `tests/test-governor-bench-route.cpp` (350 lines, new; CMake `tests/CMakeLists.txt:375-377`)

Model-backed, one responsibility (the override surface), scenarios run aggregate so one run
reports every red case. Six required cases, all PASS:

| scenario | evidence |
|---|---|
| force CPU @35 °C (plan would pick GPU) | `chunks=cpu:128+128+49`, decode ctx @304, all `requested=actual=cpu, forced` |
| force GPU @35 °C (plan would pick CPU: `generation=Unknown` + Fit) | `chunks=128+128+49`, prefill ctx @304, `engine=GPU`, `forced` |
| force GPU @40 °C | `rc=-2`, `route_chunk_count=0`, both KVs untouched, not failed |
| force GPU + LOWBAT (20 %) | `engine=CPU`, decode ctx, `requested=gpu, actual=cpu, forced=false` |
| `auto` vs never-set baseline (same params/profile/prompt) | identical engine, partition, positions, and every route fact except ms |
| facts reset per completion | count 3 → (no reset) 6 → `reset_prefill_stats` 0 → 3 with `index=0` |

**Sabotage (each case demonstrated red, all runs `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`):**

| sabotage | EXIT | red |
|---|---|---|
| remove the override consult | 1 | force-CPU (ran GPU) **and** force-GPU (ran CPU) |
| override before safety + setter maps `0`→GPU | 1 | LOWBAT (ran `engine=1` GPU) **and** `auto` (`engine=1/0`) |
| override short-circuits admission + reset drops the count | 1 | 40 °C (`rc=0 count=1`) **and** reset (`cleared=6`) |
| restored | 0 | 6/6 PASS |

Final runs from commit `e7e34a7e4`: router **0**, turns **0**, bench-route **0** (6 PASS),
hybrid **0** with `KALSA_HYBRID_GGUF` set (never 77). Engine commit message carries
Repo/Branch/Base HEAD (`d7019ea867ab9d506479341cc57ebd58d3d6a7c7`), tree clean.

## Binding (`llama.rn-kalsa`, branch `kalsarn-governor-engine`)

Two commits on top of `9e661f17` (as briefed):

1. **`5b2f2bab` build(engine): sync bench route override engine** — 14 files: `vendor/VERSIONS`
   → `e7e34a7e4…`, the six changed vendored engine sources (whole `include/src` export picks them
   up automatically) + three generated stamps + `src/version.ts` (`11229`/`e7e34a7`) + the three
   generated lib version files. **`cmp` = 0** on all six changed files:
   `llama-ext.h`, `llama-governor.h`, `llama-governor.cpp`, `llama-governor-policy.h`,
   `llama-governor-policy.cpp`, `llama-governor-runtime.cpp` (SHA-256 policy
   `75f87d061ac1b9b197908b90bfb7232ca626d57b9d551387d7d18a619070e00b`, runtime
   `cf380482c3e37bd447766990078ea6322f3b64210d75e4a8353e231b7b649ee2`, ext
   `d0feac3bae445f5323f8ecd94b92abe38f22312880c1ef74ee1e0c9b550effb0`).
2. **`84839996` feat(governor): surface the /bench route override** — 21 files:
   - hops: `cpp/rn-governor.{h,cpp}`, `cpp/rn-llama.{h,cpp}`,
     `cpp/jsi/RNLlamaJSI.cpp:856-884` (`llamaSetPrefillOverride`, mode string validated
     `cpu|gpu|auto` → 1/2/0, `getContextOrThrow` → **`throwIfContextBusy`** → `hasGovernor()` →
     promise `bool`, exactly like `llamaSetGovernorThermo`);
   - result: `cpp/jsi/JSICompletion.h:226-241` — `route_chunks` emitted iff `hasGovernor()`
     (honest empty array when no chunk ran), six keys, mode names via `prefillModeName`;
   - TS: `src/index.ts:728-734` (`Promise<void>` wrapper per the interface) + `jsiBindingKeys`
     entry, `src/jsi.ts` global, `src/types.ts:589-598` (`route_chunks` beside `pause_reason`);
   - `jest/mock.js` gains `llamaSetPrefillOverride` (that mock's own comment documents the
     contract: every `jsiBindingKeys` name must be installed or the suite fails);
   - **jest guard** `src/__tests__/governorPrefillOverrideSurface.test.ts` (159 lines, 6 tests):
     token-for-token slices of the whole chain (wrapper, JSI hop incl. `throwIfContextBusy`,
     both C++ hops, the emission's six fields, the vendored engine's safety-before-override order
     + C API + facts/reset markers), and the TS shape pinned against the **generated**
     `lib/typescript/{index,types}.d.ts` so a stale `npx bob build` fails.

**Runs (exit codes):** `npm ci` 0 → sync #1 **1** (expected, want `11229/e7e34a7`) →
`npx bob build` **1** (my own guard's TS2532 at first write — fixed; its cleanup had left
`lib/` half-built, hence the follow-up sync error) → `npx bob build` **0** → sync #2 **0** →
`git diff --check` 0 → eslint (new test) 0 after two lint fixes (banned `for…of` → array
iterations, `unicorn/better-regex`) → `npx jest <guard>` **0** (6/6) → `npx jest --runInBand`
**0** (16 suites, 63 tests) → commits (hooks lint/types/commitlint ✔) → post-commit sync **0**.

## Declared, not verified

- `route_chunks` stops recording at 64 entries (array cap); the app's `route_chunks_dropped`
  counts malformed entries, not truncation — bench prompts stay far below 64 chunks.
- `forced` means "an active override whose demanded engine ran this chunk"; LOWBAT + `cpu`
  therefore records `forced:true` (the safety verdict coincides with the request) — the app's
  mismatch logic compares `actual` to the applied mode and is unaffected.
- `lib/typescript/index.d.ts(.map)` now ships the new method together with the pre-existing
  optional-form drift (declaration and map must move as a pair; first declaration-drift commit);
  `NativeRNLlama.d.ts.map` drift reverted again; the new test's `lib/typescript/__tests__/*.d.ts`
  left untracked like the other newer test declarations.
- The JSI hop is source-pinned by jest, not executed (no native build); no device run, no
  binding native build, no re-audit, no push.

---

# Fix round 1 — luna re-audit of the bench-route hook (engine `543bc8479`, binding `2d03f9eb` + `6b3778ab`)

Read `AUDIT-ENGINE-LUNA.md` in full first (Deepseek SHIP, Luna NO). One thread, no sub-agents.
Heads: engine `e7e34a7e4` → **`543bc8479`** (see the amend note below); binding `84839996` →
**`2d03f9eb`** (sync) + **`6b3778ab`** (surface).

## 1. BLOCKER — override storage race-free by construction

- `prefill_override_` is now atomic behind a **copyable handle** `atomic_prefill_mode`
  (`src/llama-governor-policy.h:9-21`): `std::atomic<llama_governor_prefill_mode>` inside a
  struct with value copy-ctor/assignment (load→store). Why the wrapper: a bare atomic deleted
  `llama_governor_policy`'s copy-assignment and broke the router tests that reassign whole
  policies (first build: EXIT=1, `object of type 'llama_governor_policy' cannot be assigned`);
  the wrapper keeps both properties.
- **Read once per admission, carried to the chunks**: `prefill_engine(mode_used*, override_decided*)`
  (`policy.cpp:165-175`) does ONE `.value.load()` per call and reports it; the runtime admission
  takes it at entry (`runtime.cpp:73-76`), the planner reuses the same `requested` instead of
  re-reading (`runtime.cpp:116-118`), and the **route latch snapshots mode + decision**
  (`runtime.cpp:95-99`, members `turn_prefill_mode_`/`turn_override_decided_`
  `llama-governor.h:103-108`). The record site stamps facts from that snapshot
  (`llama-governor.cpp:310-320`), so **one completion can never mix modes** even if a push lands
  mid-turn.
- **Still unsynchronised, and why that is safe** (stated plainly, per brief):
  - binding `is_predicting` (`rn-completion.h:83`) and `throwIfContextBusy` stay a plain bool —
    kept as-is per instruction; it is the same best-effort pattern as `setThermoProfile`, and the
    app awaits the push before dispatching a completion;
  - `profile_`/`state_` in the policy stay plain — protected by the engine threading contract
    (decode vs `set_thermo_profile` must not overlap);
  - worst remaining outcome of a racing/late push (e.g. the app's uncancellable timeout): the
    NEXT turn's latch picks up the new value — exactly the intended semantics; an in-flight
    completion's facts and its route are already snapshotted, so no tear and no mix is possible.

## 2. `forced` is causal now

- Computed **where the decision is made**: `prefill_engine` reports `override_decided` — false
  when the safety verdict returned first (LOWBAT/Invalid/CRITICAL/invalid profile) and, for
  GPU, only true when the `gpu_fit == Fit` gate passed (`policy.cpp:176-196`). The record site
  stamps `chunk.forced = turn_override_decided_` (`llama-governor.cpp:317-320`) — no more
  comparing `actual` to the mode afterwards.
- Public comment rewritten (`src/llama-ext.h:326-329`): names safety preemption and the Fit
  gate, and states `LOWBAT+cpu` and `NotFit+gpu` are false.

## 3. Truncation is observable

- `stats.route_chunks_truncated` (`llama-ext.h:387-391`) set when an executed chunk overflows
  the 64-entry array (`llama-governor.cpp:321-322`), cleared with the count in
  `reset_prefill_stats` (`runtime.cpp:226`).
- Emitted next to `route_chunks` in the completion result (`cpp/jsi/JSICompletion.h:238`) and
  typed in `src/types.ts:599-601` + regenerated `lib/typescript/types.d.ts`. App untouched (it
  will read the flag later, per brief).

## 4. JSI failure rejects above JSI

- `cpp/jsi/RNLlamaJSI.cpp:875-879`: a failing `setPrefillOverride` now **throws**, and
  `createPromiseTask`'s catch turns that into a promise rejection (`JSIUtils.cpp` task try/catch
  → reject) — the app's `route_push: "failed"` mapping fires instead of a silent resolved
  `false` reading as `applied`.

## 5. Tests — split by topic (routing vs evidence), all ≤350

- `tests/governor-bench-route-harness.h` (109) — shared model/governor/prompt harness (one TU
  per binary keeps the anonymous namespace warning-free).
- `tests/test-governor-bench-route.cpp` (284) — routing: force CPU, force GPU, 40 °C Wait,
  **NotFit+gpu → `requested=gpu, actual=cpu, forced=false` (new)**, LOWBAT+gpu,
  **LOWBAT+cpu → `requested=actual=cpu, forced=false` (new)**, auto==baseline.
- `tests/test-governor-bench-route-evidence.cpp` (114) — evidence: reset-per-completion (now
  also asserts the flag clears) and **the truncation flag: 65 prefills in one completion →
  `count==64, truncated==1, index 63` then reset clears both (new)**.
- CMake: second model test entry (`tests/CMakeLists.txt`).

**Sabotage (`-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`):**

| sabotage | EXIT | red |
|---|---|---|
| `forced = mode != Auto` (the "override active" reading) | routing **1** | `NotFit`, `LOWBAT`, `cpu LOWBAT` |
| same + truncation flag never set | evidence **1** | `truncation stored=64 truncated=0` |
| earlier: old equality formula `actual == mode` | routing **1** | `cpu LOWBAT` (its false-positive) |
| restored | 0 / 0 | routing 7/7, evidence 2/2 |

Final runs from commit `543bc8479`: router **0**, turns **0**, bench-route **0** (7 PASS),
bench-route-evidence **0** (2 PASS), hybrid **0** with `KALSA_HYBRID_GGUF` (never 77).

## Commits and sync

- Engine `e7e34a7e4` → **`543bc84796bb4dcdb140463b4455a08b0f0bb9e0`** "fix(governor): make bench
  route override atomic, forced causal, truncation visible", branch
  `kalsa-opencl-upload-oom-throw`, 10 files +378/−161 (test split included).
  **Declared: one amend.** First landing `79d3ad3e3` ended `policy.cpp` with a trailing blank
  line; the binding's `git diff --check` caught it in the vendored copy (EXIT=2) *before* the
  binding pin was committed, so the local unpushed commit was amended (same message, same Base
  HEAD `e7e34a7e4…`) and everything re-synced against `543bc8479`.
- Binding: `npm ci` 0 → sync #1 **1** (expected; at `79d3ad3` then re-pinned, final want
  `11230/543bc84`) → `npx bob build` 0 → sync #2 **0** → `git diff --check` **2 → 0** (engine
  EOF fix) → guard jest **6/6** after three iterations (emission end marker moved to the
  truncated line; `prefill_engine` block re-pinned to the new signature/one-load/causal shape;
  `stripComments` now strips trailing `//` too — safe: the pinned blocks contain none in
  strings) → eslint 0 → full jest **63/63** → commits (hooks lint/types/commitlint ✔) → final
  sync **0**.
  - **`2d03f9eb`** (sync, 14 files): `vendor/VERSIONS` → `543bc8479…`, six changed vendored
    engine sources + three generated stamps + version identity. **`cmp` = 0** on all six changed
    vendored files (governor.cpp SHA-256 `49e0e5ba22d8c85700237299c10f5bd341e277179b1dc259e014d8085eae4cbb`,
    ext.h `2b77db0e322b72d3e0d404d47e4ababda7434793ce9fae16bad6007084770c76`).
  - **`6b3778ab`** (surface, 6 files): JSI reject-on-false, `route_chunks_truncated` emission,
    `src/types.ts`, regenerated `lib/typescript/types.d.ts(.map)`, guard update.

## Declared, not verified

- The app is unchanged: `route_chunks_truncated` is emitted and typed but unread until the app
  side adopts it (brief's instruction).
- `route_chunks.requested` reports the turn's snapshotted mode (the pushed value), not the
  internal `requested` engine label — the app's `route_mismatch` compares `actual` to the
  applied mode and is unaffected.
- The guard's `stripComments` is now permissive (any `//…` to end of line); safe for the pinned
  blocks, would need revisiting if a pinned block gains a `//` inside a string.
- No device run; no native binding build (JSI hop source-pinned only); no re-audit; no push.

---

# Fix round 2 — the blocker: the setter now touches only the atomic mode (engine `34c1ce533`, binding `f1fc5ef7`)

Read `AUDIT-ENGINE-LUNA.md` in full first (the CONFIRMED BLOCKER in the re-audit section). One
thread, no sub-agents. Heads: engine `543bc8479` → **`34c1ce533`**; binding `6b3778ab` →
**`f1fc5ef7`** (sync only — no binding source changed, the guard needed no edit).

## 1. The data race is removed at the source

- `llama_governor::set_prefill_override` (`src/llama-governor-runtime.cpp:249-257`) no longer
  calls `refresh_policy_stats()`: the body is the `policy_enabled_` guard plus
  `policy_.set_prefill_override(mode)` — an atomic store into
  `atomic_prefill_mode::value` (`llama-governor-policy.cpp:352-359`), nothing else. A trap
  comment names why the refresh must not come back. No stat needed a new admission-time write:
  `decode_impl` already calls `refresh_policy_stats()` on the decode path
  (`llama-governor.cpp:251-253`) and `admit_prefill` stamps `stats_.prefill_engine` at the
  latch (`runtime.cpp:97`), so the pushed value becomes visible at the next prefill admission.
- `set_thermo_profile` keeps its no-overlap rule and its refresh.

## 2. The contract comment is now true

- `src/llama-governor.h:15-19`: `set_prefill_override()` is named as the one exception — it
  stores only the atomic mode, may overlap `decode()`, takes effect at the next admission;
  `decode()`, `set_thermo_profile()`, `record_telemetry()`, `note_expert_route()`, `stats()`
  keep "must not overlap". Method comment `:41-42` ("atomic store only") and the member
  snapshot comment `:105-109` updated to match.
- Public doc `src/llama-ext.h:457-461` now states the override is safe to call while another
  thread decodes (what binding consumers read).

## 3. The one-mode claim, narrowed to the latch

- Both "one completion never mixes modes" comments are gone:
  `runtime.cpp:95-101` and `llama-governor.cpp:300-306` now say one admission latch reports one
  mode/decision, and that a prefill → decode → prefill sequence inside one reset interval
  re-latches (after a decode or `clear_cache`) and can record two modes. Grep for
  `never mix|one completion` in engine `src/`: only the evidence test's unrelated
  per-completion facts phrasing remains.

## 4. Test — `tests/test-governor-bench-route-setter.cpp` (2 scenarios, ~150 lines)

Model-backed, next to the other bench-route tests (CMake `tests/CMakeLists.txt:383-386`):

| scenario | evidence |
|---|---|
| CPU push AFTER a GPU prefill (route latch held) | stats unchanged (`prefill_engine=GPU`, `last_router_rule` baseline) after the push; after `clear_cache`+`reset_prefill_stats` the next admission runs `cpu:128+128+49`, `requested=actual=cpu, forced` |
| GPU push BEFORE the first admission (latch Undecided — the binding's sequence) | `stats.prefill_engine` still CPU after the push; first admission runs `engine=GPU`, `requested=actual=gpu, forced` |

**Sabotage** (the old setter order restored: store then `refresh_policy_stats()`; build `-j 3`):
`cmd > /tmp/out.log 2>&1; echo "EXIT=$?"` → **EXIT=1**, two reds at once:
`cpu push moved stats engine=1 rule=9 (want engine=1 rule=3)` and
`gpu push moved stats engine=1 (want CPU)`. (A refresh-before-store variant was also tried:
EXIT=1 on the rule drift.) Restored: EXIT=0, 2/2 PASS.

## 5. Runs (all builds `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`)

router **0** (`router_v02_golden=PASS`, `router_v02_metrics=PASS`), turns **0**
(`governor_v0_turns=PASS turns=3`), bench-route **0** (7 PASS), bench-route-evidence **0**
(2 PASS), bench-route-setter **0** (2 PASS), hybrid **0** with
`KALSA_HYBRID_GGUF=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`
(`governor_v0_hybrid=PASS turns=2` — ran, never 77).

## 6. Sync

- Engine commit **`34c1ce5333ada7b43bec494838a7baecfff952b6`**, branch
  `kalsa-opencl-upload-oom-throw` (printed before the commit), 6 files +180/−19, base HEAD
  `543bc8479…` named in the message, tree clean.
- Binding `vendor/VERSIONS` REF+COMMIT → `34c1ce533…`; the sync cache clone fetched the
  local-only commit from the engine checkout by branch (`git fetch <engine-path>
  kalsa-opencl-upload-oom-throw` — a fetch by raw sha is refused, "couldn't find remote ref").
  sync #1 **1** (expected: `lib/commonjs/version.js disagrees … want 11231/34c1ce5`) →
  `npx bob build` **0** → sync #2 **0** → `git diff --check` **0** → **cmp = 0** on all four
  changed vendored sources (`llama-ext.h`, `llama-governor.h`, `llama-governor.cpp`,
  `llama-governor-runtime.cpp`) → guard jest **0** (6/6) → full jest **0** (16 suites,
  63 tests) → commit `f1fc5ef7` (hooks lint/types/commitlint ✔) → post-commit sync **0**, tree
  clean. The build-number identity moved 11230→11231, `543bc84`→`34c1ce5`.

## Declared, not verified

- `NativeRNLlama.d.ts.map` regenerated with a one-token mapping delta (its `.d.ts` unchanged);
  reverted per the round-1 precedent (declaration and map move as a pair). It will re-drift on
  the next `npx bob build`.
- `lib/typescript/__tests__/*.d.ts(.map)` outputs (including this guard's) left untracked, like
  earlier rounds.
- The two untracked pnpm files in the binding were left alone, per instruction.
- Concurrency itself is not executed anywhere: the overlap-safety is by construction (one
  atomic store vs plain members the setter no longer writes), pinned by the sabotage-able test
  and the contract comment; no TSAN/threaded host run, no device run, no binding native build,
  no re-audit, no push.

---

# Fix round 3 — the latch contract, stated and pinned (engine `5484efb9d`, binding `ce55eff6` + `6bc327d0`)

Read `AUDIT-ENGINE-LUNA.md` § "Re-audit 2" in full first (Deepseek SHIP, Luna NO). One thread,
no sub-agents. **Coordinator decision, applied verbatim: the behavior stays.** The engine is
chosen once per route latch — the first prefill admission after a decode, `clear_cache` or a
stats reset — because switching contexts halfway through one prompt would split its KV across
the two contexts; per-batch safety (Invalid/CRITICAL abort, ≥40 °C Wait, small-prompt floor,
n_batch cap) still runs on every admission.

## 1. Contract comments now say exactly that

- Public doc (`src/llama-ext.h:457-466`): names per-batch (abort, Wait, floor, cap) vs
  per-latch (engine inputs: the override, LOWBAT, gpu fit), and why a latched route runs the
  whole prompt. "Consulted at the next prefill admission" is gone — that wording was the
  blocker.
- Threading contract (`src/llama-governor.h:15-19`): the mode is "consumed at the next prefill
  latch"; setter comment `:40-42` and the turn-snapshot member comment `:104-109` match (re-arm
  = prefill entry from another phase, `clear_cache`, or stats reset).
- Runtime latch (`src/llama-governor-runtime.cpp:89-103`): "the engine is decided once per
  latch" — a LOWBAT update between two same-phase prefills keeps the latched engine;
  per-batch safety is `admit_prefill`'s job. The owner rule for non-CPU admissions keeping the
  GPU route is kept. Setter comment `:252-256` now says "consumed at the next prefill latch".
- Latch re-arm site (`src/llama-governor.cpp:246-249`), record site (`:300-306`, "route
  latch"), and the policy member (`src/llama-governor-policy.h:94-102`): `prefill_engine()`'s
  engine answer — override and LOWBAT's CPU verdict included — is consumed once per latch.

## 2. Pinned — `tests/test-governor-bench-route-latch.cpp` (168 lines, 3 scenarios, CMake `:389-392`)

GPU-latched governor (CPU-default plan + gpu override), then a profile change between two
same-phase 2-token prefills:

| scenario | evidence |
|---|---|
| LOWBAT mid-latch | second prefill still runs GPU (`prefill_pos=3`, decode ctx unused); after one decode token the next prefill latches CPU, runs on the decode ctx, fact `requested=gpu actual=cpu forced=false` — Luna's probe, pinned |
| CRITICAL (43 °C) mid-latch | second call aborts at once: `rc=-1`, sticky failed, position untouched |
| 40 °C mid-latch | second call Waits at once: `rc=-2`, not failed, `route_chunk_count==1` |

**Sabotage** (each `-j 3`, `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"`):

| sabotage | EXIT | red |
|---|---|---|
| latch re-arms on every admission (`last_phase != Prefill` guard dropped) | 1 | `lowbat rerouted mid-latch rc=0 prefill_pos=1 decode_ctx_used=1` |
| CRITICAL removed from `admit_prefill`'s abort gate | 1 | `critical did not abort rc=-2 failed=0 pos=1` |
| `below_warn = true` (floor admits at any temperature) | 1 | `40C did not wait rc=0 failed=0 count=2` |
| restored | 0 | 3/3 PASS |

## 3. Runs (all builds `-j 3`)

router **0**, turns **0**, bench-route **0** (7 PASS), bench-route-evidence **0** (2 PASS),
bench-route-setter **0** (2 PASS), bench-route-latch **0** (3 PASS), hybrid **0** with
`KALSA_HYBRID_GGUF=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`
(`governor_v0_hybrid=PASS turns=2` — ran, never 77).

## 4. Binding — Deepseek's `failed_` finding

- **Kept the read, made it atomic**: `cpp/rn-governor.h` — `std::atomic<bool> failed_{false}`
  with a why-comment. Why not drop the read: the engine's own guard is `policy_enabled_`
  (construction-fixed; it does not cover the failed state), and the failed state is exactly
  what must reject a late push — round 1 §4 made a false native result reject in JSI, so
  dropping the read would resolve a push on a dead governor as `applied`. `rn-governor.cpp` is
  **textually unchanged** (every use compiles against the atomic; the guard's pinned block is
  untouched); `clang++ -fsyntax-only` EXIT=0; full jest 63/63.
- Commit **`ce55eff6`** (1 file, `cpp/rn-governor.h`).

## 5. Sync

- Engine commit **`5484efb9dbc88cebb1be5d982640513ad87a233e`**, 7 files +215/−27, base HEAD
  `34c1ce533…` named in the message.
  **Declared: the worktree was in detached HEAD this round** (round 2 had it on the branch),
  so the commit was created detached and the existing branch was then fast-forwarded
  `34c1ce533 → 5484efb9d` and HEAD re-attached (`git branch -f` + `git checkout`) — pure
  fast-forward, no rewrite, no new branch; the commit message's branch claim is true after the
  re-attach.
- `vendor/VERSIONS` REF+COMMIT → `5484efb9d…` (cache fetched by branch from the engine
  checkout). sync #1 **1** (expected, `want 11232/5484efb`) → `npx bob build` **0** → sync #2
  **0** → `git diff --check` **0** → **cmp = 0 on all five changed vendored sources**
  (`llama-ext.h`, `llama-governor.h`, `llama-governor.cpp`, `llama-governor-runtime.cpp`,
  `llama-governor-policy.h`) → jest **63/63** → commit **`6bc327d0`** (hooks ✔) → post-commit
  sync **0**, tree clean. Identity 11231→11232, `34c1ce5`→`5484efb`.

## Declared, not verified

- `NativeRNLlama.d.ts.map` regeneration noise reverted again (same round-1 precedent); the
  untracked `lib/typescript/__tests__` declarations and the two pnpm files remain untouched.
- `throwIfContextBusy` is unchanged: the coordinator scoped this round's binding fix to
  `failed_`; the engine-side overlap is now race-free by construction, the busy check stays
  the binding's pre-existing best-effort pattern (audit's PLAUSIBLE note).
- No device run; no native binding build (rn-governor.cpp syntax-checked only, JSI hop still
  source-pinned); no re-audit; no push.

---

# Fix round 4 — one comment made literally true; the JSI release window declared shared (engine `60a5b9db5`, binding `f9aee4ec`)

Read `AUDIT-ENGINE-LUNA.md` § "Re-audit 3" in full first. One thread, no sub-agents. Heads:
engine `5484efb9d` → **`60a5b9db5`**; binding `6bc327d0` → **`f9aee4ec`** (sync only).

## 1. "Read only while Undecided" → read every admission, applied per latch

- `src/llama-governor-runtime.cpp:90-95`: the latch comment now reads "engine-changing inputs
  (the override, LOWBAT, gpu fit) are read on every admission but applied to the route only
  while it is Undecided" — matching the code: `prefill_engine()` runs at `:73-75` on every
  admission and its answer feeds `admit_prefill`; only the route selection is gated.
- The policy member comment had the same inaccuracy ("consumed … once per prefill latch"):
  `src/llama-governor-policy.h:95-99` now says "read every admission but changes the route
  only at the prefill latch". Comments only, no behavior change; the public doc in
  `llama-ext.h` was left alone (the re-audit quotes it as accurate).

## 2. The queued-task release window is the shared pre-existing pattern — declared, not fixed

The re-audit's PLAUSIBLE blocker: a queued `setPrefillOverride` task can start after release's
wait observed zero, obtain the raw context pointer, and race the `delete`. Established with
quotes that **every JSI context method shares the same window and the same protection; the new
setter lacks nothing its siblings have**:

- Tracking starts only when a worker starts a task — `cpp/jsi/JSIUtils.cpp:69-74`:
  `// Track tasks when the worker starts to avoid waiting on queued work.` /
  `bool shouldTrack = trackTask && !TaskManager::getInstance().isShuttingDown();` /
  `if (shouldTrack) { TaskManager::getInstance().startTask(contextId);` — a queued,
  not-yet-started task is invisible to the counter by design.
- Release waits only on that counter, then deletes — `cpp/jsi/RNLlamaJSI.cpp:1844-1855`:
  `TaskManager::getInstance().waitForContext(contextId, 0);` … `removeContext(contextId);`
  `delete ctx;` (its own task `trackTask=false`). `waitForContext`
  (`cpp/jsi/JSITaskManager.cpp:58-73`) polls `activeTasks[contextId] <= 0` with a 5 s
  timeout; the lookup mutex (`cpp/jsi/JSIContext.h:26-30`) pins nothing.
- The thermo setter — the pre-existing twin — is the identical shape
  (`cpp/jsi/RNLlamaJSI.cpp:840-851`): `createPromiseTask(runtime, callInvoker,
  [contextId, profile]() -> PromiseResultGenerator { auto ctx = getContextOrThrow(contextId);
  throwIfContextBusy(ctx); … }, contextId);` — `trackTask` defaults to `true`
  (`cpp/jsi/JSIUtils.h:16-21`), so both are tracked exactly alike. The override
  (`:868-883`) differs only in the mode validation and the throw-on-false.
- The same worker-side `getContextOrThrow` shape is everywhere: `llamaGetGovernorStats`
  (`:889/:895`), `llamaLoadSession` (`:919/:926`), `llamaSaveSession` (`:938/:946`),
  `llamaTokenize` (`:958/:972`), `llamaDetokenize` (`:983`). `llamaCompletion` resolves the
  context on the JS thread (`:1205`) and even re-checks the map at result emission
  (`:1357-1364`, "Context was released" fallback) — an acknowledgment of the same release
  race, not a reservation either.

Conclusion, per the coordinator's rule: **shared pre-existing pattern → not fixed here.** The
window is a property of the TaskManager's "count started tasks only" design plus release's
delete; closing it (queue-aware reservations, or map-erasure-before-wait ordering with a
shared_ptr) is a binding-wide change, out of scope for the bench-route hook. The new setter has
the same `trackTask=true` tracking as `setThermoProfile`; nothing setter-specific to align.

## 3. Runs and sync

- Engine: comment-only commit **`60a5b9db59eb9131294950ffdd0e2cc0c3b7c16f`** (2 files,
  +10/−9, base HEAD `5484efb9d…` named). Full suite, all builds `-j 3`: router **0**, turns
  **0**, bench-route **0** (7 PASS), bench-route-evidence **0** (2 PASS), bench-route-setter
  **0** (2 PASS), bench-route-latch **0** (3 PASS), hybrid **0** with `KALSA_HYBRID_GGUF`
  (`governor_v0_hybrid=PASS` — ran, never 77). No sabotage this round: no behavior changed.
- Binding: `vendor/VERSIONS` → `60a5b9db5…`; sync #1 **1** (expected, `want 11233/60a5b9d`)
  → `npx bob build` **0** → sync #2 **0** → `git diff --check` **0** → **cmp = 0** on both
  changed vendored sources (`llama-governor-runtime.cpp`, `llama-governor-policy.h`) → jest
  **63/63** → commit **`f9aee4ec`** (hooks ✔) → post-commit sync **0**, tree clean. Identity
  11232→11233, `5484efb`→`60a5b9d`. No `NativeRNLlama.d.ts.map` drift this round (nothing to
  revert).

## Declared, not verified

- The release-window analysis is source-reading plus line-quoted evidence, not an executed
  race; no threaded JSI harness exists and none was built.
- No device run; no native binding build; no re-audit; no push.
