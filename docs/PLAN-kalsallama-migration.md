# Plan: compile kalsallama as the Android native engine

Stop after this plan. No migration until approved.

---

## What this actually ships (read this first)

The plan's headline was "the OpenCL kernel list". That is no longer the claim. Per the audit of
this plan (AUDIT-kalsallama-migration.md, findings F1–F10), the OpenCL kernels **have nowhere to run
that anyone measures** on Android in production:

- Production never offloads: `src/engine/engineParams.ts:99` sets no override and stays
  `n_gpu_layers=0` either way; `src/engine/deviceTuning.ts:737` returns `99` only for
  `backend.kind === "gpu-metal"` (iOS) and `0` otherwise.
- CI builds **x86_64 only** (`.github/workflows/bench.yml:184`); the OpenCL target is arm64-only
  (`rnllama/CMakeLists.txt:477-482`, inside `if (ANDROID_ABI STREQUAL "arm64-v8a")`). An x86_64
  build never compiles the OpenCL target, so there is no measured artifact for it.

So the real prize of this migration is the **CPU** side, which the migration lands regardless of GPU:

- The NEON q2_K/q3_K repack kernels in `arch/arm/repack.cpp` — **5492** lines on `9890d1054` versus
  llama.rn's **5156** — defining `ggml_gemv_q2_K_8x4_q8_K` (line **748**) and
  `ggml_gemv_q3_K_8x4_q8_K` (line **823**), both absent from llama.rn. This is the work that
  actually moves Android inference.
- The expert-ready hook (`BMOE_HAVE_EXPERT_READY_HOOK`), declared in `ggml/include/ggml-cpu.h:151`
  and implemented in `ggml/src/ggml-cpu/ggml-cpu.c:63`, plus the fuse work around it.
- The glue that keeps `common_chat_templates_has_variant`, `reasoning_budget_activate_immediately`,
  `common_reasoning_budget_get_end_match`, and `extra_fields`/`common_chat_template_caps` compiling
  against the older core (see "The replaced surface" below).

The OpenCL kernel list is kept in this plan, demoted: it is the last item, and it only matters if
the preconditions in "what would have to change for the OpenCL kernels to be measurable" are met.

Everything below that the audit verified CORRECT is carried over verbatim — exact line counts,
symbol names, commit counts, and the build chain.

---

## How the APK reaches `node_modules/llama.rn/cpp` today

Chain, quoted:

1. `package.json` depends on `"llama.rn": "0.12.8"` and `"postinstall": "patch-package"`.
2. `plugins/withLlamaFromSource.js` writes `rnllamaBuildFromSource=true` into gradle properties
   (opt-out only if `KALSA_LLAMA_FROM_SOURCE=0`).
3. Generated `android/gradle.properties` (gitignored, from `expo prebuild`):
   `rnllamaBuildFromSource=true`
4. `node_modules/llama.rn/android/build.gradle` passes that to CMake:
   `-DRNLLAMA_BUILD_FROM_SOURCE=${rnllamaBuildFromSourceFlag}`
5. `android/src/main/CMakeLists.txt` `add_subdirectory(rnllama)` when the flag is ON.
6. `android/src/main/rnllama/CMakeLists.txt`:
   `set(RNLLAMA_LIB_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp)`
   then globs that flattened tree. ARM64 also compiles
   `ggml-cpu/arch/arm/quants.c` and `ggml-cpu/arch/arm/repack.cpp`.

`android/app/build.gradle` never names llama.cpp. Expo autolinking pulls in llama.rn. `android/` and
`ios/` are gitignored; CI regenerates them with `npx expo prebuild --platform android --no-install`.

`BMOE_HAVE_EXPERT_READY_HOOK` is **not** in ggml sources. It is a CMake `COMPILE_DEFINITIONS` on
`native/bmoe/` TUs only (`patches/llama.rn+0.12.8.patch`). The hook **functions** live in ggml-cpu;
on `9890d1054` they are `ggml_cpu_set_expert_ready_hook` in `ggml/include/ggml-cpu.h:151` and
`ggml/src/ggml-cpu/ggml-cpu.c:63`.

