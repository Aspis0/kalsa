> ## ⚠ ADDENDUM F17 — step B is ALREADY IN FLIGHT in this checkout, unresolved
>
> Found at the end of this audit. **Read this first.** The step A report says
> step B "waits for the coordinator's go". It is not waiting. It is running now,
> uncommitted, in `~/Projects/kalsallama`, and it is broken.
>
> - This working tree was **clean** (`?? CMakeUserPresets.json` only) at the
>   first command of this audit session. It is now mid-merge. The merge started
>   *during* this audit, from another session, in the same checkout.
> - `MERGE_HEAD = 81ff93ea1d48c0482508d30e75b814df99c25bf0` = tag **`b11304`**,
>   *"llama: properly handle KV on training (#28520)"* — exactly the tag the step
>   A report reserved for step B. `MERGE_MODE = no-ff`. `HEAD` is still
>   `5de9fa2fc`; nothing is committed.
> - **7 conflicts declared in `.git/MERGE_MSG`, 5 still unmerged, 3 staged as
>   resolved — and the two sets do not agree.**
>
> | file | in MERGE_MSG | unmerged now | markers on disk |
> |---|---|---|---|
> | `ggml/src/ggml-cpu/ggml-cpu.c` | yes | **yes** | **0** |
> | `ggml/src/ggml-cpu/repack.cpp` | yes | yes | 2 |
> | `tests/CMakeLists.txt` | yes | yes | 2 |
> | `tests/test-backend-ops.cpp` | yes | yes | 2 |
> | `tools/llama-bench/llama-bench.cpp` | **no** | **yes** | **36** |
> | `src/llama-context.cpp` | yes | no (staged) | — |
> | `src/llama-memory-hybrid.cpp` | yes | no (staged) | — |
> | `src/llama-model.cpp` | yes | no (staged) | — |
>
> **F17a — CONFIRMED — the step B conflicts land on precisely the three files
> this audit's load-bearing findings live in.** `src/llama-memory-hybrid.cpp`
> (F2/F8, `shared_fence`), `src/llama-model.cpp` (F3, the `mem_other` routing at
> `:2758`/`:2817`/`:2892`), `src/llama-context.cpp` (F1, the `ctx_other` producer
> at `:393`). Whoever resolves them is resolving the exact semantics §1 says are
> still open — with no audit having been read. The staged resolutions are large
> and unreviewed: `llama-model.cpp` +153/−9, `llama-context.cpp` +159/−55.
>
> **F17b — CONFIRMED — the staged `llama-memory-hybrid.cpp` resolution preserves
> the defect.** In the index version, `shared_fence` is intact and unmoved:
> definition at `:88`, and all nine call sites — `:98` decode, `:163` memory
> update, `:175` clear, `:183` seq removal, `:195` seq copy, `:203` seq keep,
> `:211` seq shift, `:219` seq division. So the step B resolution as staged
> **does not** lift the hybrid fence, and `test-governor-v0-shared-cells` will
> still fail the same way after step B. Upstream is now also touching this file,
> so the fence is contested three ways and nobody has written down which
> semantics won.
>
> **F17c — CONFIRMED — `ggml/src/ggml-cpu/ggml-cpu.c` looks resolved on disk but
> is not in the index.** 0 conflict markers in the working file, but
> `git ls-files -u` still shows 3 unmerged stages. Whatever is on disk there is
> unreviewed and unstaged; a `git commit -a` or a selective `git add` would take
> it in unchecked.
>
> **F17d — CONFIRMED — a rejected hunk is sitting on disk.**
> `ggml/src/ggml-cpu/ggml-cpu.c.rej`, 2356 bytes, dated Sep 30 21:09, from a
> failed `git apply`/`patch` during the conflict. It contains hunks that are
> **not** in the file:
> ```
> +#include "ggml-cpu.h"
> +#include "repack-q23k.h"
> @@ -1669,6 +1977,12 @@ static void ggml_compute_forward_mul_mat_id(
> ```
> Meanwhile `ggml/src/ggml-cpu/iqp.c` and `iqp.h` are staged as **deleted** in
> the same merge. So someone was hand-patching includes to make the file build
> after the `iqp` removal, the patch did not apply, and the hunk is now only in
> a `.rej` file that no build will ever read. Silent capability loss.
>
> **F17e — CONFIRMED — `tools/llama-bench/llama-bench.cpp` has 36 conflict
> markers and is not in MERGE_MSG's conflict list**, so it became conflicted
> after the message was written. The declared conflict set is stale; nobody can
> trust it to enumerate what is outstanding.
>
> **Recommendation:** whoever owns step B should `git merge --abort` and restart
> from `5de9fa2fc` with a clean tree, or finish it deliberately with F1–F5 and
> F17b–F17d in hand. Nothing was staged, added, aborted or committed by this
> audit; all commands above were read-only.

