# Audit — decode_tokens_gpu telemetry (n2, hostile)

Audited pair:

1. `~/Projects/llama.rn-kalsa-onecopy`, branch `telemetry-gpu-leg`, commit `c3ef55d4` —
   `cpp/jsi/RNLlamaJSI.cpp` (+4), `src/types.ts` (+3), `lib/typescript/types.d.ts` (+3),
   `lib/typescript/types.d.ts.map` (regenerated).
2. `/tmp/app-gpu-leg.patch` against `~/Projects/kalsa-wt-gov` @ `dddc8e4b`, `src/engine/LlamaService.ts`
   (+3 net lines; forward-applies cleanly to the worktree, not yet applied there).

Line numbers prefixed **post-patch:** are the numbering after that patch is applied (all
LlamaService.ts lines after 1823 shift by +3). No test suite was run. The only build step run was
`npx tsc -p tsconfig.build.json --noEmit false --emitDeclarationOnly --declaration --declarationMap`
into `/tmp/types-check` (outside both repos), to test the hand-committed `lib/typescript` artifact.

---

## Findings

### F1 — P1 — CONFIRMED — with the pinned binding the field is a hard 0 on every turn, so the line forges evidence instead of reporting "not measured"

- Pin: `package.json:53  "llama.rn": "github:Aspis0/kalsa.rn#1eb78bfe41de2e5669be1f56d8e6363f6adaf5ec",`
  (`dddc8e4b`'s own message: "pin kalsa.rn 1eb78bfe (kalsallama 5cb7e14a0)").
- The installed JSI stops at the NPU counter —
  `node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:949  result.setProperty(rt, "decode_tokens_cpu", ...)`
  `node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:950  result.setProperty(rt, "decode_tokens_npu", ...)`
  — no `decode_tokens_gpu` line exists in the installed tree.
- The installed *engine* does count it (`node_modules/llama.rn/vendor/llama.cpp/src/llama-ext.h:502`
  and `.../llama-governor.cpp:545 stats_.decode_tokens_gpu += batch.n_tokens;`), so the number is
  produced and then dropped at the bridge.
- The patch converts that absence into a real 0:
  post-patch `src/engine/LlamaService.ts:1871  decode_tokens_gpu: npuStats.decode_tokens_gpu ?? 0,`.
- The binding is compiled from this source (`android/build.gradle:195 path = file('src/main/CMakeLists.txt')`),
  so the S23 APK built from this worktree cannot carry the new property until the pin moves.
  Consequence: every KALSA_GOVERNOR line from this worktree reads `"decode_tokens_gpu":0`, which is
  indistinguishable from "the GPU leg decoded nothing" — the exact conclusion the change exists to
  test. Fix: bump `package.json`/`package-lock.json` to `kalsa.rn#c3ef55d4` (vendor is already
  5cb7e14a0, so the engine needs no change), or emit `npuStats.decode_tokens_gpu ?? null` until then.

### F2 — P3 — CONFIRMED — the app comment's exception (`decode_tokens_gpu` nonzero with the cadence off) is unreachable from the app

- post-patch `src/engine/LlamaService.ts:1863-1864`:
  `// traffic. All 0 while the cadence is off (decode_tokens_gpu excepted:`
  `// the one-model three-leg rotation, 0 on the two-model path).`
- The hop path is gated on the cadence: `llama-governor-policy.cpp:461 const bool hop_active = params_.decode_hop_tokens > 0 && npu_lane_live() && not_a_safety_state();`
  — cadence off ⇒ `result.engine` is CPU (or `GPU_COOLMODE`, which the switch below counts as CPU).
- The only other writer of `decode_engine_ == GPU` is forced rotation
  (`llama-governor.cpp:144 // Forced decode-leg rotation (F5 proof and governor-bench hook)` →
  `:174 decode_engine_ = forced_window_engine_;`), and the binding never sets it:
  `cpp/rn-governor-params.cpp:141 params = llama_governor_params{};` zero-initializes the struct and
  no `forced_leg` token appears anywhere under `cpp/` (grep: no hits). The two-model form cannot use it
  at all: `llama-governor.cpp:44 throw std::runtime_error("forced-leg rotation is a one-model proof hook");`
- So in every configuration the app can build, cadence off ⇒ `decode_tokens_gpu == 0`, and the
  parenthetical describes a proof hook the app cannot reach. Fix: delete the parenthetical or write
  "nonzero only through the engine's forced-rotation proof hook, which the binding does not set".

### F3 — P3 — CONFIRMED — the rewritten opening comment is factually wrong about the installed binding

- post-patch `src/engine/LlamaService.ts:1826-1828`:
  `// Governor stats fields the installed binding does not type yet (the`
  `// npu/KV facts, the GPU decode-leg counter); the local intersection`
  `// keeps tsc honest against an installed older binding.`
- The installed binding types the npu/KV facts, as required non-optional fields:
  `node_modules/llama.rn/lib/typescript/types.d.ts:248 npu_device: string | null;`
  `:250 npu_fallback: string | null;` `:255 cache_type_k: string | null;`
  `:256 cache_type_v: string | null;` `:259 prefill_kv: string | null;`
  Only `decode_tokens_gpu` is untyped by the pin. The rewrite also deleted the only pointer to which
  binding version introduced these fields (old text: "(kalsa.rn 3d8fc84a)"). Fix: name the one field
  that is actually untyped and keep the pin sha.

### F4 — P3 — CONFIRMED — "keeps tsc honest" overstates an optional-intersection guard that cannot fail

- post-patch `src/engine/LlamaService.ts:1835  decode_tokens_gpu?: number;` inside
  `const npuStats = stats as typeof stats & { ... }` (post-patch line 1829).
- An intersection with an *optional* member compiles whether or not the member exists, whatever its
  name and type; `?? 0` then erases the difference at runtime. A rename in a future binding
  (`decode_tokens_gpu_leg`), a type change, or removal all compile silently. The guard keeps tsc
  quiet, not honest. Fix: after the pin bump read `stats.decode_tokens_gpu` directly (the required
  field then anchors the name and the type), and keep the intersection only while the pin is old.

### F5 — P2 — CONFIRMED — the counters are not per turn, and the rewritten comment still says they are

- post-patch `src/engine/LlamaService.ts:1860-1862` keeps
  `// Decode-hop evidence (kalsa.bench.decode_hop): hops this turn, the`
  `// tokens each device generated, ...` — the patch rewrote the very next sentences and left this.
- The decode counters are reset only in `clear_cache`:
  `llama-governor-runtime.cpp:263 stats_.decode_hops = 0;` `:264 stats_.decode_tokens_cpu = 0;`
  `:265 stats_.decode_tokens_gpu = 0;`, inside `void llama_governor::clear_cache(bool clear_data)`
  (`:226`). The per-turn call does not touch them: `llama-governor-runtime.cpp:285 void llama_governor::reset_prefill_stats()`
  resets only `stats_.prefill_us`, `prefill_n`, `prefill_chunks` and the route counters.
- The engine documents the scope itself: `llama-governor-runtime.cpp:198 // windows, in the same clear_cache interval as the other decode_hop_* stats.`
- The binding calls the per-turn path (`cpp/rn-completion.cpp:807 parent_ctx->resetGovernorPrefillStats();`)
  while the app clears the cache only on discrete paths (LlamaService.ts:1655, :2032, :3405 — queued
  prefix wipe, window slide, utility clear), not between turns of a resident-KV chat.
- Consequence: `decode_tokens_gpu` in KALSA_GOVERNOR is monotone within a clear interval; summing the
  per-turn lines double-counts, and "GPU leg never ran" cannot be read from a per-turn 0. Fix:
  "hops since the last cache clear", or zero the decode counters in `reset_prefill_stats` if per-turn
  is the wanted contract (engine change; not this patch's call).

### F6 — P3 — CONFIRMED — the JSI group comment now heads a field it contradicts

- `cpp/jsi/RNLlamaJSI.cpp:946-947  // Decode-hop counters: 0 everywhere while` / `// decode_hop_tokens is off.`
  sits directly above the newly inserted `cpp/jsi/RNLlamaJSI.cpp:951-954` block whose own comment says
  `// Third leg of the one-model three-leg rotation,` / `// not a hop counter: ...`
  Two files in the same change train state the same fact differently (JSI: all counters 0 with the
  cadence off; app: this one excepted). Only the JSI version is correct for reachable configurations
  (F2), but a reader of the JSI block cannot see that the exception exists. Fix: move the new
  `setProperty` out of that group (e.g. after `decode_hop_commit_ms`) or amend the group sentence.

### F7 — P3 — CONFIRMED — no test pins the new wire field in either repo

- Binding: no test references the counters (`grep -rn "decode_tokens" src/__tests__/` → no hits);
  the repo already owns the pattern that would catch it
  (`src/__tests__/nativeSourceGuards.test.ts:11 const cpp = (name) => fs.readFileSync(path.join(__dirname, '../../cpp', name), 'utf8')`).
  A dropped or renamed `setProperty` still passes `tsc --noEmit` and the 18 suites.
- App: the same pattern exists for the line's other fields (`src/engine/benchRoute.test.ts:339 expect(serviceSource).toContain("platform_thermal_status: stats.platform_thermal_status")`),
  and the patch added no such line. Fix: one guard test per repo
  (`cpp('jsi/RNLlamaJSI.cpp')` contains `"decode_tokens_gpu"`; `serviceSource` contains
  `"decode_tokens_gpu: npuStats.decode_tokens_gpu"`).

---

## Checked and clean (no finding)

- **R1 — REFUTED (same object, same path, no two-model/absent skip).** The property is inside the same
  lambda and the same `jsi::Object result`: `cpp/jsi/RNLlamaJSI.cpp:918 const auto stats = ctx->governorStats();`,
  `:940 jsi::Object result(rt);`, `:950` (npu) then `:954` (gpu) with no conditional between them.
  Absent governor ⇒ zeroed struct, not an omitted key:
  `cpp/rn-llama.cpp:1356 return governor == nullptr ? llama_governor_stats{} : governor->stats();`,
  and the binding keeps no field-by-field mirror — `cpp/rn-governor.cpp:179 llama_governor_stats result{};`
  `:180 llama_governor_get_stats(governor_, &result);` → `llama-governor-runtime.cpp:502 *stats = governor ? governor->stats() : llama_governor_stats{};`.
- **R2 — REFUTED (field name/type and the increment are real).**
  `vendor/llama.cpp/src/llama-ext.h:502 uint64_t decode_tokens_gpu = 0;   // one-model governor legs only (forced rotation)`;
  `vendor/llama.cpp/src/llama-governor.cpp:544 case llama_governor_engine::GPU:` `:545 stats_.decode_tokens_gpu += batch.n_tokens;`.
  "0 on the two-model path" holds: `GPU_COOLMODE` lands in `default:` (`:548 default:` → `:549 stats_.decode_tokens_cpu += batch.n_tokens;`)
  and the two-model form never sets decode legs — the only caller is
  `vendor/llama.cpp/src/llama-governor-legs.cpp:296 set_decode_legs(npu_ok, gpu_ok, true)` (one-model ctor),
  leaving the default mask `llama-governor-policy.h:208 bool decode_leg_present_[3] = { true, false, true };`.
- **R3 — REFUTED (generated types match the generator).** `npx tsc --emitDeclarationOnly --declarationMap`
  reproduces `lib/typescript/types.d.ts` byte-for-byte, and the `.d.ts.map` `mappings` string is
  byte-identical (only `sources` differed because my outDir was absolute). `src/types.ts:271 decode_tokens_gpu: number`
  is required, matching a JSI path that always sets the key; the app's optional duplicate is consistent
  with the older installed type (F1/F4).
- **R4 — REFUTED (no strict consumer breaks on the new key).** The app's log-report schema has no
  `KALSA_GOVERNOR` entry at all and pins that it is dropped: `src/logReport/__tests__/schemaHostile.test.ts:31 ["KALSA_GOVERNOR", '{"engine_prefill":"CPU"}'],`
  in the "excluded tags fail closed" list. The app's campaign tooling parses permissively —
  `scripts/campaign/telemetryParse.mjs:36 const obj = JSON.parse(payload);` keeps every key and
  `:40-45 applySchema` only fills `absentZero` — and the governor row declares no field list
  (`scripts/campaign/config.mjs:22 { prefix: "KALSA_GOVERNOR", timingInvalidOnCharge: [...] }`).
  No app script reads `decode_tokens*`/`decode_hop*` at all (grep of `scripts/campaign/*.mjs`: no hits).
- **R5 — gate claim plausible.** 18 suites = 9 `src/__tests__/*.test.ts` + 9 `example/src/__tests__/*.test.ts`;
  `src/__tests__` holds 59 `test(`/`it(` calls, so "18 suites / 80 tests" is credible and no test in
  either repo would have failed for this change (that is F7, not a false claim).
- **Not a finding, noted:** the app's local name `npuStats` (post-patch line 1829) now also carries the
  GPU counter; the rewrite's own text already admits the broader set.
