# BRIEFING — our fork of `llama.rn` and our engine `kalsallama`

Read-only reconnaissance. Sources read directly, not summaries. Every claim carries `file:line`
or a command. Anything unverified is flagged **[UNVERIFIED]**.

Pins examined:
- fork `/Users/marco/Projects/llama.rn-kalsa` @ `0f313bab` (branch `vendor-migration`)
- engine `/Users/marco/Projects/kalsallama` @ `8537d097c` (branch `b11010-merge`)
- authoritative record: `analysis/FORK-VENDOR-MIGRATION.md` (2288 lines) in the lab worktree
- `vendor/VERSIONS` in the fork

Status: COMPLETE. Sections 1–10 + appendix, written and saved section by section. All file:line
references checked against the two working trees at the pins above; every command in the body is
reproducible from those trees with no network. Cross-checks that contradicted the record are listed
in Appendix A.

---

## 1. REPO ROLES AND THE TWO CHANNELS

Two repos, two channels. They have different edit rules and different failure modes, and almost
every mistake in this project has been somebody using one channel's rule on the other.

### 1.1 The engine channel (llama.cpp internals)

```
kalsallama (Aspis0/kalsallama)                <- fix HERE, as an engine commit
  -> vendor/VERSIONS LLAMA_CPP_REF (40-hex sha)
  -> scripts/sync-vendor.sh  (git archive subset -> vendor/llama.cpp, then patches)
  -> vendor/llama.cpp committed in the fork
  -> app pin bump (github:Aspis0/llama.rn#<sha>)
```

- Engine repo: `/Users/marco/Projects/kalsallama`, remote `origin =
  https://github.com/Aspis0/kalsallama.git`, `upstream` = ggml-org with **push DISABLED**
  (`kalsallama/KALSA_FORK.md:9-10`).
- The fork consumes it through `LLAMA_CPP_REPO` / `LLAMA_CPP_REF` in `vendor/VERSIONS:7-9`
  (`LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama`,
  `LLAMA_CPP_REF=LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107`).
- `scripts/sync-vendor.sh:382-386` drives it; the export subset is the explicit
  `LLAMA_CPP_PATHS` manifest at `scripts/sync-vendor.sh:34-153`.
- App consumption is documented in `KALSA_FORK.md:35-38`: the app depends on
  `github:Aspis0/llama.rn#<sha>`; bump that ref after committing a re-vendored tree.

### 1.2 The binding channel (llama.rn's own code)

`cpp/rn-*.{cpp,hpp,h}`, `cpp/jsi/**`, `cpp/anyascii.*`, `cpp/bmoe_stream.*` are **edited directly
in the fork**. No patch covers them (`AGENTS.md` — "llama.rn's own sources under `cpp/` (`rn-*`,
`jsi/`, `anyascii.*`) are edited in place; no patch covers them.").

### 1.3 The rule, quoted from the fork's own files

`llama.rn-kalsa/KALSA_FORK.md:14-21`:

> `## Invariant`
>
>     vendor/llama.cpp = the kalsallama pin + scripts/patches/llama.cpp/*.patch
>
> Nothing under `vendor/llama.cpp` is edited by hand: an edit there is lost on the next
> `npm run sync:vendor`. Any kalsa-specific engine change lives as a commit in the kalsallama
> fork (re-point `LLAMA_CPP_REF`) or as a patch under `scripts/patches/llama.cpp/`.

`llama.rn-kalsa/AGENTS.md:55` (the operational form):

> To change upstream code, edit the vendored file in place and regenerate its patch with
> `scripts/update-patch.sh <dep> <path> [name]`.

`llama.rn-kalsa/vendor/README.md:68-69`:

> Do not edit vendored files without regenerating the patch: the next sync re-exports upstream and
> reapplies only what is in `scripts/patches/`.

`llama.rn-kalsa/AGENTS.md:69-71` names the engine channel explicitly and the gate that grades it
(`scripts/assert-kalsa-vendor.sh`). `KALSA_FORK.md:28-33` states the gate grades the **result**,
not the `patch -p1` run, because `patch` succeeds on fuzzy and partial matches.

`KALSA_FORK.md:40-44` governs upstream llama.rn merges: resolve engine-file conflicts toward
upstream's layout; kalsa engine changes live in the fork and the patch set, never in a hand-resolved
vendored file.

**[VERIFIED]** The engine repo's `AGENTS.md` contains no kalsa-specific section (grep for
`kalsa|governor|bmoe|VERSIONS` returns nothing); its kalsa-specific record is `KALSA_FORK.md`.

---

## 2. THE `vendor/` LAYOUT

### 2.1 What each vendor dir is

`vendor/README.md:8-13` is the table; verified on disk with `git ls-files`:

| Directory | Upstream | What is vendored | Tracked files |
| --- | --- | --- | --- |
| `vendor/llama.cpp/` | ggml-org/llama.cpp | `include/`, `src/`, `common/`, `ggml/{include,src}` (CPU, Metal, BLAS, OpenCL, Hexagon, CUDA, Vulkan, WebGPU), the library part of `tools/mtmd/`, `vendor/{nlohmann,hash,miniaudio,stb,sheredom,cpp-httplib}`, CMake project files | **1412** |
| `vendor/codec.cpp/` | mybigday/codec.cpp | `include/`, `src/`, `common/`, `examples/utils/` | **91** |
| `vendor/OpenCL-Headers/` | KhronosGroup/OpenCL-Headers | `CL/` | **19** |
| `vendor/OpenCL-ICD-Loader/` | KhronosGroup/OpenCL-ICD-Loader | CMake project building the Android `libOpenCL.so` stub | **35** |

Total `git ls-files vendor | wc -l` = **1559**. Top level of `vendor/llama.cpp/` on disk:
`CMakeLists.txt cmake common ggml include src tools vendor`.

Two consumers of `vendor/llama.cpp` (`vendor/README.md:18-28`): llama.rn's builds pick sources from
`cmake/rnllama-sources.cmake` + `llama-rn.podspec`; llama.node builds the same tree through
upstream's own CMake project (`add_subdirectory(vendor/llama.cpp)`), which is why the tree keeps
upstream's CMake files, all of `common/`, and the CUDA/Vulkan/WebGPU backends llama.rn never
compiles. Note `vendor/README.md:25-28`: upstream's `cmake/build-info.cmake` reads the enclosing
git checkout, so a build through that project reports **llama.rn's** commit, not llama.cpp's — the
pinned upstream commit is authoritative in `VERSIONS` and `src/version.ts`.

### 2.2 `vendor/VERSIONS` — all four pins, and what each resolves to

`vendor/VERSIONS` is the single source of truth (`KALSA_FORK.md:6`, `AGENTS.md:69-70`). All four
refs are 40-hex shas, not tags (deliberate — see §3.4 and §10).

```
LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama
LLAMA_CPP_REF=8537d097c32e7307d82540b6da8eb448d7e07107
LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107

CODEC_CPP_REPO=https://github.com/mybigday/codec.cpp
CODEC_CPP_REF=63ade8bf2fa3451f9eca7ebaa39f792cc529438e
CODEC_CPP_COMMIT=63ade8bf2fa3451f9eca7ebaa39f792cc529438e

OPENCL_HEADERS_REPO=https://github.com/KhronosGroup/OpenCL-Headers
OPENCL_HEADERS_REF=0c54eeb2b1571718a04f85eaddd51df594bd3c3e
OPENCL_HEADERS_COMMIT=0c54eeb2b1571718a04f85eaddd51df594bd3c3e

OPENCL_ICD_LOADER_REPO=https://github.com/KhronosGroup/OpenCL-ICD-Loader
OPENCL_ICD_LOADER_REF=02134b05bdff750217bf0c4c11a9b13b63957b04
OPENCL_ICD_LOADER_COMMIT=02134b05bdff750217bf0c4c11a9b13b63957b04
```

Resolved in the sync cache (`git -C ~/.cache/llama.rn/<dep> log -1`):

| pin | commit | date | subject |
| --- | --- | --- | --- |
| `LLAMA_CPP` | `8537d097c` | 2026-09-19 | `bmoe: build under minSdk 23 and under -Werror` |
| `CODEC_CPP` | `63ade8b` | 2026-08-11 | `fix(chatterbox-s3g): reset scheduler between decodes (#1)` |
| `OPENCL_HEADERS` | `0c54eeb` | 2025-09-11 | `Regenerate headers with the latest XML file (#292)` |
| `OPENCL_ICD_LOADER` | `02134b0` | 2025-08-19 | `Prevent clGetExtensionFunctionAddressForPlatform from returning ICD-specific symbols. (#253)` |

`~/.cache/llama.rn/llama.cpp`'s `origin` is `https://github.com/Aspis0/kalsallama` — i.e. the
cache-url guard (`sync-vendor.sh:221-226`) sees our URL, so the "silent wrong repo" trap is not
armed on this machine.

### 2.3 The version files the sync generates

All committed (`vendor/README.md:76-77`), and all agree today at pin `8537d097c`:

| file | build | commit |
| --- | --- | --- |
| `src/version.ts` | `11169` | `8537d09` |
| `vendor/llama.cpp/common/build-info.cpp:7` | `LLAMA_BUILD_NUMBER = 11169` | `LLAMA_COMMIT = "8537d09"` |
| `vendor/llama.cpp/src/llama-version.h:4` | — | `LLAMA_COMMIT "8537d09"` |
| `vendor/llama.cpp/ggml/src/ggml-version.h:4` | — | `GGML_COMMIT "8537d09"` |
| `lib/commonjs/version.js:7-8`, `lib/module/version.js:3-4`, `lib/typescript/version.d.ts:1-2` | `11169` | `8537d09` |

`11169` is `git rev-list --count <pin>` over kalsallama's whole graph
(`sync-vendor.sh:340`), which is why a shallow clone is refused
(`sync-vendor.sh:246-250`). `8537d09` is **pure truncation** `"${commit:0:7}"`
(`sync-vendor.sh:344`), not `--short=7`, which is a minimum and would grow on an ambiguous prefix.
`assert-kalsa-vendor.sh:105-109` enforces the 7-char property.

### 2.4 `vendor/README.md`'s update procedure

`vendor/README.md:30-46`, verbatim steps:

1. Edit the `*_REF` line in `VERSIONS` (`vendor/README.md:32`).
2. Run `npm run sync:vendor`. It fetches the upstream repo into `~/.cache/llama.rn/` (override
   `LLAMA_RN_CACHE_DIR`), exports the subset, applies `scripts/patches/<dep>/*.patch`, regenerates
   `src/version.ts` and the three version headers, and writes the resolved `*_COMMIT` back
   (`vendor/README.md:33-38`).
3. Fix any patch that no longer applies, then commit the result (`vendor/README.md:39`).

`vendor/README.md:41-46` also records the daily `sync-llama-cpp` workflow (newest `bNNNNN`,
`scripts/update-llama-cpp.sh`, branch `auto/sync-llama.cpp`, PR pushed even on failure). That
workflow is the §3.5/§10.6 cron hazard, and it is **not present in this fork** — see §10.

---

## 3. THE SYNC / PATCH MECHANISM

### 3.1 `scripts/sync-vendor.sh` — the flow

Header contract at `scripts/sync-vendor.sh:3-17`: clone/fetch into `$LLAMA_RN_CACHE_DIR`
(default `~/.cache/llama.rn`), export the subset in upstream layout untouched, apply
`scripts/patches/<dep>/*.patch` with `-p1`, regenerate the version files. `set -eo pipefail`
(`:18`); **no `set -u`** on purpose, for bash 3.2 empty-array expansion (`:17`).

Stages, by line:

| stage | lines | what it does |
| --- | --- | --- |
| `ensure_repo` | `213-264` | keyed on dependency **name**; **verifies `remote get-url origin` == `$url` and re-clones on mismatch** (`:221-226`); seeds from `.git/modules/vendor/$name` when present (`:231-236`); refuses a shallow clone for `full_history=required` (`:246-250`); resolves a 40-hex ref via `cat-file -e` and a tag via `rev-parse refs/tags/<ref>`, else fetches (`:252-262`) |
| `export_subset` | `268-290` | `git archive --format=tar "$commit" "${paths[@]}" \| tar -xf - -C "$tmp"` then applies `*_PRUNE`, then `rsync -a --delete` into `vendor/<name>` with `--exclude=` for each `*_KEEP` entry (`:283-288`) |
| `apply_patches` | `292-305` | `patch -p1 -d "$dest" < "$patch_file"` per file, then deletes `*.orig`/`*.rej` (`:304`) |
| `record_commit` | `309-315` | `sed` rewrites `<PREFIX>_COMMIT=` in `VERSIONS` so the pin is reproducible even if the ref was a moving branch or tag |
| `sync_dep` | `317-327` | the four steps above in sequence |
| `generate_llama_cpp_version_files` | `331-380` | `build_number = git rev-list --count "$commit"` (`:340`); `build_commit = "${commit:0:7}"` (`:344`); reads `LLAMA_VERSION_*`/`GGML_VERSION_*` out of the pinned `CMakeLists.txt`/`ggml/CMakeLists.txt` (`:346-361`); writes `src/llama-version.h`, `ggml/src/ggml-version.h`, `common/build-info.cpp`, `src/version.ts` |
| driver | `382-393` | `sync_dep llama.cpp LLAMA_CPP required` → version files → codec.cpp → OpenCL-Headers → OpenCL-ICD-Loader → **both gates** (`:390-391`) → `log "Done."` |

The gates run at the end with `set -eo pipefail`, so a failing assertion aborts the sync instead of
printing past it. That wiring is what §22.1 flagged as missing and `4e3b2385` added.

### 3.2 `scripts/update-patch.sh` — regenerating one patch

Usage `scripts/update-patch.sh <dep> <path> [name]` (`scripts/update-patch.sh:6-10`). It sources
`vendor/VERSIONS` (`:28-29`), derives the prefix (`:30`), requires the sync cache to exist
(`:38-42`), pulls the pristine file out of the pinned commit with
`git cat-file -e`/`git show` (`:50-52`) — or an empty file if upstream lacks the path, which makes
a **file-creating patch** (`:53-56`, `vendor/README.md:63-64`) — then `diff -u -L a/<path> -L
b/<path>` (`:66`). If the working copy matches upstream the patch is **removed** (`:67-68`).

Free text above the first `---` line survives regeneration (`:58-61`, `:70`), which is why several
patches carry a one-line "why" preamble (e.g. `function-gemma.cpp.patch:1`). Exit code and label
conventions match `-p1` so the output is directly consumable by `apply_patches`.

### 3.3 The rule: never edit vendored files without regenerating the patch

`vendor/README.md:68-69` (quoted in §1.3) and `AGENTS.md:55`. The operational check is
`npm run sync:vendor` must leave `git status` clean (`vendor/README.md:65-66`, `AGENTS.md:55`).
The vendored tree's own header comment (`sync-vendor.sh:14-16`) says everything it writes is
committed and that builds never run it, so CI compiles exactly what is checked in.

Note the **asymmetry** the sync itself documents (`sync-vendor.sh:8-10`): `vendor/llama.cpp` also
feeds llama.node through upstream's CMake project, so it carries files llama.rn never compiles.

### 3.4 The `patch -p1` weakness, and why the assert gate grades the result

`apply_patches` uses `patch -p1`, which exits **0** on fuzzy or partial matches and on a
double-applied patch. `assert-kalsa-vendor.sh:5-8` says so explicitly, and `24.2` of the record
measures it: 20/20 clean, 0 fuzzy, both sides of the bump — because the dry run greps the output
for `fuzz`/`offset` rather than trusting `$?`.

`assert-kalsa-vendor.sh` (153 lines, `set -euo pipefail`) proves five things, by line:

1. `kalsa-native-patches` appears **exactly once inside `common_params_get_system_info`** (`:67-75`)
   and `} kalsa_moe;` **exactly once inside `struct common_params`** (`:70-77`) — an `awk` scoped to
   the enclosing function/struct, not a `grep -c`, because a double application passes a count.
2. Upstream's four hunks in the same two files survive (`:79-97`): `reasoning_budget_activate_immediately`,
   `bool vocab_only`, `llama_progress_callback progress_callback` (substring) and an anchored
   `progress_callback_user_data` (`[=;]` terminator), plus `mparams.vocab_only` in `common.cpp`.
   This is the "our patches are the UNION" property.
3. `common/build-info.cpp` exists and its `LLAMA_COMMIT` is exactly 7 chars (`:99-109`); the `sed`
   is a whole-line match anchored at both ends so a comment mentioning it does not satisfy it.
4. Seven fork-only governor sources under `vendor/llama.cpp/src/` are **real, non-symlink, non-empty
   files that name `llama_governor` outside comments** (`:111-127`). This is the check that
   separates the kalsallama pin from a plain ggml-org tree with the same patches applied.
5. The committed `lib/` output agrees with `src/version.ts` (`:129-151`).

`code_only()` (`:51-53`) strips `/* */` and `//` before the code checks, with a documented limit
(a literal `/*` inside a string would start a comment) and a warning never to pipe it into
`grep -q` (SIGPIPE + pipefail → a gate that goes red at random; observed once in 26 runs) (`:36-50`).