---

# Hostile audit — engine single line (step A merge)

Target: `Aspis0/kalsallama` @ `5de9fa2fc` (`main` = d389de2fb × d07d0181b).
Merge base: `833cde99b` "server : stamp the cache namespace on a restored slot".
Auditor read-only. Nothing edited, built, committed, delegated.
Verdict: **FIX FIRST** — not for the merge's text, which is provably clean, but
because main now ships two mutually exclusive runtime contracts and one dead
test assertion, and the report that certified it does not say so.

---

## 0. What the merge actually is (settles angle 4 first)

`comm -12` of the two sides' changed-file sets is **empty**.

| side | files changed since base |
|---|---|
| d389de2fb (old main: desktop v1.1.3 / Gemma MTP / vcredist) | 9 |
| d07d0181b (feat/governor-platform-status) | 33 |
| **intersection** | **0** |

Union proof, both directions:

```
$ for f in $(cat /tmp/main_files.txt); do git diff --quiet d389de2fb 5de9fa2fc -- $f || echo "DIFFERS-FROM-MAIN: $f"; done
$ for f in $(cat /tmp/feat_files.txt); do git diff --quiet d07d0181b 5de9fa2fc -- $f || echo "DIFFERS-FROM-FEAT: $f"; done
(no output)
```

**CONFIRMED — angle 4 (removed behavior): zero findings.** All 9 of main's
files are byte-identical to main's tip; all 33 of feat's are byte-identical to
feat's tip. The merge is a pure union. Nothing present in either parent is
absent from the merge. The writer's "clean, zero conflicts" is textually true
and, unusually, provable rather than asserted. Every finding below is
*semantic*, not textual.

---

## 1. Semantic interactions between the two lines

### F1 — CONFIRMED — BLOCKER (narrative) — the two halves of `main` cannot run in the same session

`src/llama-governor.cpp:34-36`:

```cpp
    if (params_prefill.ctx_other || params_decode.ctx_other) {
        throw std::runtime_error("governor contexts must have independent KV caches");
    }
```

This is the load-bearing line for the whole audit. `ctx_other` is the **only**
producer of shared KV cells in the engine. Traced end to end:

- `src/llama-context.cpp:393` `/*.mem_other =*/ llama_get_memory(cparams.ctx_other)`
- `src/llama-model.cpp:2817` `/* mem_other */ params.mem_other,` → `llama_memory_hybrid`
- `src/llama-model.cpp:2892` `res = new llama_kv_cache_iswa(` → Gemma-4 assistant
- `src/llama-memory-hybrid.cpp:54` `shared(mem_other != nullptr),`