---

## What `scripts/bootstrap.sh` does (llama.rn v0.12.8)

Not in the npm tarball (`files` omits `scripts/`). On tag `v0.12.8` it:

1. `git submodule update` of `third_party/llama.cpp` — **this would reset to llama.rn's upstream pin**.
   Cannot run as-is against kalsallama.
2. Copies standard llama.cpp layout (`ggml/include`, `ggml/src`, `src/`, `common/`, `tools/mtmd`,
   `vendor/`) into flattened `cpp/`.
3. `sed` rename: `ggml_`→`lm_ggml_`, `GGML_`→`LM_GGML_`, same for gguf (skips `cpp/rn-*` and
   `cpp/ggml-ext.h`).
4. Applies `scripts/patches/*.patch` (~16 llama.rn-owned patches — count not verifiable locally).
5. Writes `src/version.ts` and `common/build-info.cpp`.

That is the prefix mechanism. whisper.rn vendors its own ggml, so the prefix is load-bearing.

---

## How CI builds the APK

`.github/workflows/apk.yml`:

- `actions/checkout@v4` (no submodules, no secrets)
- `npm ci` → `patch-package`
- `npx expo prebuild --platform android --no-install` with `KALSA_LLAMA_FROM_SOURCE=1`
- `./gradlew assembleRelease`
- `scripts/native/assert-native-patch.sh` greps `kalsa-native-patches` inside `librnllama.so`

No `GITHUB_TOKEN` / PAT for `Aspis0/*`. A postinstall that `git clone`s kalsallama **dies in CI
today**. CI has **no** `secrets.*` anywhere — verified.

---

## Candidates (judged on reqs 1–3)

| Approach | Repeatable | Survives `npm ci` / CI | Verdict |
|---|---|---|---|
| Hand copy into `node_modules` | no | destroyed next install | rejected |
| Point CMake at standard-layout kalsallama | yes | only if submodule+token or committed tree | **2-day job**: rewrite Android+iOS CMake, fight `lm_` vs `ggml_`, keep whisper.rn coexistence |
| Run official `bootstrap.sh` inside llama.rn git | almost | submodule update overwrites our fork | do not run unmodified |
| Git dep / llama.rn fork with kalsallama submodule | yes | needs publishing or git URL + token | extra repo to maintain |
| **Trimmed bootstrap → committed overlay → postinstall copy → smaller patch-package** | yes: one script, SHA pin | yes: overlay is in this repo; CI needs no Aspis0 access | **recommended** |

Recommended is how llama.rn itself vendors llama.cpp (`cpp/` is the bootstrap output). We do the
same, pointed at our pin, outside `node_modules`.

---

## Pin and update command (req 1, no floating branch)

Record in `native/kalsallama.pin` (JSON, committed):

```json
{
  "repo": "https://github.com/Aspis0/kalsallama.git",
  "branch": "kalsa/repack-q23k",
  "commit": "9890d10545746025ada5a314aeb57c361395e055"
}
```

- **Compile from `commit` only.** `branch` is documentation and the default fetch ref for `bump`.
- CI and a laptop that has not fetched still compile the same SHA because the overlay in git is that
  SHA.

**Move the app onto a newer kalsallama commit:**

```bash
# from the kalsa repo, with network access to Aspis0/kalsallama
scripts/native/sync-kalsallama.sh bump
# → fetches origin/kalsa/repack-q23k
# → writes the new SHA into native/kalsallama.pin
# → flatten+prefix into vendor/kalsallama-cpp/
# then, if the glue patch no longer applies:
npx patch-package llama.rn
```

Pin a specific SHA without following the branch tip:

```bash
scripts/native/sync-kalsallama.sh pin 9890d10545746025ada5a314aeb57c361395e055
```

Rebuild (same as today): `npx expo prebuild --platform android --no-install` then gradle. `npm ci`
copies `vendor/kalsallama-cpp/` over `node_modules/llama.rn/cpp/` (engine files only) then
`patch-package`.

