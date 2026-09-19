# Fork migration: adopt llama.rn's `vendor/` layout

**Order, 19/09/2026:** *"dobbiamo ribasarsi su quello che fanno loro… metti da parte il governor
perche senza un kalsallama funzionante non ha senso"* and *"veloce, che mi sembra ci sia poca roba
ancora e piu passa il tempo e piu diventa complicato."*

Owner of this work: kalsa-38. The governor is parked
([`GOVERNOR-DEVICE-PLAN.md`](GOVERNOR-DEVICE-PLAN.md)).

**Provenance rule for this document.** Every claim is tagged:
**[V]** = re-read on disk by the orchestrator. **[E]** = from the migration-map Explorer
(`b16cd294`, deepseek v4.1, read-only), *not* independently verified. A delegate's output is not
evidence; **[E]** claims must be re-read before they are acted on, and the step that acts on one
says so.

---

## 1. The decision, and why it is not optional

Upstream `mybigday/llama.rn` restructured. Two layouts, same job:

| | ours today | upstream now |
|---|---|---|
| llama.cpp location | `cpp/`, flattened, 741 generated files **[E]** | `vendor/llama.cpp/`, native layout, 1515 files **[V]** |
| symbols | renamed `LM_`/`lm_` by our sync | **no prefix**; `-Wl,-Bsymbolic` instead **[E]** |
| pin | `kalsallama.pin` (JSON) **[V]** | `vendor/VERSIONS` (`*_REPO`/`*_REF`/`*_COMMIT`) **[V]** |
| regeneration | `scripts/sync-kalsallama.sh`, 845 lines, ours **[V]** | `scripts/sync-vendor.sh` + `npm run sync:vendor` **[V]** |
| patches | `scripts/kalsa-patches/` (2) **[V]** | `scripts/patches/<dep>/` + `update-patch.sh` **[V]** |
| OpenCL headers / ICD | `third_party/` submodules **[V]** | `vendor/OpenCL-{Headers,ICD-Loader}` **[V]** |

We built the same machine they did. Theirs is maintained by them and ours is not. **[V]**
`LLAMA_CPP_REPO` is a variable honoured end-to-end by `sync-vendor.sh`, so we point it at
`https://github.com/Aspis0/kalsallama.git` and our llama.cpp fork stops being flattened and
prefixed — it becomes an ordinary fork, vendored verbatim.

**The cost of waiting is real.** Our llama.rn fork is 37 commits behind and the three commits we
must rebase across (`#391` jsi/json helpers, `#392` drop-lm-prefix, `#393`) have already landed.
Every further upstream commit on `cpp/rn-*` and `cpp/jsi/*` widens step 6, which is the expensive
step. A separate Explorer (`8113746e`) is checking whether upstream is about to move again; its
verdict can delay the start but not the direction.

---

## 2. Measured size of the job

### kalsallama ← ggml-org/llama.cpp **[V]**

151 ahead / 245 behind, merge base `64a155d24`. Target: **`b11010` = `4bc272fd729bd094c0422e4b8353da8d2fec91f8`**, the commit upstream llama.rn pins, because their patch set is written against it.

`git merge-tree --write-tree` (non-destructive) → 20 files touched by both sides, 15 auto-merge,
**5 conflicts**:

| file | ours | theirs | conflict hunks **[E]** |
|---|---|---|---|
| `ggml/src/ggml-opencl/ggml-opencl.cpp` | +3124/−117 | +2728/−369 | 4 |
| `tests/test-backend-ops.cpp` | +640/−10 | +634/−116 | 1 |
| `ggml/src/ggml-hexagon/ggml-hexagon.cpp` | +11/−4 | +1405/−401 | 4 |
| `src/CMakeLists.txt` | +7/−0 | +42/−32 | 1 |
| `tests/CMakeLists.txt` | +60/−0 | +20/−18 | 2 |

**[E]** 77 of our 97 files are untouched by upstream; upstream touched **none** of our 18 `.cl`
kernel files; total collided base lines = 64. **[E]** The same five conflicts appear whether the
target is `b11010` or `master`, so the 43 commits in between add nothing.

**Merge, not rebase.** 151 commits rebased onto 245 is up to 151 resolutions; a merge is one.

### llama.rn-kalsa ← mybigday/llama.rn **[V]**

41 ahead / 37 behind, merge base `2a20c13e`. Hand-written surface to re-apply: **17 binding files
(1889+/411−) and 3 TS files (79+)**. The ~370 changed files under `cpp/` are generated output and
are deleted, not ported. **[E]** No binding file was renamed or moved; the four `rn-governor*`
files are entirely ours and port for free.