`src/llama-governor-device.cpp` (feat's new file) is memory-free — grep for
`kv_cache|memory|llama_kv` returns nothing. So the NPU lane, the platform-status
classifier and the bench-route override never touch a shared cell.

**Failure scenario:** the desktop's headline feature of this merge is Gemma-4
assistant MTP, which *requires* `ctx_other`. The phone's headline feature is the
governor, which *throws* if `ctx_other` is set. Wiring MTP into the phone is not
a tuning problem; it is a hard `std::runtime_error` at governor construction.
Conversely, running the governor with the drafter attached is impossible.
"main is the single engine line for phone and desktop" is a **repository**
fact, not a **runtime** one. The report presents the merge as two lines joining
into one product; it is two disjoint feature sets now sharing one binary, with a
constructor that enforces the disjointness. Nobody wrote that down.

### F2 — CONFIRMED — the phone's own model family is the fenced one

`src/llama-arch.cpp:1091-1092`, inside `llm_arch_is_hybrid`:

```cpp
        case LLM_ARCH_LFM2:
        case LLM_ARCH_LFM2MOE:
```

The ship GGUF used for the whole governor battery is
`~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`. LFM2 is hybrid →
`llama_model.cpp:2800-2817` builds `llama_memory_hybrid` with
`/* mem_other */ params.mem_other` → `src/llama-memory-hybrid.cpp:54`
`shared(mem_other != nullptr)`.

`src/llama-memory-hybrid.cpp:88-94` (untouched since base — verified, zero
commits in `833cde99b..5de9fa2fc` for `src/llama-memory-hybrid.{cpp,h}`):

```cpp
bool llama_memory_hybrid::shared_fence(const char * operation) const {
    if (!shared) {
        return false;
    }
    LLAMA_LOG_ERROR("%s: %s is not allowed from shared hybrid memory (recurrent state is owner-only)\n",
                    __func__, operation);
    return true;
}
```

fired from `:98` `if (shared_fence("decode"))` and `:163`
`if (shared_fence("memory update"))`, both returning
`LLAMA_MEMORY_STATUS_FAILED_PREPARE`.

**main lifted 9 fences in `llama_kv_cache` and 0 in `llama_memory_hybrid`.**
The mirror is unreachable for LFM2 — i.e. for the phone's model. The comment
main's own test author wrote at `tests/test-governor-v0-shared-cells.cpp:131`
concedes it: *"the recurrent tail is owner-only, so the non-owner's position
view is the shared attention cells; the hybrid wrapper folds in an empty recr
max"*.

### F3 — CONFIRMED — the rewritten test validates **no shipping MTP path**

`tests/test-governor-v0-shared-cells.cpp:100-107` builds `ctx_b` with
`params.ctx_other = other` on the *same* hybrid model, i.e. it exercises
`llama_memory_hybrid` — the class fenced at F2.

The class the Gemma-4 assistant actually uses is different.
`src/llama-model.cpp:2877-2892`:

```cpp
                        if (arch == LLM_ARCH_GEMMA4_ASSISTANT) {
                            llama_memory_t mem_other = llama_get_memory(cparams.ctx_other);
                            share = [&](int32_t il) { ... };
                            res = new llama_kv_cache_iswa(
```

`src/llama-kv-cache-iswa.cpp` has **no `other` member, no fences, and its own**
`clear` (:117), `seq_rm` (:122), `seq_cp` (:131), `seq_keep` (:136),
`seq_add` (:141), `seq_div` (:146), `init_batch` (:168), `init_update` (:258),
`state_write` (:268), `state_read` (:276). It delegates to two `llama_kv_cache`
leaves. `src/llama-kv-cache-iswa.cpp` and `.h` were **not touched by either
side** since the base.

**Failure scenario / status:** main's mirror semantics are asserted only against
a memory class that (a) is fenced and (b) is not the assistant's class. The
assistant's class has no mirror work at all. The test is green/red for reasons
that say nothing about the feature it was written for. This is main's debt, not
merge-caused — but the merge is what promotes it onto the single line, and the
report's phrase "the mirror work is half-landed" understates it: on the
assistant's actual memory class it is **zero**-landed.

### F4 — PLAUSIBLE — `seq_rm` now lies about success, contradicting feat's new public contract

`src/llama-kv-cache.cpp:427-430` (main; was `LOG_ERROR` + `return false`):

```cpp
    if (other) {
        return true;
    }
```

feat added a public API whose entire contract is built on that return value.
`src/llama-ext.h:453-465`:

```cpp
/**
 * Rewind sequence 0 on both governor contexts, removing [p, end) where
 * supported. If both sides trim exactly, lower both commit watermarks to
 * min(watermark, p). If a side cannot be trimmed exactly, clear that side's
 * sequence entirely and reset both watermarks to zero after a successful
 * clear. Callers that trim a governor context's KV for prefix reuse MUST use
 * this instead of a raw llama_memory_seq_rm on one context, or the next phase
 * handoff fails with "watermark is invalid" and the other context keeps stale
 * cells. Returns false if the governor has failed or a required full clear
 * could not remove the sequence.
 */
LLAMA_API bool llama_governor_trim_sequence(
```

`false` from `seq_rm` means "this side cannot trim exactly → fall back to a full
clear and zero the watermarks". main changed that predicate's meaning for shared
caches: it now reports "trimmed exactly" for a removal that did not happen.

**Failure scenario:** not reachable today — F1's ctor throw means a governor
context is never shared. It becomes live the moment anyone wires MTP into the
governor, which is the obvious next step for a "single line". Then
`trim_sequence` takes the exact-trim branch, lowers both watermarks, and the
other context keeps stale cells — the precise failure the header warns about,
now reached through the API the header tells you to use. Two halves of one
binary encode contradictory contracts about the same function.

### F5 — PLAUSIBLE — shared-view state IO is a silent no-op with a once-per-process warning

`src/llama-kv-cache.cpp:2134-2143` (main; was `throw`):

```cpp
    if (other) {
        static bool warned = false;
        if (!warned) {
            warned = true;
            LLAMA_LOG_WARN("%s: kv cache %p is a shared view - it carries no state of its own, "
                           "the source cache's state IO covers its tensors\n", __func__, (void *) this);
        }
        return;
    }
```

Same shape at `:2221-2230` for `state_read_sinfo`.

**Failure scenario:** a session save that captures the assistant context without
the target writes a blob whose `llama_state_seq_get_size_ext` no longer counts
the shared cells, and the API returns **success**. Restoring yields an empty
drafter KV with no error. The `static bool warned` makes it worse: the first
save in the process logs a warning, every later save in the same process logs
**nothing at all**, so a long-lived app degrades silently. Design intent
(arguably sound — the source covers the tensors) but the diagnostic is
per-process, not per-save, and the size/return-value contract no longer tells
the caller that cells were dropped.

### F6 — CONFIRMED — main's kv-cache changes are provably inert for the phone

Every hunk in main's 96-line `src/llama-kv-cache.cpp` diff is inside
`if (other)` or a `share`-guarded branch, except two. Both exceptions are
provably no-ops when `other == nullptr`:

- ctor `:90` `v_cells_impl(other ? other->v_cells_impl : std::make_shared<llama_kv_cells_vec>())`
  — the view *shares* the cell store. This is what makes F5's clear assertion
  and main's own comments coherent; also means a shared view's `v_cells` are
  the owner's, while `v_heads` are per-cache.
- `find_slot` `:1068` `uint32_t head_cur = v_heads[seq_to_stream[seq_id]];`
  replaced `const auto & heads = other ? other->v_heads : v_heads;`. For a
  non-shared cache the old expression already evaluated to `v_heads`. Byte-for-byte
  identical behavior.

Same for `llama-model.cpp`: the only main hunk is
`has_mtp_weights()` returning `true` for `LLM_ARCH_GEMMA4_ASSISTANT` — never
reached on the phone.

**So: the merge introduces no behavior change on the phone governor path.** That
is the strongest defense of the merge and the report never argues it. Had it
been argued, F1–F5 would read as "two features that never meet" rather than "two
features that will meet badly later".

---

## 2. The writer's two test failures

### F7 — v0-devices: claim CONFIRMED, framing REFUTED

Claim: `tests/test-governor-v0-devices.cpp:241` requires both staged and naive,
fails on both parents, not merge-caused.

Verified, the assertion exists on both parents (`git show d389de2fb:...` line
240, merged line 241):

```cpp
    if (stats.commit_staged_count == 0 || stats.commit_naive_count == 0 || stats.commit_us == 0) {
        std::fprintf(stderr, "governor-devices: automatic staged/naive selection missing\n");
        return false;
    }
```

**CONFIRMED** that it fails on both parents and is not merge-caused.

**REFUTED — "pre-existing, not merge-caused, move on".** The staged counter is
filled at `src/llama-governor.cpp:143`:

```cpp
        stats_.commit_staged_count += mode == llama_kv_commit_mode::Staged;
```

and the mode is chosen by `llama_kv_context_can_stage_v()` —
`src/llama-kv-commit.h:8`:

```cpp
// Exact predicate used by governor auto-selection: staged V requires transposed, device-resident V.
```

The predicate needs **transposed, device-resident V**. A Mac host build has
neither. **The assertion is structurally unsatisfiable on any host build without
a transposed-V device** — it is not a flaky or environment-sensitive check, it
is a device test registered in the host battery. It will fail on every developer
machine and every host CI runner, forever.

**Failure scenario / why this matters for the merge:** this is the only
registered test that would catch the governor silently losing its staged-commit
path on the phone, where the predicate *is* satisfiable. As written it fires
only where the feature cannot exist and stays silent where it matters. The
writer's own note — *"REPOS.md's standing matrix `0 0 77 77 0 0 0` is stale
against both tips"* — is the tell: the coordinator's expectation table and the
test have both drifted and the merge inherits the drift. Normalizing a stale
expectation table is not the same as fixing it, and the report does the former
while calling the failure "pre-existing".

### F8 — v0-shared-cells: root cause CONFIRMED, and better than the writer knew

Writer: main's own half-landed mirror work; `llama-memory-hybrid.cpp:88` still
fences; not merge-caused.

Every element verified:
- 4 rewriting commits, exactly as claimed: `56e1beecd`, `604824d90`, `9f8a2b44a`,
  `a0cc09109` (`git log --oneline 833cde99b..d389de2fb -- tests/test-governor-v0-shared-cells.cpp`).
- `src/llama-memory-hybrid.cpp` untouched since base (zero commits).
- feat carries the base fence-era test **byte-identical**
  (`git diff --quiet 833cde99b d07d0181b -- tests/test-governor-v0-shared-cells.cpp` → identical).

**CONFIRMED, with the exact predicted failure line.** The new check at
`tests/test-governor-v0-shared-cells.cpp:141-144`:

```cpp
        if (!decode_one(ctx_b.get(), tokens.back(), static_cast<llama_pos>(tokens.size()))) {
            std::fprintf(stderr, "shared-cells: non-owner decode failed on live cells\n");
            return false;
        }
```

is the first check to touch `ctx_b`'s memory after the head-continuity assert
(which passes, because `v_cells_impl` is shared — F6). `ctx_b` is a hybrid, so
`llama_memory_hybrid::init_batch` → `shared_fence("decode")` →
`FAILED_PREPARE` → `llama_decode` != 0. Expected stderr:
`shared-cells: non-owner decode failed on live cells`.

Two escalations the writer missed:
1. Per **F2**, this is not an incidental test-model problem: the test model is
   the phone's ship model family. The mirror is fenced exactly where the product
   needs it.
2. Per **F3**, the test also does not cover the assistant's real memory class.

**Evidence destroyed:** the report's decisive proof — *"The merge log is
byte-identical to main's tip (`diff` empty)"* — rests on detached worktrees and
build dirs the report says it removed. That claim is now unfalsifiable. It is
probably true, but the coordinator cannot check it. Keeping the two parent
builds (or the three logs) would have cost nothing.

### F9 — Can the phone governor path reach the shared fence? **NO — CONFIRMED**

Answered positively by F1. `ctx_other` is the sole source of `mem_other`; the
governor constructor throws on it; `llama-governor-device.cpp` is memory-free.
There is no path from `llama_governor*` to a shared `llama_kv_cache` or a shared
`llama_memory_hybrid`. The fence at `llama-memory-hybrid.cpp:88` is reachable
only through `llama_context_params::ctx_other`, i.e. only through the
drafter/MTP line. **The merge cannot break the phone through this path.**

---

## 3. Build / config

### F10 — CONFIRMED — nothing one line needs was removed by the other

Angle 3, negative result, verified:
- feat's only `src/CMakeLists.txt` change is an **addition**:
  `+    llama-governor-device.cpp` to `LLAMA_CORE_SOURCES`.
- feat's `tests/CMakeLists.txt` change is **additive only**: 6 new governor
  registrations plus an `if (GGML_OPENCL)` include-dir fix for
  `test-opencl-moe-roundtrip`. main did not touch `tests/CMakeLists.txt`, so no
  registration was lost. 8 governor targets at `d389de2fb` → 14 at the merge
  (writer's counts both correct).
- No CMake option removed by either side. No Android flag removed.
- The OpenCL include fix is correctly paired with the new code's own guard
  (`tests/test-opencl-moe-roundtrip.cpp` `+#ifdef GGML_USE_OPENCL` /
  `+#include "cl-program-cache.h"`), so a non-OpenCL build is safe. The writer's
  host build was Metal and would not have covered this; the Android OpenCL build
  did.
- `kalsa-server.yml` (main, 9 commits — **the writer never inspected it**) builds
  CPU/Vulkan with `LLAMA_BUILD_TESTS=OFF`, no `GGML_OPENCL`, no governor, no
  Hexagon. Its defines are `-DGGML_NATIVE=OFF -DGGML_BACKEND_DL=ON
  -DGGML_CPU_ALL_VARIANTS=ON [-DGGML_VULKAN=ON]`. It cannot reach feat's OpenCL
  or governor work. Clean.

### F11 — CONFIRMED — `AHardwareBuffer_allocate`: pre-existing, and **not** a blocker

The symbol is real. `src/bmoe/platform_io.cpp:398`:

```cpp
    if (AHardwareBuffer_allocate(&d, &buf) != 0 || !buf) return false;
```

Reaches the shared library: `src/CMakeLists.txt:11`
`file(GLOB LLAMA_BMOE_SOURCES "bmoe/*.cpp")`. No engine `CMakeLists.txt` links
`android` — the only hit repo-wide is the upstream example
`examples/llama.android/lib/src/main/cpp/CMakeLists.txt:55`.

Pre-existing verified: `git diff --stat 8537d097c 5de9fa2fc -- src/bmoe/platform_io.cpp`
is empty, and `git merge-base --is-ancestor 8537d097c 5de9fa2fc` → yes.

**The writer's "presumably" is checkable, and it checks out.** The delivery chain
does link it — `~/Projects/kalsa/node_modules/llama.rn/android/src/main/CMakeLists.txt:77`
and `:85`, both `android` in `target_link_libraries(${jni_name} PRIVATE ...)`.
**REFUTED as a ship blocker; CONFIRMED as a real engine constraint** — the engine
alone cannot produce a loadable `libllama.so` on Android, and the only reason
delivery works is one line of the binding's CMake. Worth writing down somewhere
durable; the report leaves it as a "presumably".

### F12 — CONFIRMED — the "shipped pin" in the report is wrong, and it matters

The report reasons about *"the shipped pin `8537d097c`"*. The binding actually
installed in the app pins:

```
~/Projects/kalsa/node_modules/llama.rn/vendor/VERSIONS
LLAMA_CPP_COMMIT=d07d0181b3249189c6132e0c9d669ec7164de6cc
```

That is **d07d0181b — the feat tip**, an ancestor of the merge.
(`REPOS.md` carries the same stale `8537d097c`.)

Two consequences the report never states:
1. **The merge changes nothing for the delivered app.** The app already builds
   the feat line. This materially lowers the merge's real risk and should be the
   first line of the report, not a footnote.
2. `main` is therefore *behind* what ships for the phone and *ahead* for the
   desktop. "Single line" describes the repo, not any deployed artifact.

### F13 — CONFIRMED — a clean clone of `main` cannot configure the phone build

`PREBUILT_LIB_DIR` (mandatory; the Hexagon SDK's `hexagon_fun.cmake` does
`string(FIND)` on it) exists in exactly two places:

- `CMakeUserPresets.json:22` — **untracked, and not gitignored**
  (`git ls-files --error-unmatch` fails; `git check-ignore -v` returns nothing)
- `docs/backend/snapdragon/CMakePresets.json` — tracked, but CMake only reads
  presets from the source-dir root, and the copy step is manual:
  `docs/backend/snapdragon/README.md:46` and `.github/workflows/release.yml:579,636`
  all run `cp docs/backend/snapdragon/CMakeUserPresets.json .`

**The writer's only successful phone build consumed the untracked file they
explicitly declared a deviation for and declined to commit.** Their
"Android arm64 EXIT=0" is not reproducible from the merge commit alone. Not
merge-caused, but it is now the single line's problem, and the report's
"declared deviation" framing lets it pass as housekeeping.

---

## 4. The report's own defects

### F14 — CONFIRMED — the both-intent verification undercounted 9 files as 6

The report: *"`git diff HEAD origin/feat/...` differs from feat in exactly 6
files."* Actual: **9**.

```
$ git diff --name-only d07d0181b 5de9fa2fc
.github/workflows/kalsa-server.yml
common/speculative.cpp
ggml/src/ggml-cpu/ggml-cpu.cpp
src/bmoe/expert_stream_source.cpp
src/bmoe/expert_stream_source.h
src/llama-kv-cache.cpp
src/llama-model.cpp
src/llama-model.h
tests/test-governor-v0-shared-cells.cpp
```

The three omitted are the three that matter most: the workflow (9 commits), the
drafter entry point (`common/speculative.cpp`, where main's fix
`llama_model_load_from_file(params.model.path...)` →
`llama_model_load_from_file(model_path...)` makes the drafter load the *draft*
file rather than the target), and the failing test. The conclusion ("nothing
from feat was dropped") is still correct — I proved the union independently
(§0) — but the check as written did not examine the files carrying the merge's
substance. Per-file commit counts the report quotes (main=1, main=2, main=6,
main=1) do match.

### F15 — CONFIRMED — the baseline line contradicts the report's own table

The report, under "Build + test": *"Baseline at `d389de2fb` (5 tools + 8
governor targets): **EXIT=0**."* The same report's table: v0-devices `1` and
v0-shared-cells `1` at `d389de2fb`. (The count 8 is correct — verified.) The
baseline EXIT=0 was a build-only result presented inside a test section; read
cold, it says "all tests passed on main". A coordinator skimming for regressions
reads green.

### F16 — PLAUSIBLE — the platform-thermal feature is inert in the delivered app

feat's `src/llama-ext.h:278-289` adds `int32_t platform_thermal_status = -1;`
to `llama_governor_thermo_profile` and says so itself: *"The binding vendors the
engine and compiles against this header, so the default -1 keeps an unaware
caller at 'absent' ... until it does the status stays absent."* The installed
binding passes only `llama_governor_engine`, `llama_governor_params`,
`llama_governor_thermal_state`, `llama_governor_thermo_profile` by value and
never populates the field. The report's title and the coordinator's framing
("platform status" on the single line) describe an engine capability with no
producer in the shipped app. Expected, and the header is honest about it — but
it belongs in the report's "not verified" list, and it is not there.

---

## Verdict

**FIX FIRST.** Not because the merge is wrong — it is provably a clean union
with zero removed content (§0) and provably inert on the phone path (F6). Because:

1. **F1** is undocumented and load-bearing: the desktop MTP feature and the phone
   governor are mutually exclusive by constructor. This must be in writing before
   anyone attempts to unify them, or the next step hits a `throw`.
2. **F2 + F3**: main's mirror work is fenced exactly on the phone's model family
   and absent on the assistant's actual memory class. The test that "proves" it
   exercises neither. The report's "half-landed" is too kind.
3. **F7**: `test-governor-v0-devices` asserts a device-only property in the host
   battery — unsatisfiable on every host, silent on the phone where it matters.
4. **F4 + F5**: two latent traps armed for whoever wires MTP into the governor.
5. **F13**: the single line's phone build is not reproducible from a clean clone.

Ship-able as a *repository state* once F1 is written down and F7 is relabelled
as a device test (or moved). Not ship-able as the claim "phone and desktop on one
line" until F2/F3 are resolved — that claim is currently false at the capability
level.

### Findings index

| # | verdict | severity | file:line |
|---|---|---|---|
| F1 | CONFIRMED | blocker (narrative) | `src/llama-governor.cpp:34-36` |
| F2 | CONFIRMED | blocker (capability) | `src/llama-memory-hybrid.cpp:88`; `src/llama-arch.cpp:1091` |
| F3 | CONFIRMED | major | `src/llama-model.cpp:2892`; `src/llama-kv-cache-iswa.cpp` (untouched) |
| F4 | PLAUSIBLE | latent | `src/llama-kv-cache.cpp:427`; `src/llama-ext.h:453-465` |
| F5 | PLAUSIBLE | latent | `src/llama-kv-cache.cpp:2134`, `:2221` |
| F6 | CONFIRMED | (exonerating) | `src/llama-kv-cache.cpp:90`, `:1068` |
| F7 | CONFIRMED / framing REFUTED | major | `tests/test-governor-v0-devices.cpp:241`; `src/llama-kv-commit.h:8` |
| F8 | CONFIRMED | major | `tests/test-governor-v0-shared-cells.cpp:141` |
| F9 | CONFIRMED | answer | `src/llama-governor.cpp:34` |
| F10 | CONFIRMED | clean | `src/CMakeLists.txt`, `tests/CMakeLists.txt` |
| F11 | CONFIRMED / blocker REFUTED | resolved | `src/bmoe/platform_io.cpp:398`; binding `android/src/main/CMakeLists.txt:77,85` |
| F12 | CONFIRMED | major (report) | `node_modules/llama.rn/vendor/VERSIONS` = `d07d0181b` |
| F13 | CONFIRMED | major | `CMakeUserPresets.json` untracked; `.github/workflows/release.yml:579,636` |
| F14 | CONFIRMED | major (report) | 9 files, not 6 |
| F15 | CONFIRMED | minor (report) | baseline EXIT=0 vs table |
| F16 | PLAUSIBLE | minor | `src/llama-ext.h:278-289` |
| **F17a** | **CONFIRMED** | **URGENT** | `.git/MERGE_MSG`; `src/llama-memory-hybrid.cpp`, `-model.cpp`, `-context.cpp` |
| **F17b** | **CONFIRMED** | **URGENT** | index `src/llama-memory-hybrid.cpp:88-219` |
| **F17c** | **CONFIRMED** | **URGENT** | `ggml/src/ggml-cpu/ggml-cpu.c` (0 markers, 3 stages) |
| **F17d** | **CONFIRMED** | **URGENT** | `ggml/src/ggml-cpu/ggml-cpu.c.rej` |
| **F17e** | **CONFIRMED** | high | `tools/llama-bench/llama-bench.cpp` (36 markers) |