Local shortcut: `KALSALLAMA_SRC=/path/to/clone` skips GitHub if that clone is already at the pin SHA
(script verifies `rev-parse HEAD`).

---

## What the sync script does

`scripts/native/sync-kalsallama.sh` is a trimmed llama.rn v0.12.8 `bootstrap.sh`:

1. Resolve source at the pin SHA (local clone or fetch).
2. Copy the same file list as bootstrap (existence-checked: fork lacks `common/trie.{h,cpp}` — skip,
   do not `set -e` abort).
3. `rm -rf` mirrored dirs bootstrap already blows away (`cpp/models`, `cpp/ggml-opencl`, …) so we do
   **not** mix 192-commit-newer model files with the older core. (The exact `rm -rf` list is not
   verifiable locally — the vendored tree contradicts the `cpp/ggml-opencl` part, since that
   directory ships in the tarball.)
4. Apply `lm_` / `LM_` prefix with the same sed + `normalize_lm_prefixes`.
5. Leave untouched: `rn-*`, `jsi/`, `ggml-ext.h` (llama.rn glue).
6. Try llama.rn `scripts/patches/*.patch` (v0.12.8); **fail the script** on a hunk that is still
   relevant, do not silently skip. Metal-only patches can be skipped with an explicit allowlist
   because default iOS does not compile `cpp/`.
7. Write `vendor/kalsallama-cpp/` plus a `VENDOR_SHA` file matching the pin.
8. Copy that overlay into `node_modules/llama.rn/cpp/` when invoked from postinstall.

`package.json` postinstall becomes: overlay copy, then `patch-package`.

### The committed overlay must correspond to the pin (F4)

`VENDOR_SHA` is written but never enforced. After `sync-kalsallama.sh bump`, a forgotten regeneration
yields a green build on a silently old engine — the overlay in git no longer matches `commit` in
`native/kalsallama.pin`. The plan's "CI compiles the same SHA" was a trust statement, not a check.

Add a check that **fails the build (and CI)** when the committed overlay does not correspond to the
pin:

- **Runs:** in `scripts/native/sync-kalsallama.sh` after it writes the overlay, and as a standalone
  `scripts/check-pin-consistency.sh` invoked from the CI matrix (and from `npm ci` postinstall).
- **What it does:** reads `commit` from `native/kalsallama.pin`, computes the SHA of the committed
  overlay (`vendor/kalsallama-cpp/`, e.g. `sha256` over the sorted file list + contents, or a pinned
  `git hash-object -t tree` of the overlay), and compares. Mismatch → non-zero exit, no build.
- If the overlay has not been generated yet (first checkout), the check errors loudly and points at
  `scripts/native/sync-kalsallama.sh sync` rather than silently shipping the wrong engine.

This is the only place the pin is enforced. Everything else (assert-native-patch, the compile)
passes on a stale overlay today.

---

## The CPU side is the deliverable (carried over, verified correct)

`9890d1054` shares merge-base `22b69b6e9` (2026-07-10) with llama.rn:

```
fork-not-in-llama.rn:  64 commits
llama.rn-not-in-fork: 192 commits
```

The repack kernels that make the migration worth it live in `arch/arm/repack.cpp` — **5492** lines
on the fork versus llama.rn's **5156**. That file defines `ggml_gemv_q2_K_8x4_q8_K` (line **748**)
and `ggml_gemv_q3_K_8x4_q8_K` (line **823**), both absent from llama.rn. The CPU NEON path is what
the migration lands; it does **not** depend on the OpenCL kernel list (`repack.cpp` is already in
`SOURCE_FILES_ARCH`).

The expert-ready hook and its fuse work: `BMOE_HAVE_EXPERT_READY_HOOK` is a CMake
`COMPILE_DEFINITIONS` on `native/bmoe/` TUs only. The hook functions live in ggml-cpu —
`ggml_cpu_set_expert_ready_hook` in `ggml/include/ggml-cpu.h:151`, implemented in
`ggml/src/ggml-cpu/ggml-cpu.c:63`. On `9890d1054` those functions are present (the hook is already
on the fork, with extra call sites including fused SwiGLU).