`assert-rnllama-sources.sh` (`105-168`) proves a different thing: every **explicitly named** path in
`cmake/rnllama-sources.cmake` resolves on disk (globs skipped by design, `:16-19`), and every quoted
include under `cpp/jsi` either resolves inside `cpp/jsi` (against the **including file's** own
directory, `:145-154`) or has a `<rnllama/name.h>` counterpart (`:155-161`). The parser refuses to
pass when it extracts no paths (`:98-99`).

### 3.5 Generated / gitignored files inside the trees

`vendor/README.md:71-82` and `sync-vendor.sh:158-167` (`LLAMA_CPP_KEEP`) define four classes that
`sync-vendor.sh` never deletes:

- **Committed, written by the sync:** `llama.cpp/src/llama-version.h`,
  `llama.cpp/ggml/src/ggml-version.h`, `llama.cpp/common/build-info.cpp` — all three exist on disk.
- **Gitignored, written by `npm run bootstrap`:** `llama.cpp/ggml/src/ggml-metal/ggml-metal-embed-*.s`
  — **20** present; ignore rule `.gitignore:76`.
- **Gitignored, written by `scripts/build-hexagon-htp.sh`:** `llama.cpp/ggml/src/ggml-hexagon/htp/v73/`
  — **absent** on this checkout; ignore rule `.gitignore:97`. The 80 tracked files under `.../htp/`
  are `.c`/`.h` sources, not the stub dir.
- `src/version.ts` is written to `src/`, not into the tree.

### 3.6 The current patch set under `scripts/patches/`

**20 patches, all under `scripts/patches/llama.cpp/`** (no other dep has a patch dir). Verified by
`git ls-tree` that **all 20 exist on `upstream/main` too**; the only two that differ from upstream
are `common.cpp.patch` and `common.h.patch` (`git diff --name-status upstream/main --
scripts/patches/` → exactly those two, +38/−6 lines). That is the whole kalsa delta on the patch
side: the fork adds `kalsa_moe` and `kalsa-native-patches` to upstream's own two patches as a
**union**, not a replacement (`d6d95ecc`).

```
barbet-llama-arch.cpp.patch          barbet-llama-arch.h.patch
barbet-llama-model.cpp.patch         barbet-models-barbet.cpp.patch   (file-creating)
barbet-models.h.patch                chat.cpp.patch
chat.h.patch                         common.cpp.patch   <- union w/ kalsa marker
common.h.patch                       <- union w/ kalsa_moe
function-gemma.cpp.patch             ggml-hexagon.cpp.patch
ggml-metal-flash-attn-smem.patch     ggml-metal-mul-mv-id-tiitg.patch
jinja-value.cpp.patch                llama-mmap.cpp.patch
log.cpp.patch                        mtmd-audio.cpp.patch
mtmd-helper.cpp.patch                parsers.h.patch
sampling.cpp.patch
```

Cross-checks worth stating because they were wrong in the record at some point:

- `llama-mmap.cpp.patch` (POSIX_MADV → MADV, `LLAMA_LOG_WARN` → `fprintf`) is **upstream
  llama.rn's**, not ours: it exists byte-identical on `upstream/main` and the engine tree at the
  pin still has `posix_madvise` (`kalsallama:src/llama-mmap.cpp:495`). It rides on top of the
  engine's own `mmap_prefetch` code (`:487-510`), which *is* ours.
- `ggml-hexagon.cpp.patch` is upstream llama.rn's (preamble: "llama.rn: sessions are created on
  demand upstream…"); the engine does not contain it (`grep -c 'failed to create session for'` = 0).
- `sampling.cpp.patch` + the `common.h` half of the union carry
  `reasoning_budget_activate_immediately`, which is **upstream's**; the engine has 0 hits for it.

A leftover to be aware of: `scripts/kalsa-patches/common.{h,cpp}.patch` still exists in the tree
(`git ls-files scripts/kalsa-patches/` → both), even though `54c99f14` deleted
`scripts/sync-kalsallama.sh` and the record's step 8 listed `kalsa-patches/` for deletion. They are
the pre-union versions with `a/cpp/common/...` paths, referenced by no script now. Harmless (nothing
reads them) but they are a stale duplicate of the two patches that matter. **[UNVERIFIED whether
their deletion is pending an app-side consumer — no reader found in this fork.]**

---

## 4. WHAT IS OURS, ENGINE SIDE (inside `vendor/llama.cpp`)

### 4.0 The classification rule that matters

**Everything in this section arrives through the pin (direct vendored content), not through a
patch.** `sync-vendor.sh` re-exports `src/`, `common/`, `ggml/src/ggml-opencl/` etc. verbatim from
kalsallama, so an engine change is propagated by bumping `LLAMA_CPP_REF` and re-syncing. **No
kalsa engine file is a patch.** The only kalsa content on the patch side is the
`common.{h,cpp}` union (`kalsa_moe` struct + `kalsa-native-patches` marker) — see §3.6.

The authoritative delta is `git diff --name-status 4bc272fd7..8537d097c` in kalsallama
(b11010 → our pin): **68 added, 58 modified**, which reconciles exactly as
22 (bmoe) + 7 (governor) + 4 (kv) + 2 (hybrid-commit) + 6 (kernels) + 18 (tests) + 4 (governor-bench)
+ 5 (other: `repack-q23k.h`, the two diag files, `KALSA_FORK.md`, `android-bench.yml`) = 68.
Categorised below.

### 4.1 New files (68 added)