**[E]** The five expensive re-applications, by how far upstream moved under us:

| file | ours | upstream moved |
|---|---|---|
| `cpp/rn-tts.cpp` | +12/−0 | **+3233/−301** |
| `cpp/jsi/RNLlamaJSI.cpp` | +255/−62 | +647/−552 |
| `cpp/rn-completion.cpp` | +433/−132 | +601/−43 |
| `cpp/jsi/JSIParams.cpp` | +123/−37 | +292/−331 |
| `cpp/jsi/JSICompletion.h` | +42/−11 | +151/−246 |

`#391`'s stated goal is to delete the JSON string round-trips — which our code may be written
around. Budget this step as re-writing, not re-applying.

---

## 3. Five findings that constrain the plan

Each was re-read on disk by the orchestrator after the Explorer reported it.

### 3.1 The plan as first stated does not build **[V]**

`ggml/src/ggml-cpu/repack-q23k.h` is ours (`dcc9f25a5`) and is included by three TUs:
`ggml/src/ggml-cpu/ggml-cpu.c:19`, `repack.cpp:21`, `traits.cpp:5`. Upstream's export manifest
(`scripts/sync-vendor.sh`, the `ggml/src/ggml-cpu/*` block) is an **explicit file-by-file list**:
it names all three includers and does **not** name the header. The first sync exports three TUs
whose include is missing.

→ **Fix: add the pathspec before the first sync.** Gate: the header is present in
`vendor/llama.cpp/ggml/src/ggml-cpu/` after a sync.

### 3.2 `tests/` is not vendored at all **[V]**

No pathspec under `tests` exists in the manifest. So `tests/test-backend-ops.cpp` — **the NMSE
5e-4 net that is the only thing standing between a bad OpenCL merge and silently wrong numbers** —
is not exported, and neither are our 18 new test files, `tests/CMakeLists.txt`, or
`tools/governor-bench/`.

→ **Decide before step 2**, because step 2's exit gate depends on running that test. Options:
(a) extra pathspecs in the manifest; (b) run the tests from a kalsallama checkout, never from the
vendored tree. **(b) is the recommendation**: tests are not a shipping artifact, the vendored tree
is what ships, and (a) grows the npm package for nothing.

### 3.3 The silent failure: `LM_GGML_USE_*` **[V]**

kalsallama's sources are unprefixed — `ggml/src/ggml-backend-reg.cpp:57` is
`#ifdef GGML_USE_OPENCL`, `ggml/src/ggml-cpu/ggml-cpu.cpp:64` is `#ifdef GGML_USE_CPU_REPACK`
(the prefix is applied by our flatten, at sync time, not in the source). Our CMake passes the
**prefixed** names: `android/src/main/rnllama/CMakeLists.txt:170` `-DLM_GGML_USE_CPU
-DLM_GGML_USE_CPU_REPACK`, `:312` `-DLM_GGML_USE_OPENCL`. Upstream's passes the unprefixed ones
(`:68`, `:378`).

**Carrying our CMake onto a verbatim-vendored tree compiles green and silently unregisters every
backend.** The only symptom is throughput. This is the highest-risk item in the migration and it
has no compile error to catch it.

→ **Gate (step 5): a runtime assertion that the OpenCL backend is registered**, not a successful
build. See §5.

### 3.4 The `LM_` prefix has a live consumer in the app **[V]**

`kalsa/native/bmoe/bmoe_lmggml_compat.h` is 68 lines, **46 `#define`s** mapping unprefixed ggml
names to `lm_`-prefixed ones, force-included onto the bmoe TUs by
`llama.rn-kalsa/android/src/main/rnllama/CMakeLists.txt:49,53` (`-include`). With the prefix gone
it maps live names to dead ones and every bmoe TU fails to compile.

→ The `LM_` question is **one decision taken once**, not three: the shim, the CMake defines
(§3.3), and the gates all flip together.

### 3.5 The daily cron would fight us **[V, with a correction]**

`scripts/update-llama-cpp.sh:16` hardcodes `api.github.com/repos/ggml-org/llama.cpp/releases`,
`:26` filters `^b[0-9]+$`, `:59` rewrites `LLAMA_CPP_REF`; `.github/workflows/sync-llama-cpp.yml:5`
runs it at `cron: '0 2 * * *'` with `continue-on-error: true`.