`llama-kv-cache.cpp`: 2636 (fork) vs 2905 (vendored). This **is** a move backwards on the core, plus
64 fork commits (kernels, hook, OpenCL q2/q3).

---

## What would have to change for the OpenCL kernels to be measurable at all

This section exists only because the migration's headline was the OpenCL list. The kernels are
measurable **only** if all of the following hold; none is in scope for this change:

1. **An arm64 build that actually compiles the OpenCL target.** CI currently builds x86_64 only
   (`.github/workflows/bench.yml:184`); the OpenCL target is arm64-only
   (`rnllama/CMakeLists.txt:477-482`). Either add an arm64-v8a CI build step, or bench on a manual
   device with `NGL=N` (and `flashAttn:"off"`, the only cell that ever exercised OpenCL — and that
   cell `engineParams.ts:63-73` records as having previously killed `llama_init_from_model`).
2. **The F2 name-heuristic constraint must be satisfied.** Fork `ggml-opencl.cpp:7214-7216` dispatches
   q2_K/q3_K only when `strstr(name,"ffn") && strstr(name,"exps")` or `strstr(name,"as")`, plus
   `ne01 % 32 == 0` and `ne[3] == 1`. Plain `GGML_OP_MUL_MAT` (`ggml-opencl.cpp:7660-7690`) lists
   F16/BF16/F32/Q1_0/Q4_0/Q4_1/Q5_0/Q5_1/MXFP4/IQ4_NL/Q4_K/Q5_K/Q6_K/Q8_0 — **Q2_K and Q3_K absent**,
   so non-ID q2_K matmul is always `return false`. A per-op `supports_op` decline is invisible in a
   split graph. The kernels only run if the tensor names line up with that heuristic.
3. **The measurement must log dispatch.** The fork ships the diagnostic the plan never used:
   `GGML_OPENCL_LOG_KERNELS` (`ggml-opencl.cpp:59-73`). Without it, a GPU-arm run reports nothing and
   you cannot tell that the kernel fired.

Until (1)–(3) are met, the OpenCL list is documentation, not a measured effect. Do not budget for it
as if it ships.

---

## OpenCL kernels will not reach the .so without a CMake edit (demoted)

`9890d1054` has the four Adreno kernels. `ggml-opencl.cpp` `#include`s `gemv_moe_q2_k_f32_ns.cl.h`
etc. under `LM_GGML_OPENCL_EMBED_KERNELS`.

llama.rn Android CMake has a **hardcoded** `GGML_OPENCL_KERNELS` list at `CMakeLists.txt:249`:
**167** entries, **zero** `q2_k`/`q3_k` names, and it **does** list ~17 kernels the fork no longer
ships (`gemm_moe_q4_0_q8_1_dp4a`, …) — set-equality verified: exactly 17 names are absent from the
fork. After overlay:

- embed of missing `.cl` → **configure/build fail**
- omitting the four new `.cl` → OpenCL target fails on missing `.cl.h`, or worse, CPU-only variants
  still build and we ship an APK that never ran q2/q3 GPU kernels

Must rewrite that list to the fork's `ggml-opencl/kernels/*.cl` (add the four q2/q3 +
`oracle_consumer_q4_0_{gemv,gemm}`; drop the 17 absent names). The four kernels are present and
`#include`d at CMakeLists entries **4442 / 4459 / 4476 / 4493**. CPU NEON path does not use this
list (see the section above).

This only matters once the preconditions in the prior section are met.

---

## The replaced surface is bigger than three symbols, and it is called at runtime

The old plan said "three `llama.h` symbols, none called by glue". That is wrong on both counts. The
public `llama.h` diff (`LLAMA_API`) really is **three symbols, all only in the newer llama.rn
engine** — `llama_load_mode`, `llama_load_mode_from_str`, `llama_load_mode_name` — and they are
**not** called by `rn-*.cpp` or JSI; used only inside vendored `llama.cpp` / `llama-model-loader.cpp`
/ `common.h`, which the overlay replaces with the fork's own files. `llama.h` is **1599** (fork) vs
**1605** (vendored); the diff is exactly `llama_load_mode*`.

