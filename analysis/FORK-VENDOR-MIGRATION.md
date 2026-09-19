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

## 1b. The real objective: make the NEXT rebase cheap

**Owner, 19/09:** *"fare in modo che i prossimi rebase upstream siano facili e indolori."*

Migrating once is not the goal. The goal is that the migration after this one costs hours, not
days. That reframes success: a migration that lands but leaves our delta shaped the same way has
failed, because we will pay this bill again at every bump.

### What actually costs, measured on this migration

A rebase costs in proportion to **edits to upstream-owned files**, not to lines of our code.
New files we own never conflict. The evidence is in this very job:

| | our new files | our edits to upstream files | what hurt |
|---|---|---|---|
| kalsallama **[V]** | 44 | 53 | 5 conflicts, all in edited files |
| llama.rn **[V/E]** | 4 (`rn-governor*`) | 16 | the whole bottleneck, step 6 |

The four `rn-governor*` files are +306 lines and port for **free**. `cpp/rn-tts.cpp` is +12 lines
of ours and is the single most expensive file in the migration, because upstream grew it to 3233
lines underneath us. **Twelve lines in someone else's file cost more than three hundred in ours.**
That is the whole lesson, and it is the metric.

### The rules that follow

1. **New capability goes in a new file.** An edit to an upstream file is a recurring tax; a new
   file is paid once. When both are possible, take the new file even if it is more code.
2. **Where an edit is unavoidable, shrink it to a call.** The ideal edit to an upstream file is one
   line that calls into a file we own. Fifty lines of our logic inlined into `rn-completion.cpp` is
   fifty lines that must be re-read against every upstream refactor; one call site is one line.
3. **Prefer an upstream extension point; if none exists, consider upstreaming the hook itself.**
   Our `ggml_cpu_set_expert_ready_hook` (`kalsallama:ggml/include/ggml-cpu.h:152`) is exactly this
   shape — a hook we added so the logic could live outside. **[E]** upstream has nothing
   equivalent, which makes it a candidate to propose rather than carry forever.
4. **Every edit to an upstream file carries a one-line reason, in `KALSA_FORK.md`.** Not for
   documentation's sake: it is what makes the question in rule 5 answerable in minutes.