**Correction to the Explorer**, which said this would "silently drop the fork": it rewrites
`LLAMA_CPP_REF`, **not** `LLAMA_CPP_REPO`. Pointed at our fork it would ask for a `bNNNNN` tag that
does not exist there, so it **fails loudly** every night with a "[sync failed]" PR. Still must be
disabled or repointed; the failure mode is noise, not corruption.

---

## 4. What upstream already did for us **[E — verify at the hunk, in step 2]**

Three of our carried changes must **not** be merged:

| ours | upstream | action |
|---|---|---|
| `28b9a1351`, `ff7ae8009` — Hexagon `error_count` | `eafe15a5e` — propagates the *status code*, to sub-sessions too, and aborts on async failures | **delete ours** (all 4 hexagon conflict hunks are this one subject) |
| `dcd0a7607`, `32b318aab` — noshuffle `ne1 % 128` | `56b9eb280` relaxed the rule to **`% 64`** | **re-derive to `%64`**; keeping `%128` diverts legal shapes to the flat kernel *we forked because it is broken on Adreno 740* |
| 7 cherry-picks (`9463b3aa8`, `273043b82`, `c7ad97025`, `12f6d9b6d`, `8fe4bf8d3`, `b7a5e926b`, `5c7e16fa6`) | landed upstream | drop for free; verify merged content equals upstream's |

**[E]** Not superseded, genuinely ours, survives: the E031 mask-as-args workaround on the MoE
kernels, `q23k`, the q2_K/q3_K MoE kernels, `expert_ready_hook`, `mmap_prefetch`,
`ggml_cpu_fused_moe`, the governor, `KALSA_PHASE_STAMPS`.

**[E] One latent trap to record now:** our guard `if (!backend_ctx->kernel_gemm_moe_q4_k_f32_ns_bin)`
keys on kernel *availability*. Upstream's `9f31776c3` replaced exactly that pattern with a
`use_bin_kernel` decision **in the q4_0 block**. The q4_K block still tests the pointer, so our
invariant holds **by luck of which block they changed**. If upstream applies the same treatment to
q4_K, our mask args stop being set and the kernel runs with 3 unfilled trailing args — silently.
Write this into `KALSA_FORK.md` as a standing hazard.

---

## 5. Order of work, with a falsifiable gate per step

A step is not done when it compiles. It is done when its gate passes.

### Step 1 — Extract the knowledge out of `sync-kalsallama.sh` before deleting it
The script is not just a sync; it carries guards nothing else has. **[E]**, verify each before
porting: `assert_kalsa_post_image` (exactly one `kalsa-native-patches` line in
`common_params_get_system_info`, exactly one `} kalsa_moe;` in `struct common_params` — catches a
silently dropped or double-applied patch that `git apply --check` cannot see), `assert_patch_path`
(refuses a patch touching `jsi/` or `rn-*`), the **shallow-clone refusal** in `write_build_info`,
`assert_installed_sha`.

Also regenerate the two `scripts/kalsa-patches/*.patch` into `scripts/patches/llama.cpp/`:
`common.h.patch` carries the `kalsa_moe` struct that JSI and `native/bmoe` agree on;
`common.cpp.patch` appends the `kalsa-native-patches` marker the app gates on
(`scripts/assert-native-patch.sh`, `src/engine/engineIdentity.ts`). **Deleting these before
regenerating them breaks engine identity and MoE streaming.**

**Gate:** the two regenerated patches apply cleanly to a `b11010` tree, and a grep proves the
marker and the struct survive.

### Step 2 — Merge kalsallama to `b11010`
Order inside the step matters: **`tests/test-backend-ops.cpp` and `tests/CMakeLists.txt` first**,
then `src/CMakeLists.txt`, then `ggml-hexagon.cpp` (delete our side), then `ggml-opencl.cpp`.
Resolve `use_flat_gemv_for_large_m_q4_K` to `%64`, not `%128` (§4).

**Gate:** `test-backend-ops` green on the q4_K MoE `MUL_MAT_ID` cases at the 5e-4 NMSE threshold.
Not "it builds". The failure mode of this merge is wrong numbers, not a crash — the same class as
the E031 miscompile. Until the metre is green, the kernel is unjudged.

### Step 3 — Fix the export manifest
Add `ggml/src/ggml-cpu/repack-q23k.h` (§3.1). Decide `tests/` (§3.2 — recommendation: keep them in
kalsallama, out of the vendored tree).

**Gate:** `npm run sync:vendor` against `LLAMA_CPP_REPO=Aspis0/kalsallama` leaves `git status`
clean. Note **[V]** that upstream documents this invariant in four places and **enforces it
nowhere**; we automate it, as our own `sync-kalsallama.sh verify` did.