But the surface that actually breaks at runtime is **four** llama.rn-patch-added items the fork
lacks and that glue calls — absent from the fork, present in llama.rn's ~16 bootstrap patches:

- **`common_chat_templates_has_variant`** — called at `RNLlamaJSI.cpp:302`, runs on **every model
  load**. Declared `common/chat.h:366` in the vendored tree, added by llama.rn's own
  `chat.cpp.patch:145`. **What happens:** the overlay must carry this symbol; if the fork lacks it,
  the glue patch re-adds it at sync time (it depends on llama.rn's bootstrap patch applying to the
  fork). If the patch no longer applies, `sync-kalsallama.sh` must fail (see F6 below), not silently
  drop the call.
- **`reasoning_budget_activate_immediately`** — called at `JSIParams.cpp:555`; llama.rn-patch-added to
  `common_params_sampling` and used by `sampling.cpp:300`. (Both bases have `reasoning_control`; what
  is missing is llama.rn's field — the old plan's parenthetical was imprecise.) **What happens:**
  glue change is local to `JSIParams.cpp` (set the llama.rn field after the patch applies).
- **`common_reasoning_budget_get_end_match`** — absent from fork `common/reasoning-budget.h`.
  **What happens:** must be carried by the glue patch; otherwise the symbol is unresolved at link.
- **`extra_fields` / `common_chat_template_caps`** — absent from the fork's `chat.h`. **What happens:**
  carried by the glue patch; if a base field they read is gone on the fork, JSIParams needs a local
  guard.

All four depend on llama.rn's ~16 bootstrap patches applying to the fork at sync time. The old
plan's "bindings vs older core" framing (the `llama_load_mode*` trio) understated this: the real
compile risk is these four runtime-called symbols, not the three unused `LLAMA_API` names.

### Bindings that WILL fail to compile until patched (old, still true)

Quoted from `jsi/JSIParams.cpp` (not in our current patch hunk for load_mode — it is stock
llama.rn 0.12.8):

```
cparams.vocab_only = getPropertyAsBool(...)           // common_params has no vocab_only on the fork
cparams.load_mode == LLAMA_LOAD_MODE_MMAP ...         // enum does not exist on the fork
cparams.load_mode = LLAMA_LOAD_MODE_*                 // fork has use_mmap / use_mlock / use_direct_io
sparams.reasoning_budget_activate_immediately = ...   // fork sampling has reasoning_control instead
```

Glow still speaks `use_mmap` / `use_mlock` / `vocab_only` / `thinking_forced_open`. Glue change is
local to JSIParams (+ one `common_model_params_to_llama` line if we keep `vocab_only` on
`common_params`). Not a CMake rewrite. A few dozen lines.

`rn-llama.cpp:601` `cparams.ctx_other = ctx` is `llama_context_params` — present on the fork. No
change.

False alarms (llama.rn-owned, not core): `llama_rn_*`, `llama_batch_add`/`clear` (inlines in
`rn-llama.h:212`), `llama_tokens` (`common.h` in both), `llama_get_ctx_other` (`llama-ext.h:117` in
both), `llama_log_callback_default` (`llama-impl.h` in both).

`llama_memory_clear`, `llama_get_memory`, `llama_batch_get_one`, `ctx_other` / `ctx_type` on
`llama_context_params` exist on the fork.

---

## Include rewrite (the plan never mentioned it)

Fork `common/fit.cpp:5` and `common/speculative.cpp:12`:

```c
#include "../src/llama-ext.h"
```

After flattening, `../src/llama-ext.h` does not exist. llama.rn's bootstrap rewrites it — proof in
the artifact: the vendored `common/speculative.cpp:12` reads `#include "../llama-ext.h"`.