5. **Run the supersede check before every bump.** On this migration it deleted three carried
   changes: the Hexagon `error_count` (upstream's `eafe15a5e` is strictly stronger), the noshuffle
   `%128` rule (upstream relaxed it to `%64` and ours is now *wrong*), and seven duplicate
   cherry-picks. That check is `git log -S <our subject> <base>..upstream/master` per edit, and it
   pays for itself every time.
6. **Adopt upstream's mechanism instead of building a parallel one.** This entire migration exists
   because we wrote an 845-line sync script to do what upstream now does with `VERSIONS` +
   `sync-vendor.sh`. The cost of a parallel mechanism is not the code — it is that it drifts out
   of the upgrade path and one day has to be demolished under time pressure.

### The gate for this objective

Steps 6 and 8 are not done until this is true and recorded:

- A count of **edits to upstream-owned files, before and after**, in both repos. The number must go
  down, and where it does not, the reason is written next to it.
- For each of the 16 edited binding files: either it is reduced to a call into a file we own, or
  `KALSA_FORK.md` says why it cannot be.
- A dry-run of the next bump — `git merge-tree --write-tree` against the then-current
  `upstream/master` — recorded in `KALSA_FORK.md` as the baseline the following bump is measured
  against. If we cannot produce that number, we have no evidence the objective was met.

**Anti-goal.** Do not reduce the edit count by deleting behaviour, and do not reduce it by moving
code into a file we own that upstream then has no reason to call. Rule 2's "one call site" still
needs that one call site to exist and to be in the right place.

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

---

## 9. Upstream churn recon — the answer to §1b, measured

Explorer `8113746e` (deepseek v4.1, read-only, online). **[V]** = the orchestrator re-ran it.

### 9.1 How fast the surface we hold actually moves **[V — re-measured, matches]**

`upstream/master`, 2026-06-19 → 2026-09-19 (90 days):

| path | commits | days touched | last | our delta |
|---|---|---|---|---|
| `ggml/src/ggml-opencl/ggml-opencl.cpp` | **59** | **41 / 90 (46%)** | 09-18 | **+3124/−117** |
| `tests/test-backend-ops.cpp` | **106** | 55 | 09-19 | +640/−10 |
| `ggml/src/ggml-hexagon/` | 39 | 29 | 09-18 | +50/−4 |
| `ggml/src/ggml-opencl/kernels/` | 36 | 28 | 09-18 | +1913/−356 (our 6 files: 0 upstream touches) |
| `ggml/src/ggml-cpu/ggml-cpu.c` | 13 | 13 | 09-18 | part of the q23k cluster |
| `ggml/src/ggml-cpu/repack.cpp` | 2 | 2 | 09-10 | |
| `ggml/src/ggml-cpu/repack.h` | **0** | — | 2026-03-10 | |
| `ggml/src/ggml-cpu/traits.cpp` | **0** | — | 2025-08-06 | |
| **`ggml/include/ggml-cpu.h`** (our hook) | **1** | 1 | 2026-07-16 | our `expert_ready_hook` |

**This is the answer to §1b, and it is a single sentence: one file carries the whole recurring
cost.** 3124 of our ~5400 churn-exposed engine lines sit in a file upstream edits on 46% of
calendar days. Everything else we hold is either in files we own (never conflict) or in files
upstream has effectively frozen.

Two consequences that change the work:

1. **Our hook placement is already right.** `ggml-cpu.h` was touched **once in 90 days**. §1b rule 3
   said "consider upstreaming the hook"; the churn says **do not bother** — holding it as a patch
   costs nothing. This also agrees with the owner's standing decision (`PLAN.md`, 04/09):
   *"Non aprire nessuna issue upstream. O fixiamo noi stessi o lasciamo perdere."*
2. **The single highest-value refactor in this whole migration** is to move our Adreno MoE host
   code out of `ggml-opencl.cpp` into translation units we own, leaving a thin registration/glue
   delta behind. That is §1b rule 2 applied to the one file where it actually pays. Budget it as
   part of step 2, not as a later cleanup.

### 9.2 Is the `vendor/` layout settled? **Yes.** **[E]**

Four branches upstream (`main`, `auto/sync-llama.cpp`, `rpc`, `v0.9`); the last two predate the
restructure. **Zero open PRs touch `sync-vendor.sh`, `cmake/rnllama-sources.cmake`, the podspec or
the export manifest.** `#391`/`#392`/`#393` merged 12–14/09 with **no follow-up commits**; the last
commit to `cpp/jsi` or `cpp/rn-*` outside engine syncs is 2026-09-14. `-Wl,-Bsymbolic` is not being
dropped — `AGENTS.md:107` justifies it by whisper.rn coexistence. npm `0.13.0-rc.4` **already ships
the `vendor/` layout**.

One forward signal, inference only: `#392`'s body says *"we may can share ggml as library between
llama.rn and whisper.rn"*. No issue, PR or branch. If that ever happens the boundary moves again.

### 9.3 `b11010` is a clean pin and later ones are not — yet **[V, partly]**

**[V]** Upstream llama.rn **duplicates the OpenCL kernel list by hand**:
`android/src/main/rnllama/CMakeLists.txt:159` holds **179 names**, mirroring the **177** in
`vendor/llama.cpp/ggml/src/ggml-opencl/CMakeLists.txt`. **[E]** At `b11010` the two agree; at
`b11046` (open PR #400) upstream added `flash_attn_repack` and
`gemv_noshuffle_q6_k_f32_32b_trans` to the vendored list and not to llama.rn's copy, and the
Android build fails with `fatal error: 'gemv_noshuffle_q6_k_f32_32b_trans.cl.h' file not found`.

→ Two things follow. **`b11010` stays the target for step 2.** And **§7's decision to keep our glob
instead of upstream's hand list is now evidence-backed, not taste** — upstream's own mechanism is
failing on exactly this, today, in their own CI.

### 9.4 `LLAMA_CPP_REPO` works, but nobody exercises it **[E]**

`sync_dep()` honours it and `ensure_repo` clones it. But a code search across the `mybigday` org
returns **one** hit, and it is a **name collision** — `sync-llama-cpp.yml:102` uses
`LLAMA_CPP_REPO` as a local cache path, unrelated to the `VERSIONS` variable. No fork, no CI, no
docs exercise the real one. **We are the only user, so we own its rot.** This raises the priority
of step 7 (disable the cron) from hygiene to necessary.

### 9.5 The largest future conflict source is not in this migration at all **[E]**

Two open upstream PRs target exactly the four files our q23k cluster (+2192 lines) lives against:
**#23492** "ARM Repack kernels for Q1_0" (+762) and **#15719** "block repack support for Q4_K for
AArch64" (+939, open since January) — both touch `arch-fallback.h`, `arch/arm/repack.cpp`,
`repack.cpp`, `repack.h`. Those files are frozen *today*, which is why our delta there is cheap
*today*. Record this as a standing hazard in `KALSA_FORK.md`: the q23k cluster is cheap by luck of
timing, not by structure.

Also **[E]**, unverified and material: open PR **#28577** ("q2_K and q3_K matrix multiply", +3243)
has 2 hunks in `cvt.cl`, the first at `@@ -116,6` against our delta at `@@ -118,0` — **a direct
collision**, in our second-largest single-file change. It does not touch our 6 MoE kernel files.

### 9.6 Verdict **[E]**

> **Migrate now, but expect a second merge within ~2 weeks**, because llama.rn's auto-sync advances
> the pin every 1–6 days (time-to-merge median ~1.5 days over the last seven PRs) and #400 is
> already queued at `b11046`.
>
> **Recurring cost per bump: one hand-resolution session in `ggml-opencl.cpp`, plus a mechanical
> refresh of the duplicated kernel list.** The one change that most reduces it is §9.1 point 2.

Evidence that would overturn it: upstream replacing the hand-written `GGML_OPENCL_KERNELS` list
with a glob; `cvt.cl` or `gemm_moe_*` appearing in a merged upstream commit; a llama.rn PR
reopening the `cpp/` layout; or confirmation that #28577's hunks collide with ours, which would
move the target from `b11010` to a tag containing #28577.

---

## 10. Audit corrections — THIS SECTION SUPERSEDES THE BODY

Hostile audit `70d2c296` (deepseek v4.1), 19/09. Where §10 disagrees with §1–§9, **§10 wins**.
**[V]** = the orchestrator re-read it on disk.

### 10.1 The fourth error: `LLAMA_CPP_REPO` can be silently ignored **[V] CONFIRMED**

`sync-vendor.sh:209-222` keys the clone cache on the **dependency name**, never on the URL:
`local repo="$CACHE_DIR/$name"` (`:211`), `if [ ! -d "$repo/.git" ]` (`:213`), then
`git -C "$repo" fetch --quiet origin "$ref"` (`:232`). There is no `remote get-url` check anywhere.
So if `~/.cache/llama.rn/llama.cpp` already exists pointing at ggml-org — which it will, the first
time anyone runs the upstream script, **including our own first test of it** — flipping
`LLAMA_CPP_REPO` to our fork does nothing.

**[V] Refinement the audit did not make: how silent it is depends on how we pin.** `:225`
branches on `^[0-9a-f]{40}$`:

- **Pin by tag** (`LLAMA_CPP_REF=b11010`) → `rev-parse refs/tags/b11010` succeeds **in the ggml-org
  cache**, no fetch, no error → `vendor/llama.cpp` is populated from **upstream**, `record_commit`
  writes that sha, and step 3's `git status`-clean gate **passes**. Silent, total.
- **Pin by our fork's 40-hex sha** → `cat-file -e` fails in the ggml-org cache → `fetch origin
  <sha>` from ggml-org → fails → `set -e` aborts. **Loud.**

→ **Two rules, both mandatory.** (a) Assert `git -C "$repo" remote get-url origin` equals `$url`,
else re-clone. (b) **Always pin `LLAMA_CPP_REF` to our fork's commit sha, never to a tag name that
also exists upstream.** (b) is free and converts the trap from silent to loud even if (a) is ever
lost in a future upstream merge.

### 10.2 Corrections to the numbers **[E, re-derived by the auditor]**

| §  | said | actually |
|---|---|---|
| §2 | 20 files touched by both, 15 auto-merge | **19** touched, **14** auto-merge |
| §2 | 77 of 97 untouched | **78** |
| §2 | opencl 4 conflict hunks | **5** |
| §2 | `tests/CMakeLists.txt` 2 hunks | **1** |
| §1 | `vendor/llama.cpp` = 1515 files | **1368** (1515 is all of `vendor/`) |
| §1 | `third_party/` = OpenCL submodules | **committed headers only; there is no ICD loader in our tree at all** — we ship `bin/arm64-v8a/libOpenCL.so`; upstream *builds* it from `vendor/OpenCL-ICD-Loader`. **The plan never says what replaces it.** |
| §8 | delete `.gitmodules` | **already absent from our branch** |
| §9.3 | 179 vs 177 | **179 vs 179** base; with Adreno on, **196 vs 181**. Conclusion (keep our glob) unaffected; the cited evidence was wrong. |

**§2's +/− table is measured against `master`, not against `b11010` — the tree we are merging into.**
At `b11010` our opencl conflict is **1919/285**, not 2728/369: **37% smaller** than the plan
budgeted. The claim that the same five conflicts appear either way still holds.

### 10.3 §4's Hexagon row is wrong — "delete ours" loses behaviour **[V] REFUTED**

Our `ggml-hexagon.cpp:5230-5232` is `sess->flush();` … `return sess->error_count == 0 ? …`.
`b11010` has **zero** `sess->flush()` in the file — but that is a grep artefact, not the fact.
Upstream **renamed** it: `flush_sync(bool all = true)` is declared at `b11010:477`. Taking the
grep literally ("keep `sess->flush()`") would not have compiled. Upstream checks `last_error` at
the **top** of `ggml_backend_hexagon_graph_compute` (`:5855`), not at the end.

So the exchange is not "weaker duplicate → stronger duplicate". It moves error observation from
**synchronous at end of graph** to **deferred to the next call**, and drops a drain-before-status
barrier. → Resolve hunk 4 deliberately: keep the flush, adopt upstream's `last_error`. Hunks 1–3
are a genuine supersession.

Two more **[E]** corrections to §4: `ff7ae8009` is **not** a hexagon commit
(`tests: tighten NPU judge failure reporting`, one file under `tests/`), and our
`15ad4b8e3` — the HMX `%32` eligibility gate — is **ours, not superseded** (`b11010` still reads
`if (ne01_padded % 32 != 0) {`) and is missing from §4's "survives" list. It auto-merges, so today
it survives **by luck of git, not by decision**.

### 10.4 §1b needs three repairs **[E]**

1. **"New files we own never conflict" is false as an absolute.** They do not *merge*-conflict, but
   they can still be dropped by lists and manifests we do not own. This migration has three
   instances: `repack-q23k.h` (killed by the export manifest), our 6 MoE `.cl` kernels (dropped by
   `GGML_OPENCL_KERNELS`), and the `common.h.patch` basename we would newly occupy. Read the rule
   as: *free of merge cost, not free.*
2. **The gate is gameable.** §1b counts **edited files**; §9.1's action moves lines out of
   `ggml-opencl.cpp` and leaves the file count at 1. Doing nothing passes. → The metric is
   **lines changed and hunks in upstream-owned files**, not files.
3. **Rule 3 ("consider upstreaming the hook") is struck.** `ggml/include/ggml-cpu.h` took 1 commit
   in 90 days, and `PLAN.md` 04/09 says *"Non aprire nessuna issue upstream."* Holding it as a
   patch costs nothing. Leaving rule 3 in invites a future agent to do the forbidden thing.

### 10.5 §9.1's "highest-value refactor" is a 20% claim, not a highest-value one **[E]**

Measured shape of our +3124 in `ggml-opencl.cpp`: **77 hunks**, and the enclosing upstream-owned
functions account for **3123 of the 3124 added lines** (`moe_router_reoerder` 867,
`ggml_backend_opencl_buffer_set_tensor` 368, `ggml_cl_mul_mat_id` 353, …). Only **19–20 added
top-level definitions** (~280 lines) are free-standing, and they are the diagnostic helpers
(`ggml_opencl_log_alloc*`, `ggml_opencl_gemv_audit_*`, `ggml_opencl_env_*`, the oracle predicates).

**Realistic relocatable range: 300–800 of 3124 lines (10–25%), ~20 of 77 hunks.** → Do it, but
demote it from "the single highest-value refactor" and scope it to **the experiment scaffolding**,
which is what actually lifts out. The larger lever is §10.7.

### 10.6 The order is wrong: the plan is missing its own step 0 **[V] CONFIRMED**

`scripts/sync-vendor.sh`, `vendor/VERSIONS`, `cmake/rnllama-sources.cmake` and the `sync:vendor`
script **do not exist on our branch** — they arrive only with the merge of `upstream/main`, which
no step performs. So steps 3, 4 and 5 all consume the output of an unnamed step, and step 3's gate
is unrunnable when step 3 runs.

**Corrected order:**

| # | step | note |
|---|---|---|
| **0** | Fix `ensure_repo`'s cache identity (§10.1) and **disable the cron in the merge commit** | `sync-llama-cpp.yml` arrives *with* the merge; old step 7 was mis-sequenced |
| **1** | Extract the guards out of `sync-kalsallama.sh` | unchanged, but the gate is `assert_kalsa_post_image`'s "exactly once", **not a grep** — a double-applied patch passes a grep |
| **2** | **Merge `upstream/main` into `llama.rn-kalsa`** on a branch, old `cpp/` and new `vendor/` coexisting | this is the missing step; both trees can sit in the tree at once, so nothing is all-or-nothing |
| **3a** | Merge kalsallama → `b11010` | **runs fully in parallel, different repo, its gate needs nothing from llama.rn** |
| **3b** | Relocate the opencl scaffolding (§10.5) | separate step: a red 3b with a green 3a is diagnosable; both red together is not |
| **4** | Export manifest: `repack-q23k.h`; tests stay in kalsallama | |
| **5** | The `LM_` de-prefix, once | ELF `-Wl,-Bsymbolic` is **Android only**; on Apple the mechanism is the two-level namespace plus the per-library `GGMLMetalClass` `-D` rename |
| **6** | App glue | |
| **7** | Re-point `LLAMA_CPP_REPO`, sync | |
| **8** | Delete | |

### 10.7 The largest lever is a cadence, and it is free **[E]**

Never be more than one upstream release behind. That turns a 245-commit merge into N 20-commit
merges, each cheap, with the supersede check (§1b rule 5) run each time. Larger than any refactor
in §9.1, and it costs nothing but discipline. Record per bump, in `KALSA_FORK.md`, one line:
date, `upstream/master` sha, lines changed in upstream-owned files per repo, hunk count,
`merge-tree` conflict count. §1b asked for a baseline without fixing the unit or the file, so the
next bump would have measured something else.

### 10.8 Gates that a broken implementation passes **[E]** — fix before executing

- **Step 3a's `test-backend-ops` gate.** The harness enumerates **registered** backends: if OpenCL
  fails to register, its cases simply do not run and the suite exits **green** — a CPU-only pass of
  a GPU correctness test. → The gate must name the backend and **assert the executed q4_K
  `MUL_MAT_ID` case count against a recorded baseline**.
- **Steps 5 and 6's gates** name no command, no expected value and no place to record the result.
  As written they are intentions.
- **Steps 7 and 8 have no gate at all**, and step 8 deletes the tree that
  `assert-overlay-includes.sh` and `assert-native-patch.sh` consume.

### 10.9 Missing: rollback, shippability, same-engine **[E]**

- **Rollback target exists only by accident.** The app pins `95c3493b`, which is exactly
  `v0129-on-gate`. → **Tag it** and say so; it is the only way back to the shipping engine once
  step 8 deletes `sync-kalsallama.sh`, `kalsa-patches/` and `cpp/`.
- **Shippability rule, previously unstated:** the app's pin is never advanced until the fork is
  green, and step 8 lands on a branch the app does not pin.
- **What proves it is the same engine.** Nothing in the plan. The digest cannot do it — it is
  *defined* to change. → `scripts/assert-native-patch.sh` (both markers in `librnllama*.so`) **plus
  a fixed prompt and seed producing token-identical output** against the pre-migration APK
  (`/Users/marco/kalsa-apks/35444615003/app-release.apk`, sha256 `ea6165eb…`).
- **Step 1 would overwrite upstream's own patches.** Our `kalsa-patches/common.{cpp,h}.patch` share
  basenames with upstream's `scripts/patches/llama.cpp/common.{cpp,h}.patch`, which carry
  `vocab_only`, `progress_callback`, `progress_callback_user_data` and
  `reasoning_budget_activate_immediately`. **The regenerated patch must be the union**, or we
  delete three upstream features.
- **npm:** `package-lock.json` resolves `git+ssh://` while `package.json` says `git+https://`; any
  pin bump needs lockfile regeneration plus SSH in whatever CI runs `npm ci`.

---

## 11. Step "merge `b11010`" — executed, audited, verdict

Branch `b11010-merge`, commit `6b6d4a980`. Parents `2361be359` (ours) + `4bc272fd7` (`b11010`),
0 behind / 152 ahead, tree clean. Hostile audit by a different model (Luna, xhigh) plus my own
on-disk verification of every load-bearing claim.

### 11.1 Verdict: the merge stands

The auditor returned "do not approve". Three of its four blocking findings do not survive
verification against the parents:

| Audit finding | Verified outcome |
|---|---|
| CTest registration of `test-backend-ops` lost | **Upstream's own change.** `4bc272fd7:tests/CMakeLists.txt:310` is already `llama_build(test-backend-ops.cpp)`; ours at `2361be359:300` was `llama_build_and_test`. Upstream also removed the `test-backend-ops-metallib-tensor` registration. The merge took upstream's side, which is the point of the migration. |
| Hexagon `last_error` is a session-wide latch, not a per-graph reset | **Upstream's own model.** `4bc272fd7` resets `last_error` only at session alloc (`:3691`) and already rejects later graphs at `:5855`. Our `error_count = 0` per-graph reset disappeared because we adopted upstream's error model wholesale. |
| `%64 != 0 ⇒ %4 != 0` implication is backwards | **True, but the claim is not in the tree.** It was in the implementer's report prose. The committed comment justifies `%64` correctly: the predicate must be the exact complement of `use_adreno_kernels()`'s `%64 == 0`, because it also selects the `set_tensor` convert kernel. |
| The bin-kernel path keeps the literal-mask ABI | **CONFIRMED, and pre-existing** — see §11.3. Present at `2361be359:27055`, not introduced by the merge. |

The merge added exactly three lines to `ggml_backend_hexagon_graph_compute`: the drain comment and
`sess->flush_sync()` before the status check. That drain is **ours**, carried over faithfully —
`2361be359` had `sess->flush()` with the same comment at the same place. Upstream checks
`last_error` without draining first.

Also verified intact: 61 host mask bindings + 5/7 in the two MoE kernels, `%64` rule at `:9095`
with no `%128` residue, 7 governor sources in `src/CMakeLists.txt`, `ggml_opencl_oracle_q4_0`
reconstructed byte-identically, the HMX `%32` gate, and the `use_q4k_tiled()` deferral at the head
of `use_flat_gemv_for_large_m_q4_K` (`:9477`).

### 11.2 The gate is a false pass, and it is reproducible

`./build/bin/test-backend-ops -o MUL_MAT_ID -p 'type_a=q4_K'` → **93 cases enumerated, 0 executed,
exit 0**, because BLAS reports every case `not supported` and the harness skips-then-succeeds
(`tests/test-backend-ops.cpp:12306-12307`, `:12365`). With `-b CPU`: 93 executed, 93/93, exit 0 —
which proves only that the CPU agrees with the CPU reference (`:12272`). The Mac build has
`GGML_OPENCL:BOOL=OFF` and the Apple device is rejected by the backend. **No OpenCL correctness
claim can be made off-device.** The gate is taken on the S23.

### 11.3 Two pre-existing correctness holes found while verifying (NOT merge regressions)

Both live in `ggml-opencl.cpp` / its kernels — the highest-churn file we own (46% of days, +3124
of our lines), so they are fixed now rather than re-derived at the next rebase.

**(a) Unguarded stores under a padded dispatch grid.** The decode GEMV grid is
`CEIL_DIV(ne01/2 | ne01/4 | ne01, 64)*64` (`ggml-opencl.cpp:22674`), so lanes exceed output rows
whenever the divided extent is not a multiple of 64. The base kernel guards this and says so
(`gemv_noshuffle_q4_k_f32.cl:338-339`). Its siblings, dispatched from the same grid, do not:

- `gemv_noshuffle_q4_k_f32.cl:482-483` — **fused gate+up GLU GEMV, production default.** Needs
  `ne01 % 128 == 0`; its only gate is `use_adreno_kernels()` (`:8645-8648`), which admits
  `% 64 == 0`. An FFN dim of 2880 writes 64 floats past `dst`.
- `gemv_noshuffle_q4_k_f32_o4.cl:346` — **lm_head GEMV, default ON** (`:22520`, opt-out
  `GGML_OPENCL_Q4K_GEMV_O4=0`). Gated at `ne01 % 4 == 0 && ne01 >= 32768`; grid needs
  `% 256 == 0`. A 151936 vocab passes the gate and overruns.
- `gemv_noshuffle_q4_k_f32.cl:819-821` and `gemv_noshuffle_q6_k_f32.cl:405-407` — the mc3 twins,
  opt-in only (`GGML_OPENCL_Q4K_MC3`).

Small overruns of this kind usually land in allocator padding, which is why they have never been
seen. That is not a reason to keep them.

**(b) A false committed comment hiding an E031 escape hatch.** `ggml-opencl.cpp:28613-28623`
binds the three masks only when the ILA binary kernel is absent, and the comment asserts
"this tree compiles them out". `ggml/src/ggml-opencl/CMakeLists.txt:36` makes
`GGML_OPENCL_USE_ADRENO_BIN_KERNELS` a build option: turning it on silently reinstates the
literal-mask signature that E031.41.03.62 miscompiles — **wrong numbers, not a crash**. The
option must fail loudly at build time, and the comment must say what is true.

### 11.4 Consequences for the plan

- §10.6's step order is unchanged; the merge was its step 2 prerequisite and is done.
- **New gate constraint:** upstream de-registered `test-backend-ops` from CTest, so a green
  `ctest` run can never cover it. Any gate that names it must invoke the binary directly, with
  `-b` naming the backend and an asserted executed-case count (§10.8 already requires this).