### Step 4 — Take the `LM_` decision, once
Flip together: delete/neutralise `native/bmoe/bmoe_lmggml_compat.h`; every `-DLM_GGML_*` →
`-DGGML_*` in `android/.../CMakeLists.txt`, `ios/CMakeLists.txt`, the podspec and both gates;
verify `-Wl,-Bsymbolic` preserves whatever coexistence the prefix existed for.

**Gate:** a runtime line proving the OpenCL backend registered and a GPU op ran — not a green
build (§3.3).

### Step 5 — Carry the app's glue in the same commit as the layout change
**[E]**, each to be verified when touched: `BMOE_ROOT` derivation gains a `..` level (today
`cpp/../../..` resolves to the app root; under `vendor/llama.cpp` it does not, and
`if(EXISTS ...)` then takes the false branch — **MoE streaming compiles out and the build stays
green**); `node_modules/llama.rn/cpp/ggml/include` → `vendor/llama.cpp/ggml/include`;
`third_party/OpenCL-Headers` → `vendor/OpenCL-Headers`; `ENGINE_TREE_DIRS` in
`scripts/engine-build-id.js`; `cpp/KALSALLAMA_SHA` → `src/version.ts` + `vendor/VERSIONS` in
`scripts/assert-engine-provenance.sh`; `scripts/assert-overlay-includes.sh` (the app's **second**
include gate) and `scripts/assert-cpp-includes.sh` (the fork's) both rewritten for two roots.

**Gate:** the KV-identity digest still changes when the engine changes. **[E]** says it would keep
returning a non-null fingerprint over the wrong directories — a silent KV-staleness class, not a
build error. Prove it with two builds that differ only in engine content.

### Step 6 — Re-apply the 20 binding/TS files — **the bottleneck**
Hardest first: `rn-completion.cpp`, `rn-tts.cpp`, `jsi/RNLlamaJSI.cpp`, `jsi/JSIParams.cpp`,
`jsi/JSICompletion.h`. The four `rn-governor*` files copy across.

**Gate:** per file, a named behaviour that must survive, checked before moving on. Not a diff count.

### Step 7 — Disable or repoint the daily sync (§3.5)

### Step 8 — Only now delete
`sync-kalsallama.sh`, `kalsa-patches/`, `kalsallama.pin`, the generated `cpp/` tree, `third_party/`,
`.gitmodules`; decide `lib/` and the `prepack` question — **[E]** warns upstream's `package.json`
restores `prepack`, which our `130cc023` deliberately removed and which
`scripts/assert-engine-provenance.sh` assumes is absent.

---

## 6. The silent failures, collected

Everything in this migration that **passes green while being broken**. These are the only things
worth building a gate for:

1. `-DLM_GGML_USE_*` on an unprefixed tree → no backend registered, GPU gone (§3.3). **[V]**
2. `BMOE_ROOT` off by one directory → `EXISTS` false → MoE streaming silently compiled out. **[E]**
3. A bad `ggml-opencl.cpp` merge → NMSE 0.57–0.96 against a 5e-4 threshold; wrong numbers, no crash.
4. `patch` fuzz 2 in `apply_patches` → a hunk applied in the wrong place without failing; the
   `git status`-clean check that would catch it is **not automated upstream**. **[E]**
5. Engine-identity digest over directories that no longer hold the engine → stale KV reuse. **[E]**
6. Upstream's hand-written `GGML_OPENCL_KERNELS` list, adopted wholesale, drops our 6 kernels —
   the exact drift our fork replaced with a glob and documented. **[E]**

## 7. What we are not doing
No iOS/Metal work. No governor work. No device measurement beyond step 2's gate. No push to any
third-party repo. We do not take upstream's kernel list (we keep our glob, §6.6) and we do not
take their `prepack`.

## 8. Open, and who answers it
- The Explorer `8113746e` answers: is upstream about to move again, and is `b11010` the right
  target? Its verdict can delay the start; it cannot change the direction.
- **[E], unverified, matters:** does `-Wl,-Bsymbolic` actually replace the prefix for our case? It
  cannot address *preprocessor* macros at all — those must simply be renamed (§3.3).
- **[E]:** whether our `use_q4k_tiled` interaction is still needed after upstream's `d03efa5d5`.
- Whether the committed `bin/arm64-v8a/libggml-htp-*.so` correspond to the kalsallama commit now
  pinned — **[E]** says nothing in either repo records their provenance any more.