So `common/fit.cpp:5` and `common/speculative.cpp:12` must be rewritten to `#include "../llama-ext.h"`
as part of the sync, exactly as llama.rn's bootstrap does. If the sync script does not perform this
rewrite, the build fails — and the failure is loud (compile), so it cannot be mistaken for success.

---

## Size figure and copy list (corrected)

The old plan said `~26M`. The copied dirs measure **30.2 MiB**, not "~26M".

Two bloat traps, corrected:

- **`models/` is 74.4 MiB** of gguf (110 files). It is only excluded if the copy list says so. The
  copy list **must** exclude `models/` — shipping 74.4 MiB of gguf in the overlay defeats the point
  of a source build. The old plan omitted this exclusion.
- **`vendor/`:** llama.rn's bootstrap ships only `nlohmann` from `vendor/`. The old plan copied all
  five fork vendor dirs (5.8 MiB) for nothing. Copy **only `nlohmann`**, as llama.rn does.

Finally, the RN `COMMON_FILES` glob would compile **31** fork `common/*.cpp` against **19** today.
Budget those extra 12 compilation units — they are mechanical (compile, no logic change) but they
add time to `assembleRelease`.

---

## iOS (kept, but the split deepens)

Path exists (`app.config.js` ios block, `package.json` `"ios": "expo run:ios"`).

`withLlamaFromSource.js` only sets the **Android** gradle property. iOS default is llama.rn's
**prebuilt xcframework** (`llama-rn.podspec` unless `RNLLAMA_BUILD_FROM_SOURCE=1`). Overlaying `cpp/`
does **not** change that .so/.a. Default iOS stays on upstream. Not broken.

iOS-from-source would compile the overlay (same `cpp/`). Metal llama.rn patches may not apply to this
older Metal tree. **We will not flip iOS to source-build in this change.** If someone later sets
`RNLLAMA_BUILD_FROM_SOURCE=1` on iOS, that is a separate compile.

This means: after this change iOS runs upstream Metal kernels while Android runs fork CPU kernels,
**49 days + 64 commits apart**, with no verification surface on the iOS side (`llama-rn.podspec:33-44`
confirms the default uses the prebuilt xcframework). The split is now structurally deeper, and this
plan does nothing to verify the iOS side.

`mtmd.h` is identical between fork and RN, so the multimodal glue compiles. `whisper.rn` uses
`WSP_GGML_*`, so coexistence holds.

---

## Rollback (there is none today — add it)

The old plan's exit clause was "stop and report". That is not a rollback: reverting only the patch
leaves postinstall stale; reverting only `package.json` leaves the overlay unused; and executing the
migration **destroys the working baseline inside `node_modules`**. The recovery sequence is:

1. **Snapshot the current good engine before starting.** Copy `node_modules/llama.rn` to
   `node_modules/.kalsa-backup-<sha>` (and record the pre-migration `native/kalsallama.pin` if it
   existed). This is the only way to recover, because postinstall overwrites `node_modules`.
2. **If the migration fails mid-way** (e.g. a glue patch hunk fails, or `assembleRelease` explodes in
   `common/`): run `rm -rf node_modules`, reinstall the backup:
   `cp -r node_modules/.kalsa-backup-<sha> node_modules/llama.rn`, then `rm -rf node_modules/.cache`
   and re-run `npm ci` to restore a consistent tree.
3. **If it lands but is wrong** (green build, wrong engine — the F4 failure): revert `package.json`
   to the pre-migration `postinstall` + `dependencies`, remove the committed overlay
   (`vendor/kalsallama-cpp/`) and `native/kalsallama.pin`, then `rm -rf node_modules && npm ci` so
   postinstall no longer copies the overlay, and re-prebuild.
4. **Verify recovery** by rebuilding (`npx expo prebuild --platform android --no-install` then
   `./gradlew assembleRelease`) and running the on-device checks in "Verify after" — a green build on
   the restored tree is not proof; the checks must pass.

The recovery sequence is stated here and executed by none of the steps above — step 1 (snapshot) is
the only one that prevents data loss. Without it, rollback is impossible and you are committed to
whatever the build produced.