| group | files | notes |
| --- | --- | --- |
| **`src/bmoe/`** | **22** | `arch_registry.cpp config.{cpp,h} decode_trace.h dense_weights.{cpp,h} expert_source.h expert_stream_source.{cpp,h} file_reader.{cpp,h} gguf_offsets.{cpp,h} metrics.h platform_io.{cpp,h} predict_stats.h recipe.h route_trace.h router_hook.{cpp,h} version.h` — ggml-level only, no llama header (added `e1866612d`) |
| **governor v0.3** | **7** | `src/llama-governor.{cpp,h} llama-governor-runtime.cpp llama-governor-metrics.{cpp,h} llama-governor-policy.{cpp,h}` |
| **KV governor primitives** | **4** | `src/llama-kv-commit.{cpp,h}` (`73f5fe92f`), `src/llama-kv-staged.{cpp,h}` (`9ab716ae1`) |
| **hybrid commit** | **2** | `src/llama-hybrid-commit.{cpp,h}` — vendored, and `src/CMakeLists.txt:29` names it |
| **q23k repack header** | 1 | `ggml/src/ggml-cpu/repack-q23k.h` — included by three TUs; the export manifest had to name it explicitly (`sync-vendor.sh:89-91`) |
| **OpenCL KALSA diagnostic TU** | 2 | `ggml/src/ggml-opencl/ggml-opencl-kalsa-diag.{cpp,h}` (`8e081313f`, fixed by `f6ba2786d`) |
| **MoE / oracle kernels** | 6 | `kernels/gemm_moe_q2_k_f32_ns.cl`, `gemm_moe_q3_k_f32_ns.cl`, `gemv_moe_q2_k_f32_ns.cl`, `gemv_moe_q3_k_f32_ns.cl`, `oracle_consumer_q4_0_gemm.cl`, `oracle_consumer_q4_0_gemv.cl` |
| **tests** | 18 | 8 governor (`test-governor-v0.cpp`, `-commit`, `-devices`, `-hybrid`, `-mtp-hybrid`, `-shared-cells`, `-turns`, `test-governor-v02-router.cpp`) + 10 others (`test-opencl-moe-roundtrip.cpp`, `test-perf-reset.cpp`, `test-repack-q23k-{load,m0,m1,m2,m3,m4,m5}.cpp`, `test-s3-repack-bench.cpp`) |
| **governor bench tool** | 4 | `tools/governor-bench/{CMakeLists.txt,governor-bench.cpp,governor-bench-run.cpp,governor-bench.h}` |
| docs / CI | 2 | `KALSA_FORK.md`, `.github/workflows/android-bench.yml` |

`tests/` and `tools/governor-bench/` are **not exported** — the manifest has no `tests` pathspec and
only `tools/mtmd` (`sync-vendor.sh:124-142`). Verified: `vendor/llama.cpp/tests` does not exist;
`vendor/llama.cpp/tools/` holds only `mtmd/`. That is 18 test files and 4 bench files that stay in
kalsallama by decision (§3.2 of the record); running the governor suite means running it from a
kalsallama checkout.

### 4.2 Upstream files we modified (58)

Named by subject, not exhaustive:

- **Governor integration:** `src/llama-context.{cpp,h}`, `src/llama-ext.h` (governor type decls —
  this is what step 7's `-fsyntax-only` gate counted 37 errors for and then 0), `src/llama-model.{cpp,h}`,
  `include/llama.h`, `src/CMakeLists.txt`, `CMakeLists.txt`.
- **Hybrid / KV memory:** `src/llama-memory-hybrid.{cpp,h}`, `-iswa.{cpp,h}`, `-idx.cpp`,
  `src/llama-memory.h`, `src/llama-kv-cache.{cpp,h}`, `src/llama-kv-cache-iswa.{cpp,h}`.
  **Important correction to a common misreading:** `llama-memory-hybrid*` and `llama-ext.h` are
  **upstream files at b11010, extended by us** (`git cat-file -e 4bc272fd7:src/llama-memory-hybrid.cpp`
  succeeds). They are not fork-only the way the governor files are.
- **q23k repack cluster:** `ggml/src/ggml-cpu/repack.{cpp,h}`, `arch-fallback.h`,
  `arch/arm/repack.cpp`, `traits.cpp`, `ggml-cpu.c`.
- **Expert-ready hook:** `ggml/include/ggml-cpu.h` (declared `:148`, `:152`;
  defined `ggml/src/ggml-cpu/ggml-cpu.c:65-67`, used `:1770-1771`, `:1982`) — added so bmoe can hook
  MoE expert readiness from outside the kernel.
- **OpenCL (the high-churn file, +3124/−117):** `ggml/src/ggml-opencl/ggml-opencl.cpp`,
  `ggml/src/ggml-opencl/CMakeLists.txt`, `cvt.cl`, and 17 MoE/noshuffle kernels.
- Others: `common/{arg,common}.{cpp,h}`, `tools/cli/cli-context.{cpp,h}`, `tools/llama-bench/llama-bench.cpp`,
  `tools/mtmd/mtmd-cli.cpp`, `tools/CMakeLists.txt`, `tests/CMakeLists.txt`, `tests/test-backend-ops.cpp`
  (NPU judge), `ggml/src/ggml-hexagon/ggml-hexagon.cpp`, `htp/matmul-ops.c`, `build-xcframework.sh`,
  `.github/workflows/build-cann.yml`.

### 4.3 The padded-grid guards (verified present in the vendored tree)

A pure-suppression correctness fix made in the engine, so it arrives vendored. Two commits:

- `754a96426` (19/09 11:55) — `ggml-opencl.cpp` +22/−… and `gemv_noshuffle_q4_k_f32.cl`,
  `gemv_noshuffle_q6_k_f32.cl`. In the vendored kernel the guard and its rationale are at
  `kernels/gemv_noshuffle_q4_k_f32.cl:246-247` and `:334-337`
  ("The x-grid is padded to `CEIL_DIV(ne01/2,64)*64`, so when `ne01 % 128 != 0` the tail lanes hold
  `gid >= ne01/2`. The output stores below are guarded…").
- `738346fd6` (19/09 12:01) — the rest of the class: `gemv_noshuffle_q4_0_f32.cl`,
  `q4_1_f32.cl`, `q4_k_f32.cl` (+7), `q5_k_f32.cl`. Covers the split-K partial buffer and the mc3
  GEMVs. Every guard is a suppression: on shapes already covered the predicate is trivially true,
  so output is byte-identical (record §13.1).

The same commit also added the `#error` on `GGML_OPENCL_USE_ADRENO_BIN_KERNELS`, which
`cf1bc2395` then **removed** as over-broad. **[VERIFIED]** there is now **no `#error`** anywhere in
`vendor/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp` (`grep -n '#error'` → empty); the honest
comment lives at `:28312-28320`.

### 4.4 Not fixed, deliberately, with a criterion (`record §13.3`)

These are ours-by-consequence (they sit in the file we carry), pre-existing, and left alone because
an off-device edit to an E031-sensitive kernel is how wrong numbers ship:

1. Divergent `barrier()` in the MoE noshuffle GEMVs (`gemv_moe_q4_k_f32_ns.cl:193-194`, `:274`;
   gate `ne01 % 32 == 0` admits `ne01 ≡ 32 (mod 64)`). Trigger criterion: a q4_K MoE expert tensor
   with `ne01 % 64 != 0`.
2. Odd `ne01` under-dispatches generic q4_0 (`CEIL_DIV(ne01/2, 64)*64` with integer division).
   Requires an odd weight row count ≥ 512.
3. Padded lanes **read** out of bounds before their store is suppressed (`M = 576`,
   `LINE_STRIDE_A = 288`, grid 320 → lanes 288–319). Robustness, not wrong numbers.

The device queue is recorded: (1) MoE with `ne01 % 64 != 0`, (2) q4_0 odd-`ne01` grid, (3) OOB reads
under a memory checker.

---

## 5. WHAT IS OURS, BINDING SIDE (`cpp/`)

`cpp/` is **39 tracked files** (`git ls-files cpp/ | wc -l` = 39): 33 upstream llama.rn files,
4 `rn-governor*` files, and 2 `bmoe_stream.*` files. The measured delta against `upstream/main`
(`upstream/main` **is** an ancestor of HEAD, so this is exactly our binding delta) is
**19 files, +2168/−365**:

```
A cpp/bmoe_stream.cpp            315/0     M cpp/rn-completion.cpp      432/132
A cpp/bmoe_stream.h               81/0     M cpp/rn-completion.h         28/2
A cpp/rn-governor.cpp             87/0     M cpp/rn-llama.cpp           367/41
A cpp/rn-governor.h               39/0     M cpp/rn-llama.h              34/1
A cpp/rn-governor-params.cpp     161/0     M cpp/rn-mtmd.hpp              2/1
A cpp/rn-governor-params.h        19/0     M cpp/rn-slot-manager.cpp     37/34
M cpp/jsi/JSICompletion.h         37/6     M cpp/rn-slot.cpp            154/71
M cpp/jsi/JSIParams.cpp          102/21    M cpp/rn-slot.h                7/1
M cpp/jsi/JSISession.h            80/9     M cpp/rn-tts.cpp               2/2
M cpp/jsi/RNLlamaJSI.cpp         184/44
```

TS side (`src/`) is 4 modified files: `src/index.ts`, `src/jsi.ts`, `src/types.ts`,
`src/version.ts`.

### 5.1 `cpp/bmoe_stream.{h,cpp}` — the MoE streaming seam

`cpp/bmoe_stream.h:1-14` states the design in its own header comment: the streaming engine lives
vendored (now `vendor/llama.cpp/src/bmoe/`; **the comment at `:3` still says
`native/bmoe/{include,src}`, which is stale** — the file was written before `dc205f56` moved it),
and `bmoe_stream.*` is the only Kalsa-written part, so `rn-llama.cpp` gains ten lines rather than
150.

API (`cpp/bmoe_stream.h:32-79`): `kalsa::MoeStream` with `arm(common_params&, std::string&)` before
`common_init_from_params` (installs the eval callback, forces mmap-on/repack-off/no-mlock),
`bind(llama_context*, std::string&)` after the context exists (warm-up decode to harvest expert
tensors, resolve file offsets, go live), `shutdown()` (**must** run before the `llama_context`
dies — the streamer's buffers are what the model's expert tensors point at), plus
`set_cache_budget(size_t)` for Android `onTrimMemory`. It is non-copyable because "it holds the
process-global expert-ready hook while live" (`:30-31`). Failure is never fatal: streaming "declines
rather than refuses" (`:12-14`). The `eval_trampoline` (`:74`, rationale `:66-73`) exists so a
failed/declined `bind()` costs nothing, since llama.cpp has no way to remove `cb_eval`.

Wiring **[VERIFIED at line]**: `cpp/rn-llama.h:26` forward-declares it, `:128` holds the
`unique_ptr`, `:153` comments the destructor ordering. `cpp/rn-llama.cpp:802` constructs it
(`moe_stream = std::make_unique<kalsa::MoeStream>();`); `:805` arms it before
`common_init_from_params`; `:825-827` binds it after the context exists. Two teardown sites:
`:625` and `:755`, the latter followed by `moe_stream.reset()` at `:756`.

### 5.2 `cpp/rn-governor{,-params}.{cpp,h}` — 4 files, entirely ours

`cpp/rn-governor.cpp:1-2` includes `"rn-governor.h"` and `"llama-governor.h"`. The latter is the
engine header — resolving it is what step 7 of the migration was gated on (37 → 0 `-fsyntax-only`
errors). It wraps the v0.3 engine API, e.g. `llama_governor_init_with_params_internal(...)`
(`cpp/rn-governor.cpp:~16`) and `llama_governor_set_thermo_profile(...)`. `rn-governor-params.*` is
the params/thermo-profile translation layer. These four files are the porting-free part of the
binding (they do not exist upstream), and they are listed in `cmake/rnllama-sources.cmake`'s
`RNLLAMA_RN_SOURCES` (added by `afc82485`).

### 5.3 `cpp/jsi/**` — the modified bridge files

`cpp/jsi/RNLlamaJSI.cpp` (+184/−44), `JSIParams.cpp` (+102/−21), `JSICompletion.h` (+37/−6),
`JSISession.h` (+80/−9). What is ours, from `afc82485` and `74836284`:

- `JSICompletion.h`: sync then read perf on `active_ctx()` (`llama_synchronize()` restored — the
  merge dropped it, so decode counters could come from a context that did not decode, or be stale);
  re-emit `generated_token_ids` (first 32) in the json result next to `completion_probabilities`.
- `JSISession.h`: `KALSA_KVRESUME` / `KALSA_KVRESUME_SEQ_RM` markers (`:72`, `:87`, `:97`, `:182`).
- `RNLlamaJSI.cpp`: `KALSA_GOVERNOR_FALLBACK` (`:680`, `:777`), the governor params/thermo/stats/
  timings paths, and the bench force-ids/raw-probs path — all following upstream's new json
  builders.
- `JSIParams.cpp`: governor params and the json param builders.

### 5.4 `cpp/rn-mtmd.hpp`

Upstream's file, **2 lines changed** against `upstream/main`:

```cpp
-    input_text.text_len = prompt.size();
+    // Kalsa patch: the kalsallama fork's mtmd_input_text has no text_len (tools/mtmd/mtmd.h:68);
+    // mtmd.cpp:842 reads text->text as a NUL-terminated C string, and prompt.data() is one.
```

So it is a one-line adaptation to the engine's API shape, not new behaviour.

### 5.5 `LM_` de-prefix status: **done, zero residue**

**[VERIFIED]** `grep -rl 'lm_ggml_\|LM_GGML_\|lm_llama_\|LM_LLAMA_'`
→ `vendor/llama.cpp`: **0 files**. `cpp/`: **0 files**. The rename machinery lived only in the
deleted `scripts/sync-kalsallama.sh` (record §14.1). The engine at the pin exports plain `ggml_*`.

Consequences that are now settled facts rather than pending decisions:
- `bmoe_lmggml_compat.h` (46 `#define`s mapping plain names to `lm_`-prefixed ones) is **deleted
  in both repos**; `find . -name '*lmggml_compat*'` returns nothing (`dc205f56`, record §22.5/§25.1).
- `BMOE_HAVE_EXPERT_READY_HOOK` is deleted; the guard was a tautology once bmoe lived inside the
  fork (record §25.1).
- Coexistence with whisper.rn now relies on the dynamic-image mechanisms alone: two-level namespace
  on Apple, `RTLD_LOCAL` + `-Bsymbolic` on Android (`AGENTS.md`, "Important Conventions"), plus the
  per-library `GGMLMetalClass` `-D` rename.

### 5.6 `cpp/rn-llama.cpp` engine glue

`cpp/rn-llama.cpp` is +367/−41 and is where the engine is called. Head includes `:2`
(`bmoe_stream.h`), `:7-8` (`rn-governor.h`, `rn-governor-params.h`). Ours:

- **Governor fallback logging + model load:** `log_governor_fallback()` at `:63-70` emitting the
  `KALSA_GOVERNOR_FALLBACK` marker (`:67`, and the second form at `:663`), and
  `load_governor_models()` at `:71-` building the prefill/decode init pair and the `rn_governor`.
- **CPU-param normalization** (~`:765-795`): `common_cpu_get_num_math()` as the zero-safe default for
  `n_threads`/`cpuparams_batch.n_threads`, with the rationale in a long comment — an explicit `0` or
  an unresolved `-1` reaching `ggml-cpu.c` faults (run `35307242869`).
- **Load/unload ordering** (~`:753-762`): `moe_stream->shutdown()` → `moe_stream.reset()` →
  governor resets → `llama_init.reset()`, documented as the inverse of the construction order.
- **The streamer arm/bind bracket** around `common_init_from_params` (~`:802-810`), only on the
  non-governor path.

---

## 6. THE CI GATES

### 6.1 `.github/workflows/ci.yml` — 7 jobs, no branch guards

Triggers: `push` to `main` and **`kalsa`**, `pull_request` to `main`, `workflow_dispatch`
(`ci.yml:2-10`). Counted with a parser-shaped check, not a raw grep (record §27.7 records that a
raw `grep -cE "^  [a-z][a-z0-9-]*:$"` returns **8** and is wrong — it also counts `push:` under `on:`):

| # | job | line | what it runs |
| --- | --- | --- | --- |
| 1 | `vendor` | `:17` | `actions/checkout`, then `./scripts/assert-kalsa-vendor.sh` and `./scripts/assert-rnllama-sources.sh` (`:27-30`) |
| 2 | `lint` | `:32` | `npm run lint`, `npm run typecheck` |
| 3 | `test` | `:47` | jest (`npm test -- --maxWorkers=2 --coverage`), then **C++ unit tests** via `tests/build_and_test.sh` + `tests/run_tests.sh` (`:66-71`) |
| 4 | `build-ios-from-source` | `:73` | `npm run build:ios` (example app builds from source) |
| 5 | `build-ios-frameworks` | `:106` | `npm run build:ios-frameworks` with `RNLLAMA_BUILD_FROM_SOURCE: 0`, then `npm run build:ios` |
| 6 | `build-android-from-source` | `:145` | `npm run build:android` with three variants (`rnllama`, `rnllama_v8_2_dotprod_i8mm_hexagon_opencl`, `rnllama_x86_64`), Hexagon SDK 6.4.0.2 |
| 7 | `build-android-libs` | `:215` | `npm run build:android-libs`, then proves the prebuilt path with `./gradlew assembleDebug -PrnllamaBuildFromSource=false` |

**[VERIFIED on disk] the "7/7 no branch guards" claim:**

```
grep -c 'refs/heads/kalsa' .github/workflows/ci.yml          -> 0
grep -n 'if:' .github/workflows/ci.yml                        -> only a comment at :19
grep -n '^  [a-z][a-z0-9-]*:$' .github/workflows/ci.yml       -> 8 lines (7 jobs + "push:")
```

`vendor` is deliberately unconditional; the comment at `ci.yml:18-21` says why: "vendor/ is checked
in and must stay valid on every branch. No `if:` here, so no gating is inherited or widened."

The `test` job's C++ half carries a comment (`ci.yml:61-65`) recording that the un-gating was
justified by the bmoe move, and that run `35360547883` died on
`llama-kv-cache-iswa.cpp:97` — `'runtime_error' is not a member of 'std'`, which clang forgives and
GCC does not; the live vendored copy carries `<stdexcept>` at line 9 of that file.

Run ids for the gate history **[from the record, not re-verified — no network]**:

| run | sha | verdict | source |
| --- | --- | --- | --- |
| `35465310732` | pre-migration | 1/6 green; first error `bmoe_stream.h: No such file` | record §22.4 |
| `35466782230` | `4e3b2385` | `vendor :: completed success` (gate wired into CI) | record §23 |
| `35470060692` | `11cc0f9f` | 4/7 | record §27.5 |
| `35472151797` | `739d7a54` | 6/7 | record §27.6 |
| **`35474384553`** | **`a974a52b`** | **7/7, conclusion `success`** | record §27.7 |
| `35476684286` | `0f313bab` | confirms the tip; script-only change | record §27.8 |

### 6.2 `scripts/assert-kalsa-vendor.sh` — what it proves

Run in two places: at the end of `scripts/sync-vendor.sh:390` (inside `set -eo pipefail`, so a
failure aborts the sync before `log "Done."`) and as the `vendor` CI job. It grades the **result**,
never the `patch -p1` run (`:5-8`). Five assertions, detailed in §3.4:

1. `kalsa-native-patches` exactly once in scope, `} kalsa_moe;` exactly once in scope (`:67-77`).
2. Upstream's four hunks in the same two files still present (`:79-97`) — the union property.
3. `build-info.cpp` exists with a whole-line `LLAMA_COMMIT` of exactly 7 chars (`:99-109`).
4. The seven fork-only governor sources are real, non-symlink, non-empty, and name
   `llama_governor` outside comments (`:111-127`) — **this is the check that separates our engine
   from a plain ggml-org tree with our patches applied**.
5. `lib/commonjs|module|typescript/version.*` agree with `src/version.ts` (`:129-151`).

Success line: `assert-kalsa-vendor: ok (marker x1, kalsa_moe x1, upstream hunks present, governor
src real, lib/ matches src/version.ts)` (`:153`).

### 6.3 `scripts/assert-rnllama-sources.sh` — what it proves

Two things (`:4-7`): **manifest coverage** and **include style**.

1. Every **explicitly named** path in `cmake/rnllama-sources.cmake` resolves on disk. Globs are
   skipped by design (a glob cannot fall behind); the parser expands `${VAR}` against the
   `set(NAME "value")` table, errors on an unknown variable, and refuses to pass when it extracts
   no paths at all (`:39-101`). Success: `assert-rnllama-sources: ok (N explicitly-named paths
   resolve)` (`:103`). This exists because `sync-vendor.sh` exports whole directories **and**
   explicitly named files, so a new upstream `ggml/src/ggml-*.cpp` that no pathspec names is
   silently absent and surfaces much later as an undefined symbol (record §21.2, where the script's
   predecessor was wrongly deleted on exactly this argument).
2. Under `cpp/jsi/`, any quoted include that does not resolve inside `cpp/jsi` (resolved against
   the **including file's** own directory, `:145-154`) must have a `<rnllama/name.h>` counterpart in
   the same file (`:155-161`). This is the invariant, not a header allowlist, so it needs no
   exemption list. It exists because with a prebuilt xcframework the pod compiles only `cpp/jsi/**`
   and every engine header comes from the framework, where the spelling is `<rnllama/name.h>` — one
   bare include builds fine from source and fails only in `build-ios-frameworks`, half an hour later
   (`:105-115`). Documented limits: it does not evaluate `#if`, and a `/*` inside a string would
   confuse `code_only` (`:117-126`). Both scripts carry the "never pipe `code_only` into `grep -q`"
   warning (`assert-kalsa-vendor.sh:47-50`, `assert-rnllama-sources.sh:123-126`).

### 6.4 What CI still cannot prove

`llama.rn`'s CI cannot prove the *engine's numeric correctness* (record §11.2/§13.4): the Mac build
has `GGML_OPENCL:BOOL=OFF` and the Apple device is rejected by the backend, so no OpenCL
correctness claim can be made off-device. The `test-backend-ops` gate is also a knowable false pass
there: without `-b` naming a backend, the harness skips-then-succeeds (93 enumerated, 0 executed,
exit 0). And `tests/` is not vendored, so CI cannot run the governor suite either — it runs
`tests/build_and_test.sh` from the fork's own `tests/` dir, which is upstream's harness, not ours.

`build-example-android.yml` is a separate workflow (`workflow_run` off `Release` +
`workflow_dispatch`), not part of the §25.2 gate.

---

## 7. 2026-09-19, COMMIT BY COMMIT

Times are commit-author local time; all dates 2026-09-19 unless stated. One line each.

### 7.1 Engine (`kalsallama`, branch `b11010-merge`) — 10 commits

| # | sha | time | what changed and why |
| --- | --- | --- | --- |
| 1 | `26c7affb7` | 08:47 | **OpenCL q4_K MoE build fix.** `kernel_gemv_moe_q4_k_f32_ns_wimg` declared 11 params but called the 7-arg `get_scale_min_k4` helper with 4 → the CL program failed to build → `ggml-opencl.cpp` `exit(1)`s on a fatal compile error, so every load that initialised the OpenCL backend killed the app. Pass the masks as kernel args. |
| 2 | `2361be359` | 08:47 | **OpenCL q4_K dp4a MoE mask-args fix.** `kernel_gemm_moe_q4_k_q8_1_dp4a`'s own copy of `get_scale_min_k4` still decoded the 6-bit scale/min codes with literal masks `63`/`0x0F`/`0xC0` — the form the Adreno E031.41.03.62 compiler miscompiles on the MoE `MUL_MAT_ID` path. Precautionary by analogy (that kernel was never measured), so it is not a measured fix. |
| 3 | `6b6d4a980` | 11:09 | **`b11010` merge.** Merge tag `b11010` (`4bc272fd729bd094c0422e4b8353da8d2fec91f8`, the commit upstream llama.rn pins) into `b11010-merge`, merge base `64a155d24`. Five conflicted files; everything else auto-merged. |
| 4 | `754a96426` | 11:55 | **Padded-grid store guards, first half.** The noshuffle decode GEMVs are dispatched on an x-grid padded to a multiple of 64 work-items, and only the base kernel guarded its stores; the fused gate+up GLU GEMV and the q4_K/q6_K mc3 variants wrote past `dst` whenever the row-pair extent was not exactly covered. |
| 5 | `738346fd6` | 12:01 | **Padded-grid store guards, rest of the class.** q4_K split-K partial buffer (worst: tail lanes of slice *k* land in slice *k+1*'s rows and race that slice's workgroups → nondeterministic wrong partials), plus q4_0/q4_1/q5_K mc3 GEMVs. |
| 6 | `cf1bc2395` | 13:01 | **Self-correction: drop the over-broad `#error`.** `754a96426` had made `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` a hard build failure; that breaks a documented upstream configuration (`docs/backend/OPENCL.md:85`) and the risk is essentially nil on our hardware. The false comment was replaced with what is verifiable (`ggml-opencl.cpp:28312-28320`). |
| 7 | `8e081313f` | 14:47 | **Relocate the KALSA OpenCL diagnostic scaffolding.** 17 self-contained diagnostic/experiment helpers moved out of `ggml-opencl.cpp` into `ggml-opencl-kalsa-diag.{h,cpp}` (dispatch logging, env parsing, alloc logging, GEMV-audit snapshot/overlap bookkeeping, qk23/oracle enablement), and registered in `ggml-opencl/CMakeLists.txt`. |
| 8 | `f6ba2786d` | 15:07 | **Fix the relocated TU's OpenCL target version.** The new TU never set `CL_TARGET_OPENCL_VERSION`, so `CL/cl_version.h` defaulted to 310 while the rest of the backend compiled with `GGML_OPENCL_TARGET_VERSION=300`. 34 changed lines, all comment/`#include`/`#define`; zero function bodies. |
| 9 | `e1866612d` | 16:25 | **bmoe moves into the engine.** The 22-file core (`include/bmoe`, `src/io`, `src/moe`) flattened into one `src/bmoe/`, because bmoe only ever needed ggml — no `llama.h`, no llama-internal headers — so it belongs beside the other engine sources instead of as a sibling copy the library reaches out to. Two lines of CMake. |
| 10 | `8537d097c` | 17:14 | **bmoe builds under minSdk 23 and under `-Werror`.** Two defects the move exposed: `AHardwareBuffer_*` are unavailable below Android API 26 while llama.rn builds at 23 (guarded to `#if defined(__ANDROID__) && __ANDROID_API__ >= 26`), and `RouterHook::predict_at_topk` took a tensor it never read. |

### 7.2 Fork (`llama.rn-kalsa`, branch `vendor-migration`) — 25 commits

| # | sha | time | what changed and why |
| --- | --- | --- | --- |
| 1 | `95c3493b` | 09:00 | **Engine pin bump to kalsallama `2361be359`** (the two OpenCL MoE fixes). Regenerated `cpp/` via the then-still-alive `sync-kalsallama.sh`. This is the commit the app then pinned (`5a15067`), and the last rollback point before the layout change. |
| 2 | `d6d95ecc` | 13:06 | **Union the `common.{h,cpp}` patches.** Ours share basenames with upstream's; moving ours into `scripts/patches/llama.cpp/` would have overwritten theirs and silently deleted four upstream features. Not hand-merged: both sides applied in order to the pristine files at the pin, diffed, replayed and compared identical; paths rewritten `cpp/common/` → `common/`. |
| 3 | `74836284` | 13:31 | **Adopt upstream's `vendor/` layout and re-apply the kalsa binding.** Merge of `upstream/main` into `vendor-migration`; the engine moves out of `cpp/` into `vendor/llama.cpp`, leaving `cpp/` the 33 binding files. Resolves the last 11 unmerged files. The single biggest commit of the migration. |
| 4 | `afc82485` | 14:01 | **Binding restore.** Five fixes from the vendor-merge audit: `JSICompletion.h` syncs and reads perf on `active_ctx()`; re-emits `generated_token_ids`; `rn-governor{,-params}.cpp` added to `RNLLAMA_RN_SOURCES` and the duplicate appends removed from android/ios; `assert-cpp-includes.sh` gets `-DGGML_USE_OPENCL` … |
| 5 | `758a6966` | 14:49 | **Cache-URL check + 7-char commit.** `sync-vendor.sh` keyed its clone cache on the dependency **name**, never the URL and never the cached clone's origin — with `LLAMA_CPP_REPO` about to move from ggml-org to kalsallama, the existing cache would have silently populated `vendor/` from the wrong repo. Also switches the build commit to pure truncation. |
| 6 | `12f49b30` | 14:53 | **Refuse a shallow cache before writing anything.** The check lived inside the version-file generator, which runs *after* `sync_dep` already re-exported the tree and rewrote `VERSIONS`; a depth-1 cache therefore corrupted a pin it had already written. |
| 7 | `f5fd027b` | 14:59 | **`LM_` de-prefix cleanup.** Upstream dropped the `lm_` prefix on the vendored tree; `cpp/` still had prefixed leftovers and a dead `cpp/ggml-version.h` asserting a false engine identity. Fixes `cpp/rn-governor.cpp` to use `ggml_time_us()`. This is the one hard compile error the branch was carrying (record §14.2). |
| 8 | `2f1996d4` | 15:16 | **Re-point the engine pin at the kalsallama fork** (`LLAMA_CPP_REPO` → `Aspis0/kalsallama`, ref `f6ba2786d…`, stays 40-hex so a moving ref cannot become a silent trap). Also fixes a real bug it exposed: `assert-kalsa-vendor.sh` grepped `build-info.cpp` for `LLAMA_BUILD_COMMIT` (the template placeholder) instead of `LLAMA_COMMIT`, so the check had **never** matched anything. |
| 9 | `ab7c2e65` | 15:33 | **Harden `assert-kalsa-vendor.sh` before using it to gate a deletion** — three fail-open holes, each proven by a mutation. |
| 10 | `54c99f14` | 15:38 | **Delete the legacy flattened engine** (12 hash duplicates, 17 engine files under `cpp/`, `cpp/KALSALLAMA_SHA`, two stale version headers, `third_party/OpenCL-Headers`), plus `scripts/sync-kalsallama.sh` and `scripts/assert-cpp-includes.sh`. The engine now lives once. |
| 11 | `4fab9622` | 15:43 | **Delete `kalsallama.pin`** and document `vendor/VERSIONS` as the source of truth. The pin file claimed `2361be3` — 208 commits behind the real pin — and nothing read it; a committed file asserting a false identity is a defect even when no code reads it. |
| 12 | `4e3b2385` | 16:13 | **Wire the gate.** Nothing called `assert-kalsa-vendor.sh` (not the sync, no npm script, no CI) — "a gate that only runs when someone remembers is not a gate." Now runs at the end of `sync-vendor.sh` and as the unconditional `vendor` CI job; the identity check is anchored whole-line. |
| 13 | `6eea3f53` | 16:13 | **`assert-rnllama-sources.sh`.** Restores the property whose loss was accepted when `assert-cpp-includes.sh` was deleted; the "whole directories, so no lists can fall behind" argument was false, because the manifest also names individual files. |
| 14 | `dc205f56` | 16:35 | **bmoe_stream vendored + CI un-gated.** `cpp/bmoe_stream.{h,cpp}` come into llama.rn (includes re-pointed `moe/*` → `bmoe/*`, the dead `bmoe_lmggml_compat.h` premise gone, `BMOE_HAVE_EXPERT_READY_HOOK` dropped), and every branch guard is removed from `ci.yml`. The gate prediction: 7/7 with zero guards. |
| 15 | `88e7eed5` | 16:40 | **Three bypass holes closed in `assert-kalsa-vendor.sh`**, each reproduced against a `/tmp` copy — including `progress_callback_user_data` matched by an unanchored substring. |
| 16 | `18f3ff33` | 16:42 | **Do not pin the `progress_callback` initializer.** Anchoring all the way to `= nullptr;` rejects the fake-field bypass but turns an upstream initializer change into a false alarm on a bump — the opposite of the objective. |
| 17 | `04a3685a` | 16:47 | **Restore `npm run bootstrap`** in the setup action: `build-android-libs` died on "Hexagon SDK not found", long before any of our code. It had been dropped when bootstrap still rewrote the tree with the `lm_` prefix; it renames nothing now. |
| 18 | `91b258f6` | 17:00 | **`test(slot)` asserts our `should_use_mtp` contract.** Un-gating exposed "Slot MTP Params and Reset" red here and green upstream on a byte-identical file; the cause is a deliberate divergence (our `should_use_mtp()` also answers "does the runtime permit MTP", consulting `hasGovernor()`), and the guard is load-bearing. |
| 19 | `0a9b9379` | 17:14 | **Pin `8537d09`** — the engine commit that makes bmoe build at minSdk 23 and under `-Werror`. |
| 20 | `4a6859ff` | 17:19 | **Correct the `bootstrap` comment.** The comment claimed bootstrap only fetches the SDK and generates gitignored Metal assembly; false — `scripts/bootstrap.sh:106` runs `npm install` in `example/` and `:176` runs `npm run pods`, both with tracked lockfiles. |
| 21 | `11cc0f9f` | 17:19 | **The vendor gate reads code, not text.** A hostile audit made three checks pass against trees whose real declaration had been replaced by a commented-out copy — a file containing only `// llama_governor` satisfied "this engine is our fork". |
| 22 | `bde3f975` | 17:48 | **Glob the whole OpenCL backend directory.** Fifteen undefined `ggml_opencl_*` symbols: they are defined in the vendored `ggml-opencl-kalsa-diag.cpp`, which llama.rn's hand-written three-site list never named. Replaced with one glob in `cmake/rnllama-sources.cmake`. |
| 23 | `739d7a54` | 18:01 | **iOS framework include.** `RNLlamaJSI.cpp:12` included `"rn-governor-params.h"` bare; with a prebuilt xcframework that header is reachable only as `<rnllama/name.h>`. |
| 24 | `a974a52b` | 18:16 | **Guard the second framework-unsafe include, and widen the gate.** `"llama-ext.h"` on the next line — the compiler had stopped at the previous fatal error, so the fix had only moved the failure down one line. The gate now asserts the invariant (unresolvable quoted include ⇒ `<rnllama/name.h>` counterpart) rather than a header allowlist. |
| 25 | `0f313bab` | 18:59 | **Gate path resolution.** Re-audit: a sibling header in a subdirectory was wrongly rejected, and `"../name.h"` escaping `cpp/jsi` wrongly passed. Resolve through `cd … && pwd -P` on the include's own directory and require the result under `cpp/jsi`. **This is the current HEAD** (`git log -1` → `0f313bab`). |

### 7.3 App side (`kalsa`) — the pin bump, the layout port, and the log migration

| # | sha | time | what changed and why |
| --- | --- | --- | --- |
| 1 | `5a15067` | 09-19 09:02 | **`build(engine): pin llama.rn 95c3493b`** — the q4_K MoE OpenCL kernels build again. The crash being fixed: `kernel_gemv_moe_q4_k_f32_ns_wimg` called the 7-arg helper with 4 args, the program build failed, `ggml-opencl.cpp` `exit(1)`s, so every load that initialised the OpenCL backend killed the app (the Xiaomi tombstone at 00:49:57). `package-lock.json` regenerated in the same commit because CI runs `npm ci`. |
| 2 | `bad7b89` | 09-19 21:20 | **`chore(engine): bump llama.rn pin to the vendor-migration tip`** — `95c3493b` → `0f313bab`, llama.rn `0.12.9` → `0.13.0-rc.4`. Marked **"GROUNDWORK, NOT SHIPPABLE ON ITS OWN"**: the four app files encoding the pre-migration layout had to land with it. Lock regenerated by npm, not hand-edited (`version`/`integrity` stayed old under a hand edit). |
| 3 | `50b8196` | 09-19 21:29 | **`refactor(engine): port the app to the vendored engine layout, drop native/bmoe`.** `assert-overlay-includes.sh` rescanned for `cpp/` binding vs `vendor/llama.cpp` engine and *reads* the built-in exclusions out of the installed cmake; `engine-build-id.js` gains `vendor` in `ENGINE_TREE_DIRS` and reads the pin from `vendor/VERSIONS`; `assert-engine-provenance.sh` reads `LLAMA_CPP_COMMIT` instead of `cpp/KALSALLAMA_SHA`; `engineIdentity.test.ts` ported. Then `native/bmoe` is deleted (25 files). **The engine build id changes with this commit**, breaking identity comparisons with every earlier APK. |
| 4 | `be1696a` | 09-20 00:14 | **`fix(ci): read KV reuse from KALSA_KVPREFIX`** — the engine bump retired the line we parsed. Upstream `70fdbac7` replaced `LOG_INFO("[DEBUG] Input processed: n_past=… embd.size=…")` with a `LOG_VERBOSE`, and `RNLLAMA_VERBOSE` is defined nowhere, so the line is compiled out of every build. Six files moved to our own WARNING-level `KALSA_KVPREFIX` marker, with the field map read at the emitter: `n_past` → `n_common`, `embd.size` → `text_tokens` (**not** `embd`, which is the cache's own token vector). |
| 5 | `5429799` | 09-20 01:22 | **`fix(ci): print the turn's reuse number again, labelled when it is not size-matched`.** The first run of the new parsers came back green with turn-2 `UNKNOWN` while the collector held three usable markers: requiring `text_tokens == tokensEvaluated` made the exact match usually fail. Restores the last-load fallback and keeps the strict rule's protection by **labelling** unattributed numbers. Proven on the emulator, 20/20 steps green. |

The record's §29–30 (doc lines 2140-2288) is the full account, including the six files that keyed
on the dead marker (`benchGrade.mjs:219`, `ci-e2e.sh`, `ci-bench.sh`, `ci-lib.sh`,
`device-ciswire-cache.sh`, `test_sideload_guards.sh`) and the fact that `benchGradeHarness.mjs` fed
the *old* string to its own fixtures, so its tests stayed green regardless of what the engine
printed. Current consumers of `KALSA_KVPREFIX` in the app (11 files) include
`src/engine/LlamaService.ts` and `scripts/restoreVerdict.mjs`.

**The general lesson the record states and I would repeat:** a log line an instrument parses is an
API with none of an API's protections — no compiler, no lockfile, no version. The only defence is
to parse a marker you own and to assert, in the gate itself, that it is still being emitted.

---

## 8. THE REBASE COST, MEASURED

### 8.1 §12's number — the naive merge, re-measured on disk

Command (non-destructive, run just now):

```
git merge-tree --write-tree --name-only 95c3493b upstream/main    # name-only
git merge-tree --write-tree              95c3493b upstream/main    # with conflict types
```

`95c3493b` is the last pre-migration pin; `upstream/main` = `2af674ad` (still the tip locally).
Reading the output correctly matters: it emits the tree OID, then the conflicted-path list, then a
**blank line**, then informational messages. Counting the whole file gives 685 lines, which is
wrong; the conflicted-path block is 223 lines.

| | recorded (§12) | **re-measured** |
| --- | --- | --- |
| Conflicted paths | 223 | **223** |
| `CONFLICT (content)` | 96 | **96** |
| `CONFLICT (file location)` | 75 | **75** |
| `CONFLICT (modify/delete)` | 47 | **47** |
| `CONFLICT (add/add)` | 30 | **30** |
| rename/rename + rename-in-collision | 3 | **3** (2 + 1) |
| Auto-merged cleanly | 209 | **209** |
| Content conflicts under `vendor/llama.cpp/*` | 82 | **82** |
| **Content conflicts that actually need a human** | **14** | **14** |

All reproduce exactly. The 14, named (these are the real binding delta — the part §1b called the
bottleneck):

```
.gitignore  AGENTS.md  android/src/main/rnllama/CMakeLists.txt  ios/CMakeLists.txt
package.json  tsconfig.json
src/jsi.ts  src/types.ts
cpp/jsi/JSICompletion.h  cpp/jsi/JSIParams.cpp  cpp/jsi/RNLlamaJSI.cpp
cpp/rn-completion.cpp  cpp/rn-slot.cpp  cpp/rn-tts.cpp
```

Why the naive number is 223 and the real one is 14: 82 of the 96 content conflicts, and all 75
"file location" conflicts, exist only because upstream moved `cpp/X` → `vendor/llama.cpp/X` while we
had edited `cpp/X`. Under the adopted strategy those **do not occur at all** — once
`LLAMA_CPP_REPO` points at kalsallama and `cpp/` holds only the binding, the engine arrives through
`npm run sync:vendor` from a repo we control. There is nothing to merge because we stop carrying a
second copy of llama.cpp inside the binding.

### 8.2 §24's number — the real bump: 46 commits, one conflicted file, one line

Command, re-run now in kalsallama:

```
git rev-list --left-right --count 8537d097c...upstream/master   ->  159   46
git merge-tree --write-tree --name-only 8537d097c upstream/master
```

**159 commits of ours, 46 of theirs, exactly one conflicted path: `tests/CMakeLists.txt`.**
Auto-merged (both sides touched, clean): `ggml/src/ggml-cpu/ggml-cpu.c`,
`ggml/src/ggml-hexagon/ggml-hexagon.cpp`, `ggml/src/ggml-opencl/CMakeLists.txt`,
`ggml/src/ggml-opencl/ggml-opencl.cpp`, `include/llama.h`, `src/llama-model.cpp`,
`src/llama-model.h`, `tests/CMakeLists.txt`, `tests/test-backend-ops.cpp` — i.e. **9 files
auto-merged including the same file that conflicts**, and only one needs a human.

The conflict is **adjacency, not semantics**: our block of `test-governor-v0*` registrations was
appended immediately above upstream's `if (NOT GGML_BACKEND_DL)`, and upstream changed that line to
`if (NOT GGML_BACKEND_DL AND GGML_CPU)`. Both sides edited touching lines. Resolution: keep our
block, take their line. Four lines deleted, nothing reasoned about. Resolved as `b33bea25b` in the
rehearsal.

The rest of §24's measured bump:

| | value |
| --- | --- |
| Patches applied | 20/20 clean, **0 fuzzy, 0 failed**, before *and* after the merge |
| Manifest escapes | **0** (8 of 9 new upstream files landed via whole-directory entries; the 9th is `scripts/check-release-apiabi.sh`, which llama.rn should not vendor) |
| `vendor/` delta | 87 modified, **8 added, 0 deleted** |
| Build number | `11167` → `11214` (46 upstream commits + the merge) |
| CMake edits required | **0** |

Two measurement traps the record flags and I would keep: `git diff --name-status` does **not** see
files `rsync` created (they are untracked) — the first pass reported "87 M, no additions", an answer
wrong in the direction of comfort; `git status --porcelain` is the tool. And `patch` exits 0 on fuzz,
so the dry run must grep for `fuzz`/`offset` because `$?` cannot see them.

**What §24 explicitly does not cover:** that the bumped tree *compiles*. At the time, five of six CI
jobs were red on `bmoe_stream.h: No such file` (the layering inversion), so the compile half was
blocked behind §25. That is now unblocked — the app-side APK run `35481540345` on `50b8196` is
16/16 green (record §28) — but the bump rehearsal itself has **not been re-run** with a build step.
**[UNVERIFIED: the post-§25 re-run of the bump rehearsal with a compile gate.]**

### 8.3 §9.1's churn surface — re-measured, matches

`upstream/master` (= `e613ef2c8`, 2026-09-19), window 2026-06-21 → 2026-09-19:

| path | recorded commits | **re-measured** | our delta |
| --- | --- | --- | --- |
| `ggml/src/ggml-opencl/ggml-opencl.cpp` | **59** (41/90 days = 46%) | **59** | +3124/−117 |
| `tests/test-backend-ops.cpp` | 106 | **106** | +640/−10 |
| `ggml/src/ggml-hexagon/` | 39 | **38** (window-boundary difference) | +50/−4 |
| `ggml/src/ggml-opencl/kernels/` | 36 | **36** | +1913/−356 (our 6 files: 0 upstream touches) |
| `ggml/src/ggml-cpu/ggml-cpu.c` | 13 | **13** | part of the q23k cluster |
| `ggml/src/ggml-cpu/repack.cpp` | 2 | **2** | |
| `ggml/src/ggml-cpu/repack.h` | 0 | **0** | |
| `ggml/src/ggml-cpu/traits.cpp` | 0 | **0** | |
| `ggml/include/ggml-cpu.h` (our hook) | 1 | **1** | the `expert_ready_hook` |

**The sentence that decides the strategy: one file carries the whole recurring cost.** 3124 of our
~5400 churn-exposed engine lines sit in a file upstream edits on 46% of calendar days. Everything
else we hold is either in files we own (never merge-conflict) or in files upstream has effectively
frozen.

The record drew two consequences. The first stands and was later **downgraded**: §10.5 measured that
77 hunks and ~19–20 free-standing top-level definitions account for the +3124, so the realistic
relocatable range is 300–800 of 3124 lines (10–25%, ~20 of 77 hunks) — do it, but it is not "the
single highest-value refactor". The second — do **not** upstream `ggml_cpu_set_expert_ready_hook`,
because holding it costs nothing (1 commit/90 days) and standing policy forbids opening upstream
issues — stands.

### 8.4 Deliberate divergences that cost at every future rebase

**Recorded in §12.3: exactly one entry — and it is now obsolete.** The hard `#error` on
`GGML_OPENCL_USE_ADRENO_BIN_KERNELS` (commit `754a96426`) was **removed** by `cf1bc2395` the same
day. **[VERIFIED] `grep -n '#error' vendor/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp` returns
nothing.** So the recorded divergence list is empty, and the doc's "delete this when the ILA kernel
is rebuilt on the 16-arg ABI" is moot.

What actually costs at every rebase today is **structural**, not a recorded divergence list:

| divergence | shape | cost per bump |
| --- | --- | --- |
| **58 modified upstream files** in the kalsallama delta (68 added / 58 modified total; the modified set spans engine, `common/`, `tools/` and one CI workflow) | lines/hunks inside upstream functions | proportional to how far upstream moved under them |
| `ggml-opencl.cpp` (+3124/−117, 77 hunks) | the single largest | one hand-resolution session, plus reading `use_q4k_tiled` / mask-args interactions |
| our block at the end of `tests/CMakeLists.txt` | positional adjacency | one mechanical line, every bump that touches that line |
| `ggml/src/ggml-cpu/repack-q23k.h` + its 3 includers | exported-by-manifest, not by upstream | cheap **by luck of timing** — two open upstream PRs target those exact files (§9.5) |
| `cvt.cl` delta at `@@ -118,0` | direct collision risk with open upstream PR #28577 | unquantified |
| `15ad4b8e3` (Hexagon HMX `%32` eligibility gate) | auto-merges today | survives **by luck of git, not by decision** |
| `llama.node` consuming `vendor/llama.cpp` through upstream's CMake | keeps CUDA/Vulkan/WebGPU + all of `common/` in the tree | package bloat, not conflict cost |
| pin `b11010`-era OpenCL kernel list duplicated by hand in llama.rn | upstream `b11010` = clean; `b11046` diverged | a build break at that bump class |

**A gap worth flagging:** §10.7 (the largest lever — never be more than one release behind) requires
recording, per bump in `KALSA_FORK.md`: date, `upstream/master` sha, lines changed in
upstream-owned files per repo, hunk count, `merge-tree` conflict count. **[VERIFIED]
`KALSA_FORK.md` (51 lines) has no such section and no bump record.** So the cadence rule is stated
in the doc but not instrumented in the repo, and the next bump has no baseline to compare against.

---

## 9. THE GATE FOR A CHEAP NEXT REBASE (§1b), AND THE RULES THAT FOLLOW

### 9.1 The goal, in the owner's words

Record §1b quotes the owner, 19/09: *"fare in modo che i prossimi rebase upstream siano facili e
indolori."* Migrating once is not the goal; the goal is that the migration **after** this one costs
hours, not days. A migration that lands but leaves our delta shaped the same way has failed,
because we will pay this bill again at every bump.

The metric is not lines of our code. It is **edits to upstream-owned files** (and, after §10.4's
repair, **lines changed and hunks** in them). Evidence from the migration itself: the four
`rn-governor*` files are +306 lines and port for free; `cpp/rn-tts.cpp` is +12 lines of ours and was
the single most expensive file, because upstream grew it to 3233 lines underneath us.
**Twelve lines in someone else's file cost more than three hundred in ours.**

### 9.2 The gate, as written

Steps 6 and 8 are not done until this is true and recorded:

1. A count of **edits to upstream-owned files, before and after**, in both repos. The number must go
   down; where it does not, the reason is written next to it. **Repaired by §10.4.2** to count lines
   changed and hunks, not files — otherwise §9.1's relocation move (lines out of `ggml-opencl.cpp`,
   file count unchanged at 1) would pass a do-nothing change.
2. For each of the 16 edited binding files: either it is reduced to a call into a file we own, or
   `KALSA_FORK.md` says why it cannot be. **Repaired by §10.4.1:** "new files we own never conflict"
   is false as an absolute — they cannot *merge*-conflict, but they can still be **dropped by lists
   and manifests we do not own**. This migration had three instances: `repack-q23k.h` (killed by the
   export manifest), our 6 MoE `.cl` kernels (dropped by `GGML_OPENCL_KERNELS`), and the
   `common.h.patch` basename we would newly occupy. Read the rule as: *free of merge cost, not free.*
3. A dry-run of the next bump — `git merge-tree --write-tree` against the then-current
   `upstream/master` — recorded in `KALSA_FORK.md` as the baseline the following bump is measured
   against. If we cannot produce that number, we have no evidence the objective was met.

**Anti-goal, stated in §1b and worth keeping:** do not reduce the edit count by deleting behaviour,
and do not reduce it by moving code into a file we own that upstream then has no reason to call.
Rule 2's "one call site" still needs that one call site to exist and to be in the right place.

### 9.3 The six rules that follow

1. **New capability goes in a new file.** An edit to an upstream file is a recurring tax; a new file
   is paid once. When both are possible, take the new file even if it is more code. *(Amended by
   §10.4.1: free of merge cost, not free.)*
2. **Where an edit is unavoidable, shrink it to a call.** The ideal edit to an upstream file is one
   line that calls into a file we own. Fifty lines of our logic inlined into `rn-completion.cpp` is
   fifty lines that must be re-read against every upstream refactor; one call site is one line.
3. **Prefer an upstream extension point; if none exists, consider upstreaming the hook itself.**
   **STRUCK by §10.4.3.** `ggml/include/ggml-cpu.h` took 1 commit in 90 days, so holding our
   `ggml_cpu_set_expert_ready_hook` as a patch costs nothing; and `PLAN.md` (04/09) says *"Non aprire
   nessuna issue upstream. O fixiamo noi stessi o lasciamo perdere."* Leaving the rule in invites a
   future agent to do the forbidden thing.
4. **Every edit to an upstream file carries a one-line reason, in `KALSA_FORK.md`.** Not for
   documentation's sake: it is what makes rule 5 answerable in minutes. **[VERIFIED] this is
   currently done by comment-in-place** — the patches carry one-line preambles
   (`function-gemma.cpp.patch:1`) and the vendored sources carry `KALSA` comments (11 in
   `ggml-opencl.cpp`) — but `KALSA_FORK.md` itself carries **no per-edit list**. The one edit it
   documents explicitly is the `TAG_KV_CACHE_SHARE_CELLS` / `init_mtp` draft-clear pin-bump
   checklist (`KALSA_FORK.md:46-51`).
5. **Run the supersede check before every bump.** `git log -S <our subject> <base>..upstream/master`
   per edit. On this migration it deleted three carried changes: the Hexagon `error_count`
   (upstream's `eafe15a5e` is strictly stronger in its own model), the noshuffle `%128` rule
   (upstream relaxed to `%64` and ours became *wrong*), and seven duplicate cherry-picks.
6. **Adopt upstream's mechanism instead of building a parallel one.** This entire migration exists
   because we wrote an 845-line sync script to do what upstream now does with `VERSIONS` +
   `sync-vendor.sh`. A parallel mechanism's cost is not the code, it is that it drifts out of the
   upgrade path and one day has to be demolished under time pressure.

### 9.4 The other lever §10.7 adds, and where it stands

**Never be more than one upstream release behind.** That turns a 245-commit merge into N 20-commit
merges, each cheap, with the supersede check run each time. Larger than any refactor in §9.1, and it
costs nothing but discipline. §10.7 requires recording, per bump in `KALSA_FORK.md`: date,
`upstream/master` sha, lines changed in upstream-owned files per repo, hunk count, `merge-tree`
conflict count.

**[UNVERIFIED / NOT DONE]** `KALSA_FORK.md` has no such record section. Nor does the fork have an
automated bump-cost reporter. So today the "next rebase is cheap" property is backed by the layout
plus two wired gates, but the *measurement* §1b asked for is still a manual act nobody has
performed since `24.4`.

### 9.5 What does satisfy §1b today (so the orchestrator can answer "did it work?")

- The engine is a real fork consumed through one mechanism we do not own
  (`VERSIONS` + `sync-vendor.sh`), not a parallel one — rule 6.
- `cpp/` shrank to 39 files with only 6 new and 13 modified, and the engine's 68+58 files never
  merge-conflict because they arrive from our own repo — the 223→14 result of §8.1.
- The measured bump is 1 conflicted file / 1 line / 0 fuzz / 0 manifest escapes — §8.2.
- Both gates run automatically, in `sync-vendor.sh` and in CI — §6.
- `AGENTS.md:69-71` and `KALSA_FORK.md` document the channel rule so the *next* agent does not
  re-derive it — §1.3.

---

## 10. LATENT RISKS / OPEN ITEMS

Each entry: what it is, where it is on disk, whether it is reachable today, and its resolution state.
"Reachable? no" means no current code path hits it, which is a statement about our usage, not a
proof of safety.

### 10.1 `MoeStream`'s abort callback can outlive its target — **OPEN, recorded, not fixed**

`cpp/bmoe_stream.cpp:305-308`:

```cpp
    llama_set_abort_callback(
        ctx,
        [](void * ud) -> bool { return static_cast<bmoe::ExpertStreamSource *>(ud)->fatal(); },
        st_->source.get());
```

The callback's user-data points at `st_->source.get()`, and **nothing ever clears it**.
`MoeStream::shutdown()` (`cpp/bmoe_stream.cpp:86-101`) resets `st_->source` but has no `ctx` — `ctx`
is a local parameter of `bind(llama_context * ctx, std::string & err)` (`:206`), so it *cannot*
clear it. After `shutdown()`, the llama_context still holds a dangling callback.

Reachable? **No**, held off by caller discipline: `cpp/rn-llama.cpp` destroys the context
immediately after `moe_stream->shutdown()` (the reload block around `:753-762`, whose comment
documents exactly that ordering). It is a use-after-free held off by convention rather than by the
class. Watch this before any change to the unload path.

### 10.2 `ggml_cpu_set_expert_ready_hook` is process-global, bmoe treats it as per-stream — **OPEN**

Declared and documented as process-global in the vendored tree:
`ggml/include/ggml-cpu.h:150-152` — "Process-global registration; pass NULL to unregister. Not
thread-safe with respect to concurrent graph computation - register before compute starts."
Storage is two file-static globals (`ggml/src/ggml-cpu/ggml-cpu.c:62-63`).

But each `ExpertStreamSource` registers its own object
(`vendor/llama.cpp/src/bmoe/expert_stream_source.cpp:1385`) and **any** stream's shutdown
unregisters the single global (`:1426`, comment at `:1421-1423` acknowledges the ordering).
`cpp/bmoe_stream.h:30-31` says the class "holds the process-global expert-ready hook while live".

Reachable? **No** in the app as shipped (one context at a time), but two live contexts — or a
governor path plus a stream — overwrite each other. This is why `MoeStream` exists as a
single-owner seam rather than as free functions. Worth knowing before the next round of bmoe work.

### 10.3 `LLAMA_CPP_REPO` silently ignored — **CLOSED**

Record §10.1's finding: `sync-vendor.sh` keyed the clone cache on the dependency **name**, never the
URL, so flipping `LLAMA_CPP_REPO` from ggml-org to kalsallama did nothing if
`~/.cache/llama.rn/llama.cpp` already existed. Two rules followed:

- (a) assert `git -C "$repo" remote get-url origin` equals `$url`, else re-clone — **implemented**
  at `scripts/sync-vendor.sh:221-226` (`758a6966`) with the rationale in the comment at `:217-220`.
- (b) **always pin a 40-hex sha, never a tag name that also exists upstream** — **satisfied**:
  all four refs in `vendor/VERSIONS` are 40-hex (`vendor/VERSIONS:8,12,16,20`), and
  `ensure_repo` branches on `^[0-9a-f]{40}$` (`:253`). This converts the trap from silent to loud
  even if (a) is lost in a future upstream merge.

**[VERIFIED]** the local cache's `llama.cpp` origin is now `https://github.com/Aspis0/kalsallama`,
so the guard is live and correctly keyed on this machine.

### 10.4 The `#error` criterion — **MOOT, but the underlying hazard stands**

Record §12.3 recorded one deliberate divergence: a hard `#error` on
`GGML_OPENCL_USE_ADRENO_BIN_KERNELS` (`754a96426`), with the criterion "delete this when the ILA
kernel is rebuilt on the 16-arg ABI." `cf1bc2395` **deleted it the same day** as over-broad (it
would break a documented upstream configuration, `docs/backend/OPENCL.md:85`, and the risk on our
hardware is ~nil).

**[VERIFIED] no `#error` remains** in `vendor/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp`. What
remains is the honest comment at `:28312-28320`: the ILA binary
(`kernel_gemm_moe_q4_k_f32_ns_ila`) still takes the 13-arg literal-mask ABI the E031.41.03.62
compiler miscompiles, it comes from an external library resolved **per GPU name** targeting X2 parts,
and the branch is "reachable only under `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` on a GPU the library
covers, a configuration we do not build or verify." So the hazard is documented rather than guarded.

### 10.5 The daily cron (§3.5 / §7) — **CLOSED, differently from the plan**

The plan said the cron "arrives with the merge" and must be disabled or repointed. It does not:
**`.github/workflows/sync-llama-cpp.yml` was deleted on our branch at `bb4a2c60` (2026-09-17)**
(commit message item *"F12: delete .github/workflows/sync-llama-cpp.yml and
scripts/sync-llama-cpp-submodule.sh — both drive the removed llama.cpp [submodule]"*), and the merge
did not bring it back. **[VERIFIED]** `git ls-files .github/workflows/` → 4 files;
`git ls-tree upstream/main .github/workflows/` → 5, including `sync-llama-cpp.yml`. Our workflows are
`build-example-android.yml`, `ci.yml`, `release.yml`, `stale.yml`.

Two side effects to be aware of:

- `scripts/update-llama-cpp.sh` **is** present (inherited from upstream) and is now **orphaned** —
  **[VERIFIED]** `grep -rn 'update-llama-cpp'` over the fork (excluding `vendor/`, `node_modules/`)
  returns nothing. Dead code that documents a workflow we do not run.
- `vendor/README.md:41-46` still documents the daily `sync-llama-cpp` workflow and the
  `auto/sync-llama.cpp` branch. That paragraph is inherited from upstream and is **false in this
  fork**. A documentation defect in a file whose whole job is to explain how the tree is maintained.

### 10.6 `LLAMA_USE_SYSTEM_GGML=ON` cannot build bmoe — **OPEN, recorded, never used here**

`vendor/llama.cpp/CMakeLists.txt:51` declares `option(LLAMA_USE_SYSTEM_GGML "Use system libggml" OFF)`
and honours it at `:214`, `:220`. Deleting `BMOE_HAVE_EXPERT_READY_HOOK` made `libllama` depend on a
fork-only ggml symbol (`ggml_cpu_set_expert_ready_hook`) **unconditionally**
(`vendor/llama.cpp/src/bmoe/expert_stream_source.cpp:5` says so in the include comment), so that
configuration cannot link. llama.rn never sets it. Standing hazard for anyone building the vendored
tree through upstream's own CMake project (llama.node).

### 10.7 Model filesystem paths reach logs — **OPEN, recorded**

`vendor/llama.cpp/src/bmoe/file_reader.cpp:28` (and `:42`, `:53`, `:71`, `:72` open calls):
`std::fprintf(stderr, "bmoe: open %s failed\n", path.c_str());` prints a model path. Recorded in
§27.8 as a latent privacy item, never fixed. Relevant because the lab has a separate
`kalsa-log-privacy` workstream.

### 10.8 The recurring `tests/CMakeLists.txt` conflict — **OPEN by decision**

One mechanical line per bump (see §8.2). The zero-cost fix is to move the governor test block into
its own `tests/CMakeLists-kalsa.cmake` included from the top of the file, making the conflict
structurally impossible. Not done: "one mechanical line per bump is not yet worth a refactor."
Note `git rerere` would **not** help — it only replays an identical conflict preimage, and
upstream's side of the line differs at every bump.

### 10.9 The same-engine proof is still incomplete — **OPEN**

Record §10.9 requires two things: both native markers in `librnllama*.so`, **plus** a fixed prompt
and seed producing token-identical output against the pre-migration APK
(`/Users/marco/kalsa-apks/35444615003/app-release.apk`). The marker half is done (record §28: both
`kalsa-native-patches` and `q23k` found in all 7 release binaries in the app's APK run
`35481540345`). **The token-identical half is recorded nowhere as performed** —
`grep -n 'token-identical'` in the record returns only the two places that *ask* for it (§10.9,
§21.3) and the two that note the engine build id changed underneath it (§27.9, §28).

Two things make it harder than it reads: (i) the engine build id changed when `native/bmoe` was
deleted (`scripts/engine-build-id.js:195` digests the whole `native/` tree), so identity comparisons
"do not cross" that commit; (ii) the app has since moved through the `KALSA_KVPREFIX` instrument
change, whose own e2e numbers (turn-2 `2282/2304`, restore `2538/2560`) are in-range with the
pre-bump run (`2288/2310`, `2474/2496`) but are **not** a token-identical proof.

### 10.10 Smaller residuals **[VERIFIED on disk]**

- **`scripts/kalsa-patches/common.{h,cpp}.patch` still tracked**, referenced by no script since
  `54c99f14` deleted `sync-kalsallama.sh`. Stale duplicates of the unioned
  `scripts/patches/llama.cpp/common.{h,cpp}.patch`. The record's step 8 listed `kalsa-patches/` for
  deletion; it did not happen. (See §3.6.)
- **`cpp/bmoe_stream.h:3` carries a stale comment** — "The streaming engine itself is vendored
  unmodified under native/bmoe/{include,src}". After `dc205f56`/`e1866612d` the engine core is
  `vendor/llama.cpp/src/bmoe/`, and `native/bmoe` no longer exists anywhere. The comment is an
  assertion about the relocation and it is wrong; the record's own §19 lesson was exactly that "a
  comment that describes a relocation is an assertion about the relocation."
- **`lib/` is not regenerated by `sync:vendor`.** `sync-vendor.sh:376-379` writes `src/version.ts`;
  `lib/` comes from `npm run build` (bob) and is committed. `assert-kalsa-vendor.sh:129-151` catches
  disagreement, so the failure is loud, but the fix is a human running `npm run build`. It has
  drifted once before (§26.1).
- **Three OpenCL defects deliberately not fixed** (§4.4 above, record §13.3), with a device-session
  queue.
- **The bump rehearsal has no compile half yet** — see §8.2's [UNVERIFIED].
- **No per-bump cost record exists**, though §10.7 requires one in `KALSA_FORK.md` — see §9.4.
- **§9.5's two standing hazards in `KALSA_FORK.md`'s pin-bump checklist** (`:46-51`) cover
  `TAG_KV_CACHE_SHARE_CELLS` / the `init_mtp` draft-clear probe. The record's other two standing
  hazards — the q4_K `kernel_..._ns_bin` guard keying on kernel *availability*
  (record §4) and the open upstream PRs on the repack cluster (#23492, #15719, §9.5) — are **not**
  in `KALSA_FORK.md`. Writing them there was requested; **[UNVERIFIED whether it was done — they are
  absent from the file as it stands].**

### 10.11 What §17.2 called a blocker is now gone

Record §17.2 recorded that `b11010-merge` was **local only**, so step 7 could not commit a working
pin. **[VERIFIED]** it is pushed: `git rev-parse origin/b11010-merge` → `8537d097c…`, and
`git branch -r --contains 8537d097c` lists `origin/b11010-merge`. `LLAMA_CPP_REF` still takes the
40-hex sha, as required.

---

## APPENDIX A — VERIFICATION LEDGER

**[VERIFIED on disk] by this briefing** (commands in the body):

- Pins: HEADs, branches, resolvable commits for all four `vendor/VERSIONS` entries; cache origin URLs
  per dep; `vendor/VERSIONS` sha form.
- Layout: per-dir tracked file counts (1412/91/19/35, 1559 total); the vendor tree carries no `tests/`
  and only `tools/mtmd`.
- Version files agree: `11169`/`8537d09` in `src/version.ts`, `build-info.cpp:7`,
  `llama-version.h:4`, `ggml-version.h:4`, and all three `lib/` copies.
- `scripts/sync-vendor.sh` and `update-patch.sh` read in full; `KEEP` list, manifest, and the
  cache-url guard at `:221-226`.
- Patch set: 20 files, all present on `upstream/main`; **only `common.{h,cpp}` differ** from upstream
  (+38/−6).
- Engine delta vs `b11010`: 68 added / 58 modified, with full name lists; `llama-memory-hybrid*` and
  `llama-ext.h` verified as **upstream files we modified**, not fork-only.
- Padded-grid guards present in the vendored kernels; **no `#error`** in `ggml-opencl.cpp`; the
  honest comment at `:28312-28320`.
- Binding delta vs `upstream/main`: 19 files, +2168/−365, per-file numstat; `cpp/` = 39 files.
- `LM_`/`lm_` prefix: **0 files** in both `vendor/llama.cpp` and `cpp/`.
- `ci.yml`: 7 jobs, `grep -c 'refs/heads/kalsa'` = **0**, no `if:` outside a comment.
- `sync-llama-cpp.yml` absent from our branch, present on `upstream/main`, deleted at `bb4a2c60`;
  `scripts/update-llama-cpp.sh` is orphaned.
- §12's naive-merge numbers **re-measured exactly**: 223 paths / 96 / 75 / 47 / 30 / 3 ; 209
  auto-merged ; 82 content conflicts under `vendor/llama.cpp/` ; **14** real, named.
- §24's bump numbers **re-measured**: 159 ahead / 46 behind, **1** conflicted path
  (`tests/CMakeLists.txt`), 9 auto-merged files listed.
- §9.1's churn surface **re-measured and matching** (59 / 106 / 38 / 36 / 13 / 2 / 0 / 0 / 1).
- Latent hazards 10.1, 10.2, 10.6, 10.7, 10.8, 10.11 verified at file:line.
- Engine `b11010-merge` is pushed (`origin/b11010-merge` = `8537d097c`).

**[From the record, NOT independently re-verified — no network / no `gh` in this session]:**

- All CI run ids and verdicts (`35465310732`, `35466782230`, `35470060692`, `35472151797`,
  **`35474384553` = 7/7**, `35476684286`) and the app-side runs (`35481540345` = 16/16,
  `35483990916` = 20/20, `35463404191`, `5429799`, `35307242869`, `35360547883`).
- Device measurements (S23 numbers, MoE timing deltas, e2e reuse counts).
- The pre-migration APK's sha256 and path.
- §17.1's patch-replay dry run and §24.2's patch dry-run counts (0 fuzz / 0 rejects).
- Upstream PR reconnaissance (#391/#392/#393, #400, #23492, #15719, #28577) — re-measuring needs
  network.

**[Flagged as unverified or as a correction to the record]:**

1. `vendor/README.md:41-46` documents a daily cron this fork does not have (§10.5).
2. `scripts/kalsa-patches/` was listed for deletion in step 8 and is still tracked (§10.10).
3. `cpp/bmoe_stream.h:3` describes the pre-move engine location (§10.10).
4. Two of the record's "standing hazards" (the q4_K `_ns_bin` availability guard; the open repack
   PRs) are not in `KALSA_FORK.md`, though writing them there was the action (§10.10).
5. §10.7's per-bump cost record does not exist (§9.4).
6. The §10.9 token-identical same-engine proof is not recorded as performed (§10.9).
7. The post-§25 re-run of the bump rehearsal with a compile gate has not happened (§8.2).
8. §10.6's prediction that the cron "arrives with the merge" is wrong — our branch had already
   deleted it (§10.5).
9. §5's step 1 note about `kalsa-patches` basename collision is settled by the union, but the
   pre-union files linger.

## APPENDIX B — THE FIFTEEN-SECOND ANSWER

- **Two channels.** Engine fixes go in `kalsallama` and reach the fork through
  `vendor/VERSIONS` + `npm run sync:vendor`; binding fixes are edited directly in `cpp/`. Never
  hand-edit `vendor/llama.cpp` — it is lost on the next sync (`KALSA_FORK.md:14-21`).
- **The engine is ours**: kalsallama `8537d097c`, 68 added / 58 modified files, including the
  governor v0.3 suite, `src/bmoe/` (22 files), the OpenCL KALSA diagnostic TU, and the padded-grid
  guards. It arrives verbatim, not as patches.
- **The only kalsa patches** are `kalsa_moe` + `kalsa-native-patches` unioned into upstream's
  `common.{h,cpp}.patch`.
- **Gates run by themselves**: `assert-kalsa-vendor.sh` (engine identity, patch union, 7-char
  commit, `lib/` consistency) + `assert-rnllama-sources.sh` (manifest coverage, framework-safe
  includes), in `sync-vendor.sh` and in CI's unconditional `vendor` job. CI is 7 jobs with zero
  branch guards.
- **Rebase cost today**: a 46-commit upstream bump costs **one conflicted file / one line**; the
  naive pre-migration merge would have cost 223 conflicted paths, of which 14 were real.
- **The recurring cost** is concentrated in `ggml-opencl.cpp` (upstream edits it on 46% of days,
  we carry +3124 lines there).
- **What is still open**: the abort-callback lifetime and the process-global expert hook (both
  unreachable today, both by caller discipline); the token-identical same-engine proof; the
  per-bump cost record; a stale comment and two stale files; three OpenCL defects queued for a
  device session.