---

## Cost (revised, honest)

The old estimate was "half a day + hours". F5 (four runtime-called symbols, not three unused ones)
and F7 (30.2 MiB, `models/` exclusion, `nlohmann`-only vendor, 19→31 compiled files) add work the old
estimate did not see. New estimate:

- **Sync script + pin + committed overlay + postinstall copy:** half day. Genuinely mechanical — it is
  a trimmed bootstrap.sh pointed at our pin. Uncertain only on the fork's file list (existence checks
  for missing files like `common/trie.{h,cpp}`) and the exact `rm -rf` mirror list, which is not
  verifiable locally.
- **Pin-reconciliation check (F4):** a few hours. Mechanical once the sync script writes `VENDOR_SHA`.
- **Include rewrite (F6):** minutes. Mechanical — two `#include` path fixes, exactly as llama.rn's
  bootstrap does.
- **Size/copy-list correction (F7):** an hour. Mechanical — exclude `models/`, copy only `nlohmann`.
- **The four runtime-called symbols (F5):** hours, **the genuinely uncertain part.** `common_chat_templates_has_variant`,
  `reasoning_budget_activate_immediately`, `common_reasoning_budget_get_end_match`, and
  `extra_fields`/`common_chat_template_caps` each depend on a llama.rn bootstrap patch applying to
  the fork at sync time. If any patch no longer applies, the sync must fail (not silently drop it),
  and you then hand-fix `JSIParams.cpp` / `RNLlamaJSI.cpp`. This is where the estimate can blow up —
  it is unknown until the first sync runs against `9890d1054`.
- **OpenCL kernel list rewrite:** hours, but only if you are spending it (see "what would have to
  change"). Not in the base estimate — it is opt-in once the preconditions are met.
- **First `assembleRelease` against the older core:** unknown until that build, as before. `llama.h`
  is 1599 vs 1605; the public API hole is `llama_load_mode*`, which bindings do not call. Residual
  risk is llama.rn's ~16 bootstrap patches (count not verifiable locally) and any `common.h` field
  the four symbols touch that I did not see JSI touch. The 19→31 `COMMON_FILES` units add compile
  time but no logic.

**Net: one to two days, not half a day.** The mechanical bulk (script, pin, overlay, include rewrite,
copy list, pin check) is roughly a day. The uncertain remainder is the four runtime symbols and the
first build against the older core. If the first `assembleRelease` explodes in `common/` /
`rn-completion.cpp`, stop and report rather than paper over — do not expand scope to make it compile.

---

## Verify after (when approved) — this list must be able to fail

The old list was source-grep only and could not detect any way this appears to succeed while
measuring nothing. The new list fails when the artifact that actually ran is wrong.

1. **The loaded JNI variant, not the generic `.so`.** `RNLlama.java:201` tries
   `rnllama_jni_v8_2_dotprod_i8mm_opencl` (and variants). `tryLoadLibrary` catches
   `UnsatisfiedLinkError` and returns false **with no log**, so the app silently runs the CPU-only
   `.so`. Assert on the **loaded** variant — read back which `lib*.so` the running process actually
   mapped (e.g. inspect the arm64 APK's `lib/arm64-v8a/` for the `_opencl`/`_dotprod_i8mm` variant,
   and confirm it is the one that loaded), not grep the generic `librnllama.so`, which carries the
   `kalsa-native-patches` marker regardless of which variant loaded. (F3)
2. **`GGML_OPENCL_LOG_KERNELS` dispatch logging when a GPU arm is run.** If any GPU arm is exercised
   (manual device with `NGL=N`, or an arm64 CI bench), the fork's `GGML_OPENCL_LOG_KERNELS`
   (`ggml-opencl.cpp:59-73`) must emit that a q2_K/q3_K kernel actually dispatched. Absent that log,
   the run reported nothing and you measured CPU. (F2)
3. **On-device check that the expert-ready hook and the NEON symbols are in the binary that ran.**
   Confirm `lm_ggml_cpu_set_expert_ready_hook` (from `ggml-cpu.h:151` / `ggml-cpu.c:63`) and
   `lm_ggml_gemv_q2_K_8x4_q8_K` / `lm_ggml_gemv_q3_K_8x4_q8_K` (from `arch/arm/repack.cpp:748` /
   `823`) are present in **the `.so` that the running device loaded** — via `nm`/`strings` on the
   loaded artifact, not a source grep of the overlay. If they are in the overlay but absent from the
   loaded `.so`, the build shipped a stale/wrong engine (F3).
4. `scripts/check-pin-consistency.sh` passes: the committed overlay corresponds to
   `native/kalsallama.pin`. (F4)
5. `common/fit.cpp:5` and `common/speculative.cpp:12` read `#include "../llama-ext.h"` (not
   `../src/llama-ext.h`). (F6)
6. Overlay excludes `models/` (74.4 MiB) and copies only `nlohmann` from `vendor/`; `COMMON_FILES`
   compiles 31 files. (F7)
7. `scripts/native/assert-native-patch.sh` still finds `kalsa-native-patches` in the **loaded** variant.
8. Targeted gradle compile only (`assembleRelease -PreactNativeArchitectures=arm64-v8a`); no full
   test suite.

No commit, no push, no git history rewrite.

---

## What this plan does not solve

- **The iOS/Android engine split deepens (F8).** After this change iOS runs upstream Metal kernels
  while Android runs fork CPU kernels, 49 days + 64 commits apart (`llama-rn.podspec:33-44` confirms
  iOS defaults to the prebuilt xcframework). This plan verifies nothing on the iOS side. It is a
  structural drift this migration makes worse, not better.
- **The OpenCL kernels remain unmeasurable** until the preconditions in "what would have to change for
  the OpenCL kernels to be measurable" are met: an arm64 CI build or a manual device bench with
  `NGL=N`, the F2 tensor-name-heuristic constraint satisfied, and `GGML_OPENCL_LOG_KERNELS` dispatch
  logging. Until then the kernel list is documentation. This does not fix that; it demotes it.
- **The silent CPU-fallback path (F10)** — lose `-DLM_GGML_OPENCL_EMBED_KERNELS` and every kernel
  switches to the runtime `read_file()` fallback; the files are absent on Android, init fails, and
  the app converts that into CPU-only via `KALSA_GPU_FALLBACK` (`LlamaService.ts:1381`,
  `params.n_gpu_layers = 0`). Loud in the build, silent in the measurement. This plan makes the
  measurement surface (loaded-variant check, dispatch log) able to catch it, but does not remove the
  fallback.

---

## Verified CORRECT in the plan (carried over)

- merge-base `22b69b6e9`; **64** fork commits / **192** llama.rn commits.
- `arch/arm/repack.cpp` **5492** vs **5156** with `ggml_gemv_q2_K_8x4_q8_K` at line **748** and
  `ggml_gemv_q3_K_8x4_q8_K` at **823**, absent from llama.rn.
- the four Adreno kernels present and `#include`d at **4442 / 4459 / 4476 / 4493**.
- hardcoded `GGML_OPENCL_KERNELS` at `CMakeLists.txt:249` with **167** entries, zero `q2_k`/`q3_k`,
  exactly **17** absent from the fork (set-equality verified).
- `llama.h` **1599** vs **1605** with the `LLAMA_API` diff being exactly `llama_load_mode*`.
- every JSIParams quote verbatim at the claimed lines.
- the expert-ready hook at `ggml-cpu.h:151` / `ggml-cpu.c:63`.
- the whole build chain.
- CI has **no** `secrets.*` anywhere.
- `mtmd.h` identical between fork and RN (multimodal glue compiles).
- `whisper.rn` uses `WSP_GGML_*` so coexistence holds.

## Stated by the plan, NOT verifiable locally (caveat carried)

- "~16 llama.rn-owned patches" (count).
- build number "b10156".
- the bootstrap `rm -rf` list — the vendored tree contradicts the `cpp/ggml-opencl` part, since that
  directory ships in the tarball.
