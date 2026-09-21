# Commit map: `Aspis0/kalsa.rn`, branch `vendor-migration`

Explorer report. Read-only recon on `git -C /Users/marco/Projects/llama.rn-kalsa`.
Every claim below carries a `file:line` or a commit hash.

## Scope and the branch as found

| item | value |
|---|---|
| pinned branch tip | `origin/vendor-migration` = `0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` |
| local `vendor-migration` ref | `0f313bab` (one commit behind; not fetched) |
| local `HEAD` | `0f313bab464ef28a58a8b4b2a37a5d4c1968b54e` |
| git remote | `origin = https://github.com/Aspis0/kalsa.rn.git` |
| upstream remote | `upstream = https://github.com/mybigday/llama.rn.git`, `upstream/main` = `2af674ad` (push DISABLED) |
| working tree | clean except two untracked files, `pnpm-lock.yaml` and `pnpm-workspace.yaml` (not ours, not committed) |

Commit arithmetic in the window `--since=2026-09-04` on `origin/vendor-migration`:

| filter | count |
|---|---|
| all commits | 80 |
| merges | 4 (`3eb8ac2f`, `0a87a8ef`, `c8abc1f5`, `74836284`) |
| non-merge | 76 |
| non-merge, author `Marco Gualtieri` | 62 |
| merges, author `Marco Gualtieri` | 4 |
| **ours, total** | **66** |
| non-merge, not ours | 14 (13 upstream authors + `github-actions[bot]` twice) |

The brief says 75 non-merge / about 61 ours. My measured numbers are 76 / 62. The
difference is exactly the tip commit: counting the local ref `0f313bab` instead of
`origin/vendor-migration` gives 75 / 61. The brief's stated tip is `0288dc27`, which
only exists on `origin`, so the brief's counts and its tip are inconsistent with each
other. I map the `origin` tip and list all 66.

The brief also says "one `github-actions[bot]`". There are two: `4fd06f30` (b10951)
and `e694afca` (b11010).

The oldest commit in the window is `95c69e87` (2026-09-08, `dongjiang`). The window
therefore starts at the first commit after the 2026-09-04 engine merge that commit
`08ba95e8` refers to, not at a 2026-09-04 commit.

## ANSWER FIRST

### What the branch is made of

Three strata, in this order, and a reader following an old note will look for files
that no longer exist unless the stratum is named. Counts are measured by testing each of
the 66 commits for `cpp/ggml.c` (flattened tree present) versus
`vendor/llama.cpp/ggml/src/ggml.c` (vendored tree present):

1. **Pre-migration, flattened `cpp/` tree** (17-19 Sep, **42 of the 66**). The engine
   lived at `cpp/` as generated files flattened and `LM_`/`lm_`-prefixed by
   `scripts/sync-kalsallama.sh` (845 lines, ours); 777 files under `cpp/` at
   `d6d95ecc`, the last tree before the merge (measured; the migration record's "741
   generated files" figure does not reproduce at any of the three checkpoints I tried,
   so treat 777 as the measured value and 741 as that document's own). The pin was
   `kalsallama.pin` (JSON), and the identity marker was `cpp/KALSALLAMA_SHA`.
   **All four are gone at the tip** (deleted by `54c99f14` and `4fab9622`).
2. **The migration proper** (19 Sep, the 10 commits of group G7 plus the merge
   `74836284`). `95c3493b` in G7 is the last pre-migration commit, so G7 straddles the
   line; the ordered account is in answer 1.
3. **Vendor era** (19-20 Sep, **24 of the 66**, including `74836284` itself).
   `vendor/llama.cpp/` is the engine tree, `vendor/VERSIONS` is the pin, and
   `scripts/sync-vendor.sh` (upstream's) is the sync.

At the tip `cpp/` holds 39 files: the binding layer llama.rn owns. The merge result
`74836284` left 69 files under `cpp/` (the flattened upstream files were gone, the
kalsa-owned ones were not), and `54c99f14` cut that to 37; `dc205f56` added
`cpp/bmoe_stream.{h,cpp}`. `vendor/llama.cpp/` holds 1412 files, and `kalsallama.pin` no
longer exists.

### The three biggest things it accomplished

1. **Replaced a home-grown engine-sync machine with upstream's, and re-pointed the
   engine at our own fork.** `d6d95ecc` -> `74836284` (merge) -> `54c99f14` ->
   `2f1996d4`. Measured: 24,531 deleted lines in `54c99f14` alone (31 `cpp/` files,
   12 of them byte-identical `vendor/hash` duplicates, verified with `git rev-parse`
   per file), and `LLAMA_CPP_REPO` moves from `ggml-org/llama.cpp` to
   `Aspis0/kalsallama` at `2f1996d4`. This is the migration record's stated objective,
   and it is the thing that makes the next upstream bump a merge instead of a
   151-resolution rebase.
2. **Moved the shipped engine onto the released pin while carrying the q4_K MoE OpenCL
   fix.** The `LLAMA_CPP_COMMIT` ladder is `134a35cf2` -> `70b4302bb` -> `237461a98` ->
   `2361be359` -> `f6ba2786d` -> `e1866612d` -> `8537d097c` -> `4ccef2f85`. The last
   three are ours-in-the-vendor-era (`dc205f56`, `0a9b9379`, `0288dc27`). The
   mask-as-arguments form is present at the tip
   (`vendor/llama.cpp/ggml/src/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl:99` and
   `:219`) and at `0f313bab`, which is the pin the app ships.
3. **Made the binding build and behave again on the new engine, and put assertions in
   front of it.** The consumer repairs (`afc82485`, `bde3f975`, `ffbd39e8`,
   `fada1ebe`, `05612f2b`, `4126b729`) plus the MTP shared-KV fallback chain
   (`bff76818`, `a0bfc383`, `57c530cc`, `628f4517`) plus five gate commits now wired
   into both `sync-vendor.sh` and CI (`4e3b2385`, `6eea3f53`, `88e7eed5`, `18f3ff33`,
   `11cc0f9f`).

### What it did NOT do

- **It did not fix any governor defect.** Defects 5.1, 5.2 and 5.3 are all live in the
  tree at `0288dc27` (evidence in answer 2).
- **It did not do governor feature work after 2026-09-17.** The parser was written once
  (`987799a1`, 17 Sep) and never edited again. The last governor-touching commit is
  `f5fd027b`, a one-line compile fix. The governor plan's Part 9 step 1 was not started.
- **It did not move the engine pin past `4ccef2f85`.** So no engine-side governor fix
  has been brought over: there is none at that pin.
- **It did not verify anything on a device.** `95c3493b` says so in its own body:
  "Not measured on a device. Whether the governor loads on the Xiaomi is the next step,
  not a claim of this commit."
- **It did not do iOS/Metal work beyond making the framework includes compile**
  (`739d7a54`, `a974a52b`, `0f313bab`) and the TTS vocoder params (`652414cb`, a path
  its own message calls "not reachable from the kalsa app").
- **It did not blur the `tools/server` boundary.** No commit in the window names
  `tools/server` in any build file or manifest (answer 3).

---

## TOPIC-GROUPED MAP

Format: `hash subject`. CHANGES is the diff; SERVES is the plan item it lands on.
`[flat]` = pre-migration `cpp/` era, `[mig]` = the migration, `[vend]` = vendor era.

### G1. Make the fork consumable as a git dependency, flattened engine (17 Sep, flat)

- **`130cc023` build: track lib/, bin/ and OpenCL headers; drop install-time scripts and submodules.**
  CHANGES: commits `lib/` (bob output), `bin/arm64-v8a/libOpenCL.so` and the four
  `libggml-htp-v7[3579]/v81.so`, `install/native-artifacts.json`, and the vendored
  `third_party/OpenCL-Headers/CL/*` (18 headers); deletes `.gitmodules`, `postinstall`,
  `prepack`. SERVES: the app consumes this repo as `github:Aspis0/llama.rn#<sha>`, not
  from npm, so anything the tarball carried must be tracked. This is the packaging
  precondition for every later commit.
- **`81a32498` engine: cpp/ is kalsallama 134a35cf2, flattened.**
  CHANGES: 353 files, +64325/-27771, replacing llama.rn's `cpp/` with kalsallama at
  `134a35cf2` flattened and `LM_`-prefixed; creates `cpp/KALSALLAMA_SHA`, keeps
  `kalsallama.pin`. SERVES: makes the fork's engine byte-equal to what the app shipped
  at kalsa `4cf44d8`. Nothing in the plan; it is the equivalence baseline the gates
  then measure against.
- **`987799a1` kalsa: native patch set (governor, slot manager, JSI, MoE streaming params).**
  CHANGES: 25 files, +1899/-468. Creates `cpp/rn-governor-params.cpp/.h` and
  `cpp/rn-governor.cpp/.h`, the flattened `cpp/llama-governor-*.cpp/.h` (6 files),
  `cpp/llama-ext.h`, `cpp/llama-hybrid-commit.*`, `cpp/llama-kv-commit.*`,
  `cpp/llama-kv-staged.*`, `cpp/llama-memory-hybrid-idx.*`, the KV/DSWA caches, and the
  two hunks on `cpp/common/common.{cpp,h}` (the `kalsa-native-patches` marker and the
  `kalsa_moe` struct). On the TS side it adds the governor JSI bindings and types
  (answer 3). SERVES: this is the commit that puts the governor into the binding at all.
  It is also the origin of four later fixes (`2e313c77`, `45fee016`, `da845d16`,
  `619acfa9`), and it is the commit that wrote defect 5.2.
- **`eb9a6da7` build: regenerate cpp/ from kalsallama.pin (sync script, kalsa patches, verify).**
  CHANGES: +760, adds `scripts/sync-kalsallama.sh` (677 lines) with `pin|bump|verify`,
  `scripts/kalsa-patches/common.{cpp,h}.patch`, and the `tmp/` gitignore. SERVES: makes
  `cpp/` regenerable and hand-edits detectable. Plan item: none, but it is the machine
  the migration then demolishes.
- **`bb4a2c60` build: harden sync-kalsallama.sh verify/pin (script only, cpp/ unchanged).**
  CHANGES: 181+/324-. Fixes the regen order, makes `KALSALLAMA_SRC` read-only, adds
  `assert_kalsa_post_image` and `assert_patch_path`, ports the app's
  `assert-overlay-includes.sh` into `scripts/assert-cpp-includes.sh`, and deletes
  `.github/workflows/sync-llama-cpp.yml` plus `scripts/sync-llama-cpp-submodule.sh`.
  SERVES: closes the "silent patch drop" class. Plan item: none.
- **`de67c015` build: mirror the app's allow-list fix (ad7ff7d) and the llama-ext include rewrite; regen cpp/.**
  CHANGES: 25 files, +10759/-8, adding the allow-list sources the include gate named
  (`llama-kv-cache-dsa-iswa.*`, `llama-kv-cache-msa.*`, `llama-memory-hybrid-idx.*`,
  `common/json.*`, `tools/mtmd/mtmd-internal.h`, `tools/mtmd/mtmd-helper-common.h`,
  `hash/*`) and rewriting `../src/llama-ext.h` to `../llama-ext.h` across all of
  `common/`. SERVES: makes the CMake allow-list and the tree agree. Plan item: none.

### G2. Follow the kalsallama API: compile-follow fixes and gate coverage (17-18 Sep, flat)

- **`bff76818` fix(rn): follow kalsallama 134a35cf2's memory and mtmd APIs without aborting the process.**
  CHANGES: 9 files, +287/-73. Adds `rn_seq_rm()` in `cpp/rn-llama.h`; moves MTP
  capability into `shouldUseMTP()`/`should_use_mtp()` with `mtp_capability_logged`;
  wraps draft-context creation in try/catch; tracks `mtp_draft_mem_shared`; appends the
  fifth `mtmd_helper_init_opt_default()` argument at `cpp/rn-mtmd.hpp:207` and `:250`;
  converts three `json::parse` calls to `common_json::parse`. Also adds the first
  syntax pass to `scripts/assert-cpp-includes.sh`. SERVES: removes process aborts from
  the MTP path (owner decision) and unblocks the build on `134a35cf2`. Plan item: none
  directly, but this is the MTP lane the governor session depends on.
- **`619acfa9` fix(jsi): follow kalsallama 134a35cf2's params/chat APIs; gate now parses the jsi TUs.**
  CHANGES: `cpp/jsi/JSIParams.cpp`, `cpp/jsi/RNLlamaJSI.cpp`, gate. Translates
  `use_mmap`/`use_mlock` onto `cparams.load_mode`, feeds `common_json::parse` to
  `json_schema_to_grammar`, absorbs `thinking_end_tag` -> `thinking_end_tags` while
  keeping the single-string JS contract, deletes the dead `vocoder` assignment. SERVES:
  a surface-preserving repair; no plan item.
- **`66183760` build(gate): parse the bmoe TUs the rnllama target compiles.**
  CHANGES: gate only (+38/-16); adds the bmoe parse group with the exact defines and
  forced include. SERVES: none in the plan; gate coverage.
- **`00428779` build(sync): generate the pin's version headers into cpp/ -- CI dies without them.**
  CHANGES: generates `cpp/ggml-version.h` and `cpp/llama-version.h` from the pin's `.in`
  templates inside `flatten_and_prefix`; removes the gate's `KNOWN_ABSENT` shim. SERVES:
  the Android/iOS builds cannot compile without those headers. Plan item: none.
- **`bb165e86` build(opencl): derive the kernel list from the shipped .cl files; compile cl-program-cache.cpp.**
  CHANGES: `android/src/main/rnllama/CMakeLists.txt` +17/-169, replacing the 156-name
  hand-written `GGML_OPENCL_KERNELS` list with a glob over
  `cpp/ggml-opencl/kernels/*.cl` (181 files), and adding `cl-program-cache.{cpp,h}`.
  SERVES: the arm64 OpenCL target could not find 25 generated `.cl.h` files. Plan item:
  none, but this is the OpenCL build the governor's GPU prefill needs.
- **`05cc44a3` build(gate): close the coverage holes that let the version headers and kernel drift through.**
  CHANGES: gate only (+48/-25); adds the `*.c` globs, the jinja group, the `.cl.h` vs
  `kernels/*.cl` cross-check. SERVES: none in the plan.
- **`08ba95e8` engine: kalsallama 70b4302 (ggml-opencl: close the two blocks the 2026-09-04 merge broke).**
  CHANGES: pin move to `70b4302bb`, regenerated `cpp/` (6 files). SERVES: engine pin.
  *(Listed here because it unblocked the OpenCL parse; its primary group in the coverage
  table is G6.)*
- **`fc65ca60` build(gate): parse the OpenCL TUs; derive version commits from the pin, not the clone.**
  CHANGES: gate + script. Synthesizes the `kernels/*.cl` embeddings with the tree's own
  `embed_kernel.py` and parses `ggml-opencl.cpp` and `cl-program-cache.cpp`;
  `LLAMA_COMMIT`/`LM_GGML_COMMIT` become `${sha:0:7}` instead of `git rev-parse
  --short=7`. SERVES: makes the reported engine commit a pure function of the pin.
- **`a431ef93` fix(sync): llama_commit() reads the same pin-derived string the headers do.**
  CHANGES: script only (+10/-1). Same fix for `write_build_info`'s `build_commit`;
  refuses a shallow clone with `--is-shallow-repository`. SERVES: the phone reports
  `llama_commit()`; a clone-dependent string misreports the engine.
- **`da845d16` Fix reasoning budget end-tag insertion.**
  CHANGES: `cpp/jsi/JSIParams.cpp` +3/-3: `reasoning_budget_end.emplace_back(std::move(...))`
  instead of inserting individual tokens. SERVES: fixes the line `987799a1` wrote wrong;
  an upstream-owned file, so it is a recurring-tax edit. No plan item.
- **`05612f2b` fix(sync): copy ggml-cpu/iqp.cpp; the ggml-cpu list is an allow-list.**
  CHANGES: +1267/-3 (1253 of it the copied `iqp.cpp`), plus the script list and
  `KALSA_FORK.md`. SERVES: apk run `35301310178` died at link with 6 undefined
  `lm_ggml_cpu_iqp_*` symbols. No plan item.
- **`4126b729` build(android): compile the vendored hash sources mtmd-helper.cpp links against.**
  CHANGES: `android/src/main/rnllama/CMakeLists.txt` +10. Adds `hash/hash.cpp` and
  `hash/sha256/sha256.c` and the include dir. SERVES: apk run `35301310178` undefined
  `hash_sha256_hex`. No plan item.

### G3. Runtime repairs: MTP/speculative and the CPU-params SIGSEGV (17-18 Sep, flat)

- **`a0bfc383` fix(rn): the draft rollback is advisory; a slot whose MTP init fails re-queues its prompt.**
  CHANGES: `cpp/rn-completion.cpp`, `cpp/rn-slot.cpp`, `cpp/rn-slot.h`,
  `cpp/rn-completion.h`, net -35 lines. Replaces the unreachable
  `mtp_draft_mem_shared` guard with an adaptive `draft_rollback_fenced` flag; restores
  `SLOT_STATE_PROCESSING_PROMPT` when `init_mtp`'s catch latches an empty slot. SERVES:
  MTP is the draft lane the governor session's target context uses. No plan item.
- **`57c530cc` fix(rn): a draft that cannot decode from a shared KV cache falls back to plain at init.**
  CHANGES: 6 files, +82/-36. Probes the draft `rn_seq_rm` before the target clear and
  falls back with one `LOG_ERROR`; moves the spec batch allocation after the probe;
  tightens the gate's `.cl.h` skip to real generated names. SERVES: same lane.
- **`628f4517` fix(rn): a fallback to plain also turns the target's nextn output off and drops the stale draft pointers.**
  CHANGES: `cpp/rn-completion.cpp` +9, `cpp/rn-slot.cpp` +21/-6. Calls
  `llama_set_embeddings_nextn(..., false, false)` in both fallbacks; nulls `ctx_tgt`/`ctx_dft`.
  SERVES: same lane.
- **`ffbd39e8` fix(android): resolve the cpu params the CLI layer used to; pin 70b4302's new common_threadpools::init built a pool with -1 threads.**
  CHANGES: `cpp/rn-llama.cpp` +13: `postprocess_cpu_params(params.cpuparams, nullptr)`
  and `postprocess_cpu_params(params.cpuparams_batch, &params.cpuparams)` before the
  first `common_init_from_params`. SERVES: fixes e2e run `35307242869`'s SIGSEGV at
  `memset_generic` from `common_threadpools::init`. Plan item: **yes, indirectly** - this
  is a live crash on the first model load, and G2 asks for a complete chat on the CPU path.
- **`652414cb` fix(tts): resolve the vocoder cpu params too; not reachable from the kalsa app, armed for any other consumer.**
  CHANGES: `cpp/rn-tts.cpp` +12, the same two calls in the vocoder constructor. SERVES:
  the message itself says the kalsa app does not call this path ("grep ... returns
  nothing"). No plan item; deliberately armed for other consumers.
- **`fada1ebe` fix(android): normalize an explicit zero thread count too, with a default that cannot be zero.**
  CHANGES: `cpp/rn-llama.cpp` +27/-7. Normalizes `== 0` as well as `< 0`, using
  `common_cpu_get_num_math()` instead of `std::thread::hardware_concurrency()`; placed in
  `loadModel` as the single choke point. SERVES: closes the same SIGSEGV class for a
  device that reports 0 cores. No plan item.

### G4. The include/syntax gate ladder on `scripts/assert-cpp-includes.sh` (17-18 Sep, flat)

All five of these edit a file that `54c99f14` deletes. Their work is gone at the tip.

- **`49546c8d` build: the gate covers every compiled TU and refuses to run half; bump needs the clone.**
  CHANGES: 12 files, +138/-678; deletes `scripts/bootstrap.sh` (558 lines),
  `scripts/finalize-sync.sh`, the `package.json` "bootstrap" entry, and the
  `npm run bootstrap` line in `.github/actions/setup/action.yml`; adds the
  `KALSA_ALLOW_PARTIAL_GATE` escape and the `--rn-borrowed` gate mode later refined by
  `485519fe`. SERVES: none in the plan. See answer 5 for the pair this opens.
- **`5d679fef` build: gate parses ggml-opencl too; hexagon headers resolve; setup action stops re-installing.**
  CHANGES: gate, `KALSA_FORK.md`, setup action, `sync-kalsallama.sh`. Documents that
  `ggml-opencl.cpp` is not host-clang-parseable and names the exact failure lines.
  SERVES: gate coverage. No plan item.
- **`f770f542` build(gate): the syntax pass parses with the NDK clang; host is a labelled fallback.**
  CHANGES: gate +56/-12. Switches to `aarch64-linux-android<API>33-clang++`, API
  default 33. SERVES: `JSIParams.cpp` passed on host and failed the arm64 NDK build.
- **`b64d1116` build(gate): follow this repo's own NDK pin, refuse a silent fallback, and floor the counters.**
  CHANGES: gate +110/-27. Reads `RNLlama_ndkversion`, adds `KALSA_GATE_REQUIRE_NDK=1`,
  and adds per-group floors. SERVES: an audit of `f770f542`.
- **`91bdb5d0` fix(gate): an explicit compiler bypassed the require switch, and the floors were too generous.**
  CHANGES: gate +48/-14. Fixes an audit of `b64d1116`; makes an explicit
  `KALSA_GATE_SYNTAX_CXX` refuse under REQUIRE and adds one floor per group. SERVES: none;
  deleted at `54c99f14`.

### G5. The v0.12.9 upstream merge and the CI/type/test tooling around it (18 Sep, flat)

- **`3eb8ac2f` merge: llama.rn v0.12.9 - 45 conflicts, 5 hunks that needed a human.** (MERGE, ours)
  CHANGES: merges upstream `2a20c13e` into `fada1ebe`. SERVES: keeps the fork on the
  upstream release before the vendor restructure. Plan item: the migration's step 6
  ("re-apply the binding") is paid here, in the flat layout.
- **`24fb7098` build: typecheck and jest were measuring a clone of another repository.**
  CHANGES: `package.json`, `tsconfig.json` (exclude `tmp`). SERVES: `tsc --noEmit` went
  from 1783 errors to 0. No plan item.
- **`45fee016` test: the jest mock never declared the governor bindings, so the suite was red.**
  CHANGES: `jest/mock.js` +22. Adds `llamaSetGovernorThermo` and `llamaGetGovernorStats`.
  SERVES: fixes a defect `987799a1` introduced; the suite was red since the governor
  landed. No plan item.
- **`a694adfc` ci: run the fork's own checks on `kalsa`, not only on `main`.**
  CHANGES: `.github/workflows/ci.yml` +5. SERVES: the fork's checks never ran on the
  branch where its commits go. No plan item.
- **`2e313c77` fix(types): move GovernorThermoProfile above its first use.**
  CHANGES: `src/types.ts` +10/-10. SERVES: fixes a lint error `987799a1` introduced. No
  plan item.
- **`653e2ddb` build: eslint was reading the clone cache too.**
  CHANGES: `package.json` +2/-1 (`eslintIgnore` gains `tmp/`). SERVES: 693 local lint
  problems vs 1 in CI. No plan item.
- **`9cb24abb` fix(ci): the PR guard let the heavy jobs through, and two configs still read the clone.**
  CHANGES: `ci.yml`, `tsconfig.build.json` (+`tmp`), `tsconfig.json` (reverts the
  `example` exclusion `24fb7098` added). SERVES: three confirmed audit findings. No plan
  item. See answer 5, pair P4.
- **`0a87a8ef` Merge branch 'gate-ndk' into kalsa.** (MERGE, ours)
  CHANGES: merges `b64d1116` into `9cb24abb`. SERVES: joins the two tooling lines.
- **`c8abc1f5` Merge remote-tracking branch 'origin/kalsa' into v0129-on-gate.** (MERGE, ours)
  CHANGES: merges `91bdb5d0` into `3eb8ac2f`. SERVES: joins the v0.12.9 line with the
  gate line.
- **`91b258f6` test(slot): assert our should_use_mtp contract, not upstream's.**
  CHANGES: `tests/parallel_decoding_test.cpp` +9/-1. SERVES: un-gating the C++ test job
  exposed a red test. **Verified**: at `91b258f6^` that file is byte-identical to
  `upstream/main` (`git rev-parse` both = `90c43b72`), exactly as the message claims.
  No plan item.
- **`04a3685a` ci: restore npm run bootstrap so android-libs can find the Hexagon SDK.**
  CHANGES: `.github/actions/setup/action.yml` +9/-2. SERVES: `build-android-libs` died on
  "Hexagon SDK not found". See answer 5, pair P1.
- **`4a6859ff` docs(ci): correct what npm run bootstrap actually writes.**
  CHANGES: `.github/actions/setup/action.yml` comment only (+13/-7). SERVES: nothing
  observable. See answer 6.

### G6. Flattened-era engine pin bumps and the sync grading (18-19 Sep, flat)

- **`e8505ca2` build(engine): kalsallama 237461a9 - MTP draft context, missing <stdexcept>, threadpool guard.**
  CHANGES: `kalsallama.pin`, `cpp/KALSALLAMA_SHA`, the version headers, and 4 engine files
  (`cpp/common/common.cpp`, `cpp/llama-context.cpp`, `cpp/llama-kv-cache-iswa.cpp`,
  `cpp/llama-model.cpp/.h`), plus `ci.yml`. SERVES: engine pin. The MTP draft-context fix
  is the one the app feels.
- **`485519fe` fix(sync): the bump graded the engine alone, so a broken binding reached the install.**
  CHANGES: `scripts/assert-cpp-includes.sh`, `scripts/sync-kalsallama.sh` +73/-1. Adds
  `borrow_rn_owned_for_gate` so the gate grades the post-install pair. SERVES: none; both
  scripts die at `54c99f14`.

### G7. The vendor migration (19 Sep) - see answer 1 for the ordered account

- **`95c3493b` build(engine): kalsallama 2361be359 - the q4_K MoE OpenCL kernels build again.**
  CHANGES: pin move, regenerated `cpp/`, and the two `.cl` files. SERVES: the load-time
  abort. This is the **last pre-migration commit**; `rollback/v0129-on-gate` points here.
- **`d6d95ecc` build(vendor): union patches for common.{h,cpp} and the kalsa vendor guards.**
  CHANGES: `scripts/patches/llama.cpp/common.{cpp,h}.patch` (the UNION of ours and
  upstream's), `scripts/assert-kalsa-vendor.sh` +73. SERVES: migration step 1.
- **`74836284` build(vendor): adopt upstream's vendor/ layout and re-apply the kalsa binding.** (MERGE, ours)
  CHANGES: parents `d6d95ecc` + `2af674ad`; 1727 files, +343759/-93579. SERVES: **the
  migration and the point of no return.** See answer 1.
- **`afc82485` fix(binding): restore decode timings, token ids, governor sources.**
  CHANGES: 6 files, +38/-21. `JSICompletion.h` reads perf on `active_ctx()` after
  `llama_synchronize()` and re-emits `generated_token_ids`; `RNLLAMA_RN_SOURCES` takes
  `rn-governor.cpp` and `rn-governor-params.cpp`; the gate passes `-DGGML_USE_*` not
  `-DLM_GGML_USE_*`; `RNLlamaJSI.cpp` uses a `unique_ptr` for the new context. SERVES:
  consumer repair; the governor TUs are build-wired here.
- **`758a6966` fix(vendor): verify the cached clone URL and pin the build commit to 7.**
  CHANGES: `scripts/sync-vendor.sh`, and a `lib/` regeneration (35 files). Adds
  `repack-q23k.h` to `LLAMA_CPP_PATHS`, compares the cached clone's origin URL,
  truncates the commit string, and refuses a shallow clone. SERVES: makes the
  `LLAMA_CPP_REPO` re-point (`2f1996d4`) actually take effect.
- **`12f49b30` fix(vendor): refuse a shallow cache before the sync writes anything.**
  CHANGES: `scripts/sync-vendor.sh` +22/-12. Moves the shallow refusal from
  `generate_llama_cpp_version_files` into `ensure_repo`, gated by a `required` argument.
  SERVES: a depth-1 cache aborted with a half-updated tree. No plan item.
- **`f5fd027b` fix(binding): use upstream ggml_time_us and drop dead cpp/ggml-version.h.**
  CHANGES: `cpp/ggml-version.h` deleted, `cpp/rn-governor.cpp` (one line),
  `cpp/rn-llama.cpp` (a comment). SERVES: compile break from the dropped `lm_` prefix;
  the only vendor-era commit that touches the governor bridge, and it does not touch the
  parser.
- **`ab7c2e65` fix(scripts): close three holes in assert-kalsa-vendor before it gates the deletion.**
  CHANGES: `scripts/assert-kalsa-vendor.sh` +27/-9. Requires `build-info.cpp` to exist,
  pins `progress_callback_user_data`, and asserts the seven fork-only
  `src/llama-governor*` files. SERVES: makes the gate able to authorise `54c99f14`.
- **`54c99f14` refactor(vendor): delete the legacy flattened engine now that vendor/ supplies it.**
  CHANGES: 55 files, +32/-24531. Deletes 31 `cpp/` files (12 of them byte-identical
  `vendor/llama.cpp/vendor/hash/` duplicates - verified per file with `git rev-parse`),
  `third_party/OpenCL-Headers/CL/*`, `cpp/KALSALLAMA_SHA`, `cpp/llama-version.h`,
  `scripts/sync-kalsallama.sh`, `scripts/assert-cpp-includes.sh`. SERVES: completes the
  migration's "delete" step.
- **`4fab9622` chore: drop kalsallama.pin, document vendor/VERSIONS as source of truth.**
  CHANGES: deletes `kalsallama.pin`, edits `AGENTS.md`. SERVES: the pin's new home.
  **Verified**: `git grep kalsallama.pin 4fab9622^` finds no reader in that tree, exactly
  as the message claims.

### G8. Vendor era: put the engine content in (19 Sep, vend)

- **`2f1996d4` feat(vendor): re-point the engine pin at the kalsallama fork.**
  CHANGES: 77 files, +10069/-551. `LLAMA_CPP_REPO` -> `https://github.com/Aspis0/kalsallama`,
  `LLAMA_CPP_REF`/`COMMIT` -> `f6ba2786d2811932904584ce79291e9ea34f8a45`; brings
  `vendor/llama.cpp/src/llama-ext.h` (+326), `llama.h` (+3, `mmap_prefetch`),
  `llama-governor-*.{cpp,h}` (6 files), `llama-hybrid-commit.*`, `llama-kv-commit.*`,
  `llama-kv-staged.*`, `llama-memory-hybrid-idx.*`, the OpenCL kernels, the bmoe CPU
  repack (`repack-q23k.h`, `arch/arm/repack.cpp`, `ggml-cpu.c`), and
  `ggml-opencl-kalsa-diag.*`. Fixes the `LLAMA_COMMIT` check in
  `assert-kalsa-vendor.sh` (it had been grepping `LLAMA_BUILD_COMMIT`, a placeholder,
  so "the check has never matched anything"). SERVES: **the engine release pin** and the
  migration's reason for existing.

### G9. Vendor era: vendor the remaining kalsa sources (19 Sep, vend)

- **`dc205f56` feat: vendor bmoe_stream into llama.rn and un-gate kalsa CI.**
  CHANGES: 36 files, +7311/-87. Adds `cpp/bmoe_stream.{h,cpp}`, brings
  `vendor/llama.cpp/src/bmoe/**` (18 files, ~7300 lines), globs
  `${_llama}/bmoe/*.cpp`, removes the whole reach-into-the-app `BMOE_ROOT` block from
  `android/src/main/rnllama/CMakeLists.txt` (-40), and removes the five kalsa branch
  guards from `ci.yml`. Pin -> `e1866612d4851c3af67af7c5eca6a50f7c34937a`. SERVES: the
  migration rule "new capability goes in a new file"; the app repo stops being a build
  dependency.
- **`bde3f975` fix(cmake): compile the whole OpenCL backend directory, not two named files.**
  CHANGES: 3 files, +8/-6. Globs `${_ggml}/ggml-opencl/*.cpp` in
  `cmake/rnllama-sources.cmake` and uses it at the three call sites (the Android library,
  `kv_cache_reuse_test`, `kv_cache_bench`; verified by reading the diff). SERVES: the
  Android link failed on fifteen `ggml_opencl_*` symbols from
  `ggml-opencl-kalsa-diag.cpp`, which the merge's inherited hand-written list omitted.
  Plan item: none, but it is the OpenCL backend the governor's GPU lane needs.

### G10. Vendor era: the assertion gates, wired (19 Sep, vend)

- **`4e3b2385` fix(vendor): run the vendor gate in sync and CI, anchor the commit check.**
  CHANGES: `ci.yml` +15, `assert-kalsa-vendor.sh`, `sync-vendor.sh` +4. Wires the gate
  into the sync and adds an always-on CI vendor job with no `if:`. SERVES: the gate was
  called by nothing ("A gate that only runs when someone remembers is not a gate").
- **`6eea3f53` feat(vendor): catch manifest drift, assert named build sources exist.**
  CHANGES: adds `scripts/assert-rnllama-sources.sh` (+100), wires it into the sync and
  the CI job. SERVES: restores the manifest-coverage property lost when `54c99f14`
  deleted `assert-cpp-includes.sh`.
- **`88e7eed5` fix(scripts): close three bypass holes in assert-kalsa-vendor.**
  CHANGES: +42/-6. Anchors `progress_callback_user_data`, requires a real non-empty
  non-symlink governor source naming `llama_governor`, and verifies the committed `lib/`
  against `src/version.ts`. SERVES: none in the plan; gate integrity.
- **`18f3ff33` fix(scripts): do not pin the progress_callback initializer.**
  CHANGES: +8/-5. Loosens `88e7eed5`'s `= *nullptr;$` anchor to `[=;]`. SERVES: an
  upstream initializer change would have been a false alarm on a bump. See answer 5, P3.
- **`11cc0f9f` fix(scripts): make the vendor gate read code, not text.**
  CHANGES: +24/-4. Adds `code_only()` (strips `/* */` and `//`) to the three content
  checks. SERVES: three audit bypasses where a commented-out copy satisfied a check.
  The commit body explicitly corrects its own earlier blame attribution: "I had blamed
  the wrong commit: the earlier `= *nullptr;$` form matched a commented declaration
  exactly as the looser `[=;]` form does. The loosening did not create the bypass." I
  verified this reasoning holds for a single-line block comment, where a line-oriented
  grep sees the declaration's text starting at column 0.

### G11. Vendor era: the pin moves that ship (19-20 Sep, vend)

- **`0a9b9379` build(engine): pin 8537d09 so bmoe builds at minSdk 23 and under -Werror.**
  CHANGES: 11 files. `LLAMA_CPP_REF`/`COMMIT` -> `8537d097c32e7307d82540b6da8eb448d7e07107`;
  re-exported `bmoe/platform_io.cpp`, `bmoe/router_hook.{cpp,h}`; the three generated
  version files; `lib/`. SERVES: `AHardwareBuffer_*` unavailable below API 26 while
  llama.rn builds at 23, and an unused parameter `-Werror` rejects. This is the pin the
  app ships (`PLAN.md`, "The app and its engine pin").
- **`0288dc27` build(engine): pin llama.cpp to 4ccef2f85 (checkpoint persistence + cache_salt).**
  CHANGES: 8 files, +14/-14, and nothing else: `vendor/VERSIONS`, `src/version.ts`, the
  three `lib/*/version.js|d.ts`, and the three generated engine version files. SERVES:
  **the shipped pin today** (branch tip) and the engine release identity
  (`kalsa-server-v1.0.0` peels to `4ccef2f85`). Substantive claim verified against the
  engine repo: `git diff --name-only 8537d097c..4ccef2f85` in `~/Projects/kalsallama`
  returns exactly 6 paths, one of them
  `.github/workflows/kalsa-server.yml` and five under `tools/server/`. See answer 6 for
  the one wording caveat.

### G12. Vendor era: the iOS framework includes (19 Sep, vend)

- **`739d7a54` fix(ios): include the governor header the way the framework build needs.**
  CHANGES: moves `#include "rn-governor-params.h"` from `cpp/jsi/RNLlamaJSI.cpp` into both
  branches of `cpp/jsi/JSINativeHeaders.h`; adds the jsi-include rule to
  `assert-rnllama-sources.sh`. SERVES: `build-ios-frameworks` compiles only `cpp/jsi/**`
  against the xcframework, where an engine header is `<rnllama/name.h>`.
- **`a974a52b` fix(ios): guard the second framework-unsafe include, and widen the gate.**
  CHANGES: also guards `llama-ext.h` (which was still bare on the line after the one just
  fixed), and rewrites the gate to assert "a quoted include that does not resolve inside
  `cpp/jsi` must have a `<rnllama/name.h>` counterpart in the same file"; strips comments
  before matching. SERVES: an audit of `739d7a54`. See answer 6 for the false claim it
  corrects.
- **`0f313bab` fix(gate): resolve jsi includes against the including file, and state the limit.**
  CHANGES: `scripts/assert-rnllama-sources.sh` +16/-2. Resolves through the include's own
  directory (`cd ... && pwd -P`) and requires the result under `cpp/jsi`. SERVES: an
  audit of `a974a52b` found two path-resolution defects. This is the local branch tip.
  The commit also writes down that the invariant cannot see preprocessor structure
  ("a file that puts the two spellings in the wrong branches, or hides one in `#if 0`,
  passes") - a declared limit, not a fix.

---

## THE NUMBERED ANSWERS

### 1. The migration itself: which commits, in what order, and the point of no return

Order is the first-parent chain, with the upstream side branch named where it matters.
`95c3493b` is the last pre-migration commit and is the head of
`rollback/v0129-on-gate` ("Rollback target for the vendor migration"), which is the
fork's own statement of where the escape door is.

| # | commit | what that step did |
|---|---|---|
| 0 | `95c3493b` (09:00) | pin `2361be359` in `kalsallama.pin`, flattened `cpp/`. Last pre-migration commit. |
| 1 | `d6d95ecc` (13:06) | **Prepare the patches.** Regenerates `scripts/patches/llama.cpp/common.{cpp,h}.patch` as the UNION of ours and upstream's (moving ours into upstream's directory would have overwritten four upstream features: `vocab_only`, its mparams wiring, `progress_callback(_user_data)`, `reasoning_budget_activate_immediately`). Ports the guards upstream has no equivalent for into `scripts/assert-kalsa-vendor.sh`. |
| 2 | `74836284` (13:31) | **Adopt the layout.** Merge of `d6d95ecc` + `2af674ad` (`upstream/main`). 1727 files, +343759/-93579. `vendor/llama.cpp/` and `vendor/VERSIONS` appear; `cpp/ggml.c` disappears. **This is the point of no return.** |
| 3 | `afc82485` | **Repair the consumers.** Perf on `active_ctx()` plus `llama_synchronize()`, `generated_token_ids` re-emitted, `RNLLAMA_RN_SOURCES` gains the two governor TUs, `-DGGML_USE_*` replaces `-DLM_GGML_USE_*`, and the new context is owned by a `unique_ptr`. |
| 4 | `758a6966` | **Make the re-point possible.** Cache keyed on URL, commit string truncated instead of `--short=7`, shallow clone refused, `repack-q23k.h` added to the manifest, `lib/` regenerated. |
| 5 | `12f49b30` | **Make the refusal a guard.** Moves the shallow check from after the export to before any write. |
| 6 | `f5fd027b` | **Drop the prefix leftovers.** `cpp/rn-governor.cpp:77` `lm_ggml_time_us()` -> `ggml_time_us()`; deletes the consumerless `cpp/ggml-version.h`. |
| 7 | `2f1996d4` | **Re-point the pin.** `LLAMA_CPP_REPO` -> `Aspis0/kalsallama`, `LLAMA_CPP_REF`/`COMMIT` -> `f6ba2786d...`; vendor tree carries the governor and KV work. Also fixes the never-matched `LLAMA_COMMIT` gate check. |
| 8 | `ab7c2e65` | **Make the gate able to authorise the deletion.** Closes three fail-open holes, including the one that could not tell the kalsallama pin from a plain ggml-org tree with the same patches. |
| 9 | `54c99f14` | **Delete the flattened tree.** 24,531 lines: 31 `cpp/` files (12 verified byte-identical to `vendor/llama.cpp/vendor/hash/`), `third_party/OpenCL-Headers/CL/*`, `cpp/KALSALLAMA_SHA`, `cpp/llama-version.h`, `scripts/sync-kalsallama.sh`, `scripts/assert-cpp-includes.sh`. |
| 10 | `4fab9622` | **Retire the pin file.** Deletes `kalsallama.pin` (which claimed `2361be3`, verified as exactly 208 commits behind `f6ba278` via `git rev-list --count` in `~/Projects/kalsallama`); `AGENTS.md` names `vendor/VERSIONS`. |

**Point of no return: `74836284`.** Evidence, not inference: it is the first commit in
the branch whose tree contains `vendor/llama.cpp/ggml/src/ggml.c` and does **not**
contain `cpp/ggml.c` (`git cat-file -e` on both paths at `74836284`, and on the first
parent `d6d95ecc` where the reverse holds). It is a merge, so undoing it needs
`git revert -m 1`, and every later commit reads the vendored tree. Before it, the escape
is `rollback/v0129-on-gate` = `95c3493b`; after it, there is nothing to roll back to.

Note for a reader following an old note: steps 1 to 10 mention `scripts/sync-kalsallama.sh`,
`cpp/KALSALLAMA_SHA`, `kalsallama.pin`, `scripts/kalsa-patches/`,
`third_party/OpenCL-Headers` and `scripts/assert-cpp-includes.sh`. Measured at the tip
with `git cat-file -e` on each path: `cpp/KALSALLAMA_SHA`, `kalsallama.pin`,
`scripts/sync-kalsallama.sh`, `scripts/assert-cpp-includes.sh` and the whole
`third_party/` tree are **absent**, while `scripts/kalsa-patches/common.{cpp,h}.patch`
**still exist** (2 files, orphaned: nothing reads them after `d6d95ecc` regenerated the
union into `scripts/patches/llama.cpp/`, and `git log --diff-filter=D -- 'scripts/kalsa-patches/*'`
returns no deletion). `native/kalsallama.pin` is also absent, confirming that the pin's
old home is gone on both paths. The live equivalents are `scripts/sync-vendor.sh`,
`vendor/VERSIONS`, `scripts/patches/llama.cpp/`, `vendor/OpenCL-Headers/` and
`scripts/assert-kalsa-vendor.sh` + `scripts/assert-rnllama-sources.sh`.

### 2. The governor surface in the binding, and defect 5.2 today

Every commit in the window that touches the params parser or the native governor bridge:

| commit | what it does | does it move defect 5.2? |
|---|---|---|
| `987799a1` | **Creates** `cpp/rn-governor-params.cpp/.h` and `cpp/rn-governor.cpp/.h`, plus the flattened `cpp/llama-governor-*` engine files. | **No - it introduces 5.2.** The default `false` is written here: `git show 987799a1:cpp/rn-governor-params.cpp` line 86 = `result.t_idle_valid = bool_or(thermo, "t_idle_valid", false);` and lines 103-104 keep the `plugged` requirement. |
| `74836284` (merge) | Does **not** touch `cpp/rn-governor*` at all. Verified: `git diff --name-status 74836284^1 74836284 -- 'cpp/rn-governor*'` is empty. | No. The governor files pass through the merge untouched. |
| `afc82485` | Build-wires them: adds `rn-governor.cpp` and `rn-governor-params.cpp` to `RNLLAMA_RN_SOURCES` in `cmake/rnllama-sources.cmake:137-138`. | No. |
| `f5fd027b` | One line in `cpp/rn-governor.cpp` (`ggml_time_us()`), one comment in `cpp/rn-llama.cpp`. | No. |
| `2f1996d4` | Vendors `vendor/llama.cpp/src/llama-ext.h` (the governor C API) and the engine `llama-governor-*` files, **including the duplicate validation**. | No - it replicates 5.2 into the vendored tree. |
| `54c99f14` | Deletes the flattened `cpp/llama-governor-*` copies. `cpp/rn-governor*` stays. | No. |
| `dc205f56` | Touches bmoe includes only, not the governor. | No. |

**Current parser lines.** `cpp/rn-governor-params.cpp` at the tip:

```
 84  result.plugged = bool_or(thermo, "plugged", false);
 85  result.sensor_valid = bool_or(thermo, "sensor_valid", false);
 86  result.t_idle_valid = bool_or(thermo, "t_idle_valid", false);
 87  result.t_idle_c = value_or(thermo, "t_idle_c", 0.0f);
 ...
 92  bool governor_thermo_profile_is_valid(
 93      const llama_governor_thermo_profile & thermo) {
 ...
100      if (!thermo.plugged) {
101          return true;
102      }
103      return thermo.t_idle_valid && std::isfinite(thermo.t_idle_c) &&
104             thermo.t_idle_c + 1.0f < 42.0f;
105  }
```

The same rule exists a second time engine-side, because the binding's copy is only used
for logging and a pre-check: `vendor/llama.cpp/src/llama-governor-policy.cpp:53-64`
(`llama_governor_policy::profile_is_valid`), reached from
`llama_governor_policy::update_thermal` at `:88-96`, which sets
`state_ = Invalid` and `profile_valid_ = false`.

**Is the defect still live at the tip? Yes.** The chain, with every hop at a `file:line`:

1. `cpp/rn-governor-params.cpp:86` defaults `t_idle_valid` to `false`.
2. `cpp/rn-llama.cpp:81` computes `profile_valid` (logging) and `:122` calls
   `owner.governor->set_thermo_profile(governor_thermo)`.
3. `cpp/rn-governor.cpp:72-79` forwards to `llama_governor_set_thermo_profile`.
4. `vendor/llama.cpp/src/llama-governor-policy.cpp:88-96` rejects the profile and returns
   false (`state_ = Invalid`).
5. `cpp/rn-llama.cpp:122-124`: `if (!owner.governor->set_thermo_profile(...)) { throw
   std::runtime_error("governor: thermo profile invalid"); }` - caught at `:126`, which
   logs `KALSA_GOVERNOR_FALLBACK {stage:"init", ...}` at `:130-131` and returns false at
   `:134-135`.

So with the cable plugged and no `t_idle_c`/`t_idle_valid` sent, the governor model
**fails to load at all**. That is earlier than the plan's stated route, which is still
also real: if the profile was valid at load and a later update carries `plugged = true`
with `t_idle_valid = false`, then `admit_prefill` at
`vendor/llama.cpp/src/llama-governor-policy.cpp:188-193` returns `Abort`,
`vendor/llama.cpp/src/llama-governor-runtime.cpp:50-51` calls
`fail("prefill admission aborted")`, and `vendor/llama.cpp/src/llama-governor.cpp:151-156`
sets the sticky `failed = true`, after which `:163-165` returns
`fail("governor is failed")` for every later decode. The binding latches its own copy
too: `cpp/rn-governor.cpp:44-49` sets `failed_ = true` for any result other than 0 or
-2, and `:72-75` then makes `set_thermo_profile` return false forever.

Line-number note for a reader working from the device plan: every engine line the plan
cites maps 1:1 onto the vendored file, because the migration moved those files without
editing them. `llama-governor-runtime.cpp:55-63` (5.1), `:65-68` (5.3),
`llama-governor.cpp:152` and `:164` (5.2's sticky failure) are the same lines under
`vendor/llama.cpp/src/`. The one drift is `profile_is_valid`: the plan cites
`llama-governor-policy.cpp:59-63`, the actual function spans `:53-64` at this pin.

### 3. What the phone can call, and the `tools/server` boundary

**`tools/server` is not compiled by the phone. Confirmed from the build files:**

- `vendored` tree at the tip contains **0** files under `vendor/llama.cpp/tools/server`
  and **65** under `vendor/llama.cpp/tools/mtmd` (`git ls-tree -r | grep -c`).
- The export manifest `LLAMA_CPP_PATHS` in `scripts/sync-vendor.sh:34-157` names
  `tools/mtmd/...` explicitly (lines 124-142) and names nothing under `tools/server`.
- `git grep -n 'tools/server' origin/vendor-migration -- '*.cmake' 'CMakeLists.txt'
  '*.podspec' '*.json' '*.sh'` returns empty.
- `cmake/rnllama-sources.cmake:53-153` is the single source-of-truth list; it globs
  `${_llama}/*.cpp`, `${_llama}/models/*.cpp`, `${_llama}/bmoe/*.cpp`, `${_common}/*.cpp`
  and `${_mtmd}/*.cpp` and never reaches a `tools/` directory other than `mtmd`.

**Which commit, if any, blurred it: none.** I checked every commit in the window whose
diff touches a CMake file or a shell script for the string `tools/server`; there are no
hits. The only commit that *exercises* the boundary is `0288dc27`, which moves the pin to
a commit whose engine-side delta is entirely `.github/workflows/kalsa-server.yml` plus
five files under `tools/server/` (verified in `~/Projects/kalsallama` with
`git diff --name-only 8537d097c..4ccef2f85`: 6 paths). The boundary held because the
manifest omits that directory.

**Commits that changed what the phone can call:**

| commit | surface change |
|---|---|
| `987799a1` | **The big one.** Adds `llamaSetGovernorThermo` and `llamaGetGovernorStats` to `jsiBindingKeys` (`src/index.ts`), the two `LlamaContext` methods (`src/index.ts:722-730`), the four global declarations in `src/jsi.ts` (`llamaSetGovernorThermo`, `llamaGetGovernorStats`), the exported types `GovernorThermoProfile`/`GovernorStats` (`src/types.ts:45-53`), `NativeContextParams.governor` and `.moe_stream`, and `TokenData.tok`/`.forced`/`.raw_probs`. It also adds the matching `lib/typescript/*` declarations. |
| `74836284` (merge) | Imports upstream `#392`: the `lm_`/`LM_` symbol prefix is dropped and ggml symbols are no longer exported from the framework (`ios/unexported-symbols.txt` moves). The native ABI the phone links against changes, and `cpp/jsi/JSIJson.h` is a new file. |
| `afc82485` | `cpp/jsi/JSICompletion.h` re-emits `generated_token_ids` (first 32) in the completion JSON result and reads perf after `llama_synchronize()` on `active_ctx()`. Both are phone-visible (result object, timing numbers). |
| `619acfa9` | A surface-preserving translation: the JS keeps a single `thinking_end_tag` string while the engine moves to `thinking_end_tags`; `use_mmap`/`use_mlock` map onto `load_mode`. The phone-visible names do not change. |
| `2f1996d4` | Exported C headers: `vendor/llama.cpp/include/llama.h` gains `int32_t mmap_prefetch;` appended to `llama_context_params` ("Appended at end so existing field offsets stay stable for ABI consumers"), and `vendor/llama.cpp/src/llama-ext.h` gains the `LLAMA_API` surface: `llama_memory_set_pressure_callback`, `llama_kv_route_query`, `llama_kv_route_query_cost`, `llama_kv_commit`, `llama_kv_commit_ex`, and the whole `llama_governor_*` set. The binding compiles against these; the phone reaches them only through the two JSI methods of `987799a1`. |
| `dc205f56` | `cpp/bmoe_stream.{h,cpp}` become repo-owned and `cmake/rnllama-sources.cmake` globs `${_llama}/bmoe/*.cpp`. Internal: no JS-visible name. |
| `bff76818` | The only MTMD-side surface change: `cpp/rn-mtmd.hpp:207` and `:250` gain the fifth `mtmd_helper_init_opt_default()` argument. The MTMD *export set* is upstream-owned and no kalsa commit changed the vendored `tools/mtmd` content. |
| `758a6966`, `2f1996d4`, `dc205f56`, `0a9b9379`, `0288dc27` | Version constants. `src/version.ts` (`BUILD_NUMBER`/`BUILD_COMMIT`), the three committed `lib/` mirrors of it, and the three files generated by `scripts/sync-vendor.sh:377-380`: `vendor/llama.cpp/common/build-info.cpp` (`LLAMA_COMMIT`), `vendor/llama.cpp/ggml/src/ggml-version.h` (`GGML_COMMIT`), `vendor/llama.cpp/src/llama-version.h` (`LLAMA_COMMIT`). These are what `llama_commit()` reports from the phone. |

### 4. Everything that touched a pin, and the `LLAMA_CPP_COMMIT` history

Files that act as pins, and who wrote them:

| file | commits in the window |
|---|---|
| `vendor/VERSIONS` | `3ce48142` (upstream #393, creates it), `4fd06f30` (upstream #394), `e694afca` (upstream #395), **`2f1996d4`**, **`dc205f56`**, **`0a9b9379`**, **`0288dc27`** |
| `kalsallama.pin` | `81a32498` (creates), `08ba95e8`, `e8505ca2`, `95c3493b`, `4fab9622` (deletes) |
| `cpp/KALSALLAMA_SHA` | `81a32498` (creates), `08ba95e8`, `e8505ca2`, `95c3493b`, `54c99f14` (deletes) |
| `src/version.ts` | `2f1996d4`, `dc205f56`, `0a9b9379`, `0288dc27` |
| generated engine version files | every vendor-era sync of ours: `758a6966`, `2f1996d4`, `dc205f56`, `0a9b9379`, `0288dc27` |

`LLAMA_CPP_COMMIT` history in `vendor/VERSIONS` (value at each commit's tree):

| commit | `LLAMA_CPP_REPO` | `LLAMA_CPP_REF` = `LLAMA_CPP_COMMIT` | engine date / subject |
|---|---|---|---|
| `3ce48142` (upstream) | `ggml-org/llama.cpp` | `5fdfa6282936576d2f352d4b97f397a109f207a6` (ref `b10829`) | b10829 |
| `4fd06f30` (upstream) | `ggml-org/llama.cpp` | `093a2f86c3e37c54fa3e1f9efb17b304f3433abd` (ref `b10951`) | b10951 |
| `e694afca` (upstream bot) | `ggml-org/llama.cpp` | `4bc272fd729bd094c0422e4b8353da8d2fec91f8` (ref `b11010`) | b11010 |
| `2f1996d4` (ours) | **`Aspis0/kalsallama`** | `f6ba2786d2811932904584ce79291e9ea34f8a45` | 2026-09-19, "fix(opencl): set OpenCL target version in relocated KALSA diag TU" |
| `dc205f56` (ours) | `Aspis0/kalsallama` | `e1866612d4851c3af67af7c5eca6a50f7c34937a` | 2026-09-19, "move bmoe engine core into src/bmoe/" |
| `0a9b9379` (ours) | `Aspis0/kalsallama` | `8537d097c32e7307d82540b6da8eb448d7e07107` | 2026-09-19, "bmoe: build under minSdk 23 and under -Werror" |
| `0288dc27` (ours) | `Aspis0/kalsallama` | `4ccef2f85dbc27e095e11ffcbad4628be9961790` | 2026-09-20, "ci: name tag builds after the tag and publish an immutable release" |

**The shipped pin today is `4ccef2f85dbc27e095e11ffcbad4628be9961790`**, set by `0288dc27`
at the branch tip. `PLAN.md`'s `8537d097c` is the pin at `0f313bab`, which is what the app
currently consumes; the branch has since moved one commit. The flattened-era chain for
completeness (all in `kalsallama.pin`/`cpp/KALSALLAMA_SHA`, all in `~/Projects/kalsallama`):
`134a35cf2` (`81a32498`) -> `70b4302bb` (`08ba95e8`) -> `237461a98` (`e8505ca2`) ->
`2361be359` (`95c3493b`).

### 5. Commits that changed nothing observable, and the undo pairs

**Nothing observable outside the build/dev tooling:**

- Documentation only: `4a6859ff` (a CI step comment, +13/-7 all comment).
- Record only: `4fab9622` (deletes a file verified to have no reader, plus `AGENTS.md`).
- CI/dev-tooling only: `a694adfc`, `653e2ddb`, `24fb7098`, `2e313c77`, `9cb24abb`,
  `04a3685a`.
- Test only: `91b258f6`.
- Gate/sync scripts only: `4e3b2385`, `6eea3f53`, `88e7eed5`, `18f3ff33`, `11cc0f9f`,
  `ab7c2e65`, `12f49b30`, `d6d95ecc`, `a431ef93`, and the whole G4 group
  (`49546c8d`, `5d679fef`, `f770f542`, `b64d1116`, `91bdb5d0`), plus `485519fe`,
  `66183760`, `05cc44a3`, `00428779`, `bb165e86`, `fc65ca60`, `eb9a6da7`, `bb4a2c60`.
- iOS-framework only (the kalsa app is Android; these matter only to
  `build-ios-frameworks`): `739d7a54`, `a974a52b`, `0f313bab`.
- `652414cb` changes `cpp/rn-tts.cpp`, a path its own body calls unreachable from the
  kalsa app.

**Undo / correction pairs, each verified from the diffs:**

- **P1, `49546c8d` -> `04a3685a` (+ merge `74836284`).** `49546c8d` deletes
  `scripts/bootstrap.sh` (558 lines) and the `package.json` `"bootstrap"` entry, and
  removes `run: npm run bootstrap && npm run build` from
  `.github/actions/setup/action.yml`. The merge `74836284` brings upstream's
  `scripts/bootstrap.sh` and the `"bootstrap": "./scripts/bootstrap.sh"` entry back (they
  exist in `upstream/main`), and `04a3685a` re-adds the setup-action line. Verified:
  `git show 49546c8d:package.json | grep bootstrap` is empty;
  `git show 74836284:package.json` has it at line 43; `04a3685a`'s diff has
  `+      run: npm run bootstrap && npm run build`. A partial undo.
- **P2, `739d7a54` -> `a974a52b` -> `0f313bab`.** A three-step chain where each step is a
  re-audit of the previous: `a974a52b` guards the second bare include `739d7a54` left
  behind and rewrites the gate ("An audit of 739d7a54 found two real defects in it");
  `0f313bab` fixes two path-resolution defects in `a974a52b`'s gate ("Re-audit of a974a52b
  found two defects in the gate").
- **P3, `88e7eed5` -> `18f3ff33` (partial) -> `11cc0f9f`.** `88e7eed5` anchors
  `progress_callback_user_data` to `^[ \t]*void \* progress_callback_user_data *= *nullptr;$`;
  `18f3ff33` deliberately loosens it to `^[[:space:]]*void \* progress_callback_user_data[[:space:]]*[=;]`
  because pinning the initializer turns an upstream default change into a false alarm;
  `11cc0f9f` then states that the loosening was innocent ("I had blamed the wrong
  commit ... The loosening did not create the bypass") and fixes the real hole by
  stripping comments before matching.
- **P4, `24fb7098` -> `9cb24abb`.** `24fb7098` excludes `example` from the typecheck
  (removing it from `tsconfig.json`'s `exclude`); `9cb24abb` finding 3 reverts that
  ("`example` was excluded from the typecheck on the reasoning that its dependencies are
  never installed -- true locally, false in CI ... Reverted"). Verified in the diff:
  `-    "tmp",` / `-    "example"` becomes `+    "tmp"`.
- **P5, `54c99f14` -> `6eea3f53`.** `54c99f14` deletes `scripts/assert-cpp-includes.sh`
  with the justification that the tree is now whole directories ("so there are no lists
  to fall behind"); `6eea3f53` recreates the property as `scripts/assert-rnllama-sources.sh`
  and says the justification "was false: the manifest also names files explicitly
  (15 individual ggml entries at last count)".
- **P6, G4's five commits -> `54c99f14`.** `49546c8d`, `5d679fef`, `f770f542`,
  `b64d1116` and `91bdb5d0` all edit `scripts/assert-cpp-includes.sh`; `54c99f14`
  deletes the file. Two days of gate hardening are gone at the tip, and
  `scripts/assert-rnllama-sources.sh` is a different, smaller script.
- **P7, `bb165e86` -> merge -> `bde3f975`.** The same defect family repaired twice.
  `bb165e86` replaces the pre-migration hand-written OpenCL **kernel** list with a glob
  (verified: `git show d6d95ecc:android/src/main/rnllama/CMakeLists.txt:269` is
  `file(GLOB GGML_OPENCL_KERNELS ...)`). `74836284` inherits upstream's CMake, which
  carries a hand-written OpenCL **backend source** list of two files, and `bde3f975`
  replaces that with a glob after the link failed on fifteen symbols.
- **P8, `a974a52b` corrects `739d7a54`'s false statement.** See answer 6.

### 6. Commits whose message claims something the diff (or another commit) does not support

Four cases. Three are corrections already recorded by the fork itself; one is a wording
overreach I checked against the engine repo.

1. **`739d7a54`, claim refuted by `a974a52b`.**
   Claimed in `739d7a54`'s body: *"Every such include already goes through
   JSINativeHeaders.h, which carries both spellings behind RNLLAMA_USE_FRAMEWORK_HEADERS
   -- except one bare #include "rn-governor-params.h" in RNLlamaJSI.cpp"*.
   `a974a52b`'s body: *"Also corrects a false claim committed in 739d7a54:
   JSINativeHeaders.h is not the only place carrying both spellings -- JSIParams.cpp:2-6
   already did."*
   Verified: `git show 739d7a54:cpp/jsi/JSIParams.cpp` lines 2-6 are
   `#if defined(RNLLAMA_USE_FRAMEWORK_HEADERS)` / `#include <rnllama/speculative.h>` /
   `#else` / `#include "speculative.h"` / `#endif`. The claim was false. What the diff
   does support is the narrower statement the commit actually implements: `739d7a54`'s
   diff removes one bare `rn-governor-params.h` from `RNLlamaJSI.cpp` and leaves
   `llama-ext.h` bare on the next line, which `a974a52b` then fixes.
2. **`04a3685a`, inline comment refuted by `4a6859ff`.**
   The comment `04a3685a` committed said `npm run bootstrap` "only fetches the SDK and
   generates gitignored Metal assembly, so it was safe". `4a6859ff`'s body: *"A hostile
   audit checked and that is false: scripts/bootstrap.sh:106 runs `npm install` in
   example/ and :176 runs `npm run pods` on macOS, and both example/package-lock.json and
   example/ios/Podfile.lock are tracked."* `4a6859ff`'s diff is comment-only (+13/-7) in
   the same file, so the correction is text, not behaviour.
3. **`88e7eed5`'s follow-up blame, refuted by `11cc0f9f`.** See answer 5, P3. The claim in
   question is `11cc0f9f`'s own, and it is the commit that fixes the attribution:
   *"I had blamed the wrong commit: the earlier `= *nullptr;$` form matched a commented
   declaration exactly as the looser `[=;]` form does."* This holds for a single-line
   block comment, where the declaration text starts at column 0 and a line-oriented grep
   matches it.
4. **`0288dc27`, wording overreach, substantive claim verified.**
   Message: *"the exported engine is byte-identical at both pins. Only the records of
   which commit it is move, and they are the whole of this diff."*
   The diff is 8 files, and three of them are inside the exported tree:
   `vendor/llama.cpp/common/build-info.cpp`, `vendor/llama.cpp/ggml/src/ggml-version.h`,
   `vendor/llama.cpp/src/llama-version.h`. So the exported *tree* is **not** byte-identical
   at the two pins; what is identical is the upstream *content*. The message's own next
   sentence names those files ("the records of which commit it is"), and those three are
   excluded from deletion by `scripts/sync-vendor.sh`'s KEEP list and generated at
   `:366-375`, not exported. The substantive claim holds: in `~/Projects/kalsallama`,
   `git diff --name-only 8537d097c..4ccef2f85` returns exactly 6 paths, all of them
   `.github/workflows/kalsa-server.yml` or under `tools/server/`, neither in the export
   manifest. Recommend tightening the sentence to "no upstream source in the export
   manifest changed".

Claims I checked and found **supported**, for the record: `91b258f6`
(`tests/parallel_decoding_test.cpp` byte-identical to upstream - `git rev-parse` both =
`90c43b72`); `4fab9622` (208 commits behind - `git rev-list --count` = 208; nothing reads
`kalsallama.pin`); `54c99f14` (31 `cpp/` files, 12 of them byte-identical hash duplicates -
`git rev-parse` per file); `758a6966` (commit string truncation, cache URL check,
`repack-q23k.h`); `bde3f975` (three call sites); `2f1996d4` (the `LLAMA_BUILD_COMMIT`
placeholder claim - `common/build-info.cpp.in` declares `LLAMA_BUILD_COMMIT` as the
template token and the generated file declares `LLAMA_COMMIT`); `11cc0f9f` (the
comment bypass).

### 7. What the fork needs TODAY for the governor work, by defect and by owner

The pipeline is engine -> binding -> app, and **both** validation sites must be fixed
because they duplicate the same rule. On this side the change is: an engine commit in
`Aspis0/kalsallama`, then `npm run sync:vendor` (which rewrites `vendor/VERSIONS`,
`src/version.ts` and `lib/`), then a commit here, then the app's pin moves, then APK CI,
then a device.

**Defect 5.2 (the charger poisons the governor) - three fields, three owners.**

| what | file:line | owner |
|---|---|---|
| sends `plugged` and `sensorValid`, not `t_idle_c`/`t_idle_valid` | `GovernorBatteryModule.kt:62-66`, in the **app** repo (`~/Projects/kalsa/native/GovernorBatteryModule.kt` and `~/Projects/kalsa/android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt`); it is **not** in this repo (`git ls-tree -r origin/vendor-migration \| grep -i battery` returns nothing) | APP |
| parser default `false` and the `plugged` requirement | `cpp/rn-governor-params.cpp:86` and `:92-105` (`governor_thermo_profile_is_valid`) | BINDING |
| optional in the TS contract, so the app is not made to send it | `src/types.ts:45-53` (`t_idle_valid?`, `t_idle_c?`) | BINDING |
| duplicate validation: `profile_is_valid` sets `state_ = Invalid` | `vendor/llama.cpp/src/llama-governor-policy.cpp:53-64`, called from `:88-96` | ENGINE |
| the load-time throw | `cpp/rn-llama.cpp:122-124` (and the pre-check at `:81`) | BINDING (consumes the ENGINE result) |
| sticky failure | `vendor/llama.cpp/src/llama-governor.cpp:151-156` and `:163-165`; binding mirror `cpp/rn-governor.cpp:44-49` and the non-recoverable `:72-75` | ENGINE + BINDING |
| the app's field producers | `governorInputs.ts:123-144` (`buildGovernorParams`, ten keys), `src/engine/governorInputs.ts:14-27` (`GPU_PREFILL_CORRECT`), `:62-75` (`generationFor`), `:84-121` (`gpuFit`) | APP |

**Defect 5.1 (the CPU fallback above the threshold is the hottest engine).**

| what | file:line | owner |
|---|---|---|
| the fallback: table refuses for heat, route becomes `CPU`, batch unsplit | `vendor/llama.cpp/src/llama-governor-runtime.cpp:55-63` | ENGINE |
| the refusal that must reduce tokens instead: `admit_prefill` | `vendor/llama.cpp/src/llama-governor-policy.cpp:184-226` (the `Abort`/`Wait` branch at `:188-193`) | ENGINE |
| the token cap the fix would use | `vendor/llama.cpp/src/llama-governor-policy.cpp:261-263` (`prefill_token_cap`) | ENGINE |
| the sticky failure the fix must stop latching | `vendor/llama.cpp/src/llama-governor.cpp:151-156`; `cpp/rn-governor.cpp:44-49` | ENGINE + BINDING |

**Defect 5.3 (the battery floor inverts the route).**

| what | file:line | owner |
|---|---|---|
| `requested == CPU` yields `Admit`, which lands on `prefill_route_ = GPU` | `vendor/llama.cpp/src/llama-governor-runtime.cpp:65-68` (the `Undecided -> GPU` block) | ENGINE |
| the 45% floor that is supposed to gate it | `vendor/llama.cpp/src/llama-governor-policy.cpp:152-156` (`prefill_engine()` returns CPU when `profile_.batt_level_pct < 45`) | ENGINE |
| the rule string that is the only other effect | `vendor/llama.cpp/src/llama-governor-policy.cpp:175-182` (`prefill_rule`) | ENGINE |

**What is already in place on this side.** The build is wired (`cmake/rnllama-sources.cmake:137-138`
lists `rn-governor.cpp` and `rn-governor-params.cpp`), `rn-governor.cpp` compiles against
the current engine (the `lm_` break is fixed by `f5fd027b`), the `src/llama-ext.h`
governor API is vendored (`2f1996d4`), and the OpenCL backend compiles as one directory
(`bde3f975`). The mask-as-arguments form the plan's Part 1.2 depends on is present at
`vendor/llama.cpp/ggml/src/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl:99` and `:219`
and in `gemm_moe_q4_k_q8_1_dp4a.cl:142`, at the tip and at the app's pin `0f313bab`.
So the load-time OpenCL abort is not the blocker for a governor probe; 5.2 is.

**What is missing on this side.** There is no vendor-era commit that changes the
governor's *behaviour*: `git log origin/vendor-migration -- cpp/rn-governor-params.cpp`
returns exactly one commit, `987799a1`. Any 5.1/5.2/5.3 fix therefore starts in
`Aspis0/kalsallama` (`vendor/llama.cpp/src/llama-governor-{policy,runtime,governor}.cpp`
at the pinned `4ccef2f85`), comes through `sync:vendor`, and lands as a pin move plus the
binding-side relaxation in `cpp/rn-governor-params.cpp` if the app cannot be changed to
send the two fields.

---

## COVERAGE TABLE

Every commit of ours in the window appears exactly once. 66 rows: 62 non-merge + 4 merges.

Sorted by author date, then hash. No commit appears twice; the `group` column is the same
mapping used by the topic map above.

| # | hash | date | group | subject |
|---|---|---|---|---|
| 1 | `00428779` | 2026-09-17 | G2 | build(sync): generate the pin's version headers into cpp/ -- CI dies without them |
| 2 | `05cc44a3` | 2026-09-17 | G2 | build(gate): close the coverage holes that let the version headers and kernel drift through |
| 3 | `08ba95e8` | 2026-09-17 | G6 | engine: kalsallama 70b4302 (ggml-opencl: close the two blocks the 2026-09-04 merge broke) |
| 4 | `130cc023` | 2026-09-17 | G1 | build: track lib/, bin/ and OpenCL headers; drop install-time scripts and submodules |
| 5 | `49546c8d` | 2026-09-17 | G4 | build: the gate covers every compiled TU and refuses to run half; bump needs the clone |
| 6 | `57c530cc` | 2026-09-17 | G3 | fix(rn): a draft that cannot decode from a shared KV cache falls back to plain at init; gate skips only real generated kernel headers |
| 7 | `5d679fef` | 2026-09-17 | G4 | build: gate parses ggml-opencl too; hexagon headers resolve; setup action stops re-installing |
| 8 | `619acfa9` | 2026-09-17 | G2 | fix(jsi): follow kalsallama 134a35cf2's params/chat APIs; gate now parses the jsi TUs |
| 9 | `628f4517` | 2026-09-17 | G3 | fix(rn): a fallback to plain also turns the target's nextn output off and drops the stale draft pointers |
| 10 | `66183760` | 2026-09-17 | G2 | build(gate): parse the bmoe TUs the rnllama target compiles |
| 11 | `81a32498` | 2026-09-17 | G1 | engine: cpp/ is kalsallama 134a35cf2, flattened |
| 12 | `987799a1` | 2026-09-17 | G1 | kalsa: native patch set (governor, slot manager, JSI, MoE streaming params) |
| 13 | `a0bfc383` | 2026-09-17 | G3 | fix(rn): the draft rollback is advisory; a slot whose MTP init fails re-queues its prompt |
| 14 | `a431ef93` | 2026-09-17 | G2 | fix(sync): llama_commit() reads the same pin-derived string the headers do |
| 15 | `bb165e86` | 2026-09-17 | G2 | build(opencl): derive the kernel list from the shipped .cl files; compile cl-program-cache.cpp |
| 16 | `bb4a2c60` | 2026-09-17 | G1 | build: harden sync-kalsallama.sh verify/pin (script only, cpp/ unchanged) |
| 17 | `bff76818` | 2026-09-17 | G2 | fix(rn): follow kalsallama 134a35cf2's memory and mtmd APIs without aborting the process |
| 18 | `da845d16` | 2026-09-17 | G2 | Fix reasoning budget end-tag insertion |
| 19 | `de67c015` | 2026-09-17 | G1 | build: mirror the app's allow-list fix (ad7ff7d) and the llama-ext include rewrite; regen cpp/ |
| 20 | `eb9a6da7` | 2026-09-17 | G1 | build: regenerate cpp/ from kalsallama.pin (sync script, kalsa patches, verify) |
| 21 | `fc65ca60` | 2026-09-17 | G2 | build(gate): parse the OpenCL TUs; derive version commits from the pin, not the clone |
| 22 | `05612f2b` | 2026-09-18 | G2 | fix(sync): copy ggml-cpu/iqp.cpp; the ggml-cpu list is an allow-list |
| 23 | `0a87a8ef` | 2026-09-18 | G5 | MERGE Merge branch 'gate-ndk' into kalsa |
| 24 | `24fb7098` | 2026-09-18 | G5 | build: typecheck and jest were measuring a clone of another repository |
| 25 | `2e313c77` | 2026-09-18 | G5 | fix(types): move GovernorThermoProfile above its first use |
| 26 | `3eb8ac2f` | 2026-09-18 | G5 | MERGE merge: llama.rn v0.12.9 - 45 conflicts, 5 hunks that needed a human |
| 27 | `4126b729` | 2026-09-18 | G2 | build(android): compile the vendored hash sources mtmd-helper.cpp links against |
| 28 | `45fee016` | 2026-09-18 | G5 | test: the jest mock never declared the governor bindings, so the suite was red |
| 29 | `485519fe` | 2026-09-18 | G6 | fix(sync): the bump graded the engine alone, so a broken binding reached the install |
| 30 | `652414cb` | 2026-09-18 | G3 | fix(tts): resolve the vocoder cpu params too; not reachable from the kalsa app, armed for any other consumer |
| 31 | `653e2ddb` | 2026-09-18 | G5 | build: eslint was reading the clone cache too |
| 32 | `91bdb5d0` | 2026-09-18 | G4 | fix(gate): an explicit compiler bypassed the require switch, and the floors were too generous |
| 33 | `9cb24abb` | 2026-09-18 | G5 | fix(ci): the PR guard let the heavy jobs through, and two configs still read the clone |
| 34 | `a694adfc` | 2026-09-18 | G5 | ci: run the fork's own checks on `kalsa`, not only on `main` |
| 35 | `b64d1116` | 2026-09-18 | G4 | build(gate): follow this repo's own NDK pin, refuse a silent fallback, and floor the counters |
| 36 | `c8abc1f5` | 2026-09-18 | G5 | MERGE Merge remote-tracking branch 'origin/kalsa' into v0129-on-gate |
| 37 | `e8505ca2` | 2026-09-18 | G6 | build(engine): kalsallama 237461a9 - MTP draft context, missing <stdexcept>, threadpool guard |
| 38 | `f770f542` | 2026-09-18 | G4 | build(gate): the syntax pass parses with the NDK clang; host is a labelled fallback |
| 39 | `fada1ebe` | 2026-09-18 | G3 | fix(android): normalize an explicit zero thread count too, with a default that cannot be zero |
| 40 | `ffbd39e8` | 2026-09-18 | G3 | fix(android): resolve the cpu params the CLI layer used to; pin 70b4302's new common_threadpools::init built a pool with -1 threads |
| 41 | `04a3685a` | 2026-09-19 | G5 | ci: restore npm run bootstrap so android-libs can find the Hexagon SDK |
| 42 | `0a9b9379` | 2026-09-19 | G11 | build(engine): pin 8537d09 so bmoe builds at minSdk 23 and under -Werror |
| 43 | `0f313bab` | 2026-09-19 | G12 | fix(gate): resolve jsi includes against the including file, and state the limit |
| 44 | `11cc0f9f` | 2026-09-19 | G10 | fix(scripts): make the vendor gate read code, not text |
| 45 | `12f49b30` | 2026-09-19 | G7 | fix(vendor): refuse a shallow cache before the sync writes anything |
| 46 | `18f3ff33` | 2026-09-19 | G10 | fix(scripts): do not pin the progress_callback initializer |
| 47 | `2f1996d4` | 2026-09-19 | G8 | feat(vendor): re-point the engine pin at the kalsallama fork |
| 48 | `4a6859ff` | 2026-09-19 | G5 | docs(ci): correct what npm run bootstrap actually writes |
| 49 | `4e3b2385` | 2026-09-19 | G10 | fix(vendor): run the vendor gate in sync and CI, anchor the commit check |
| 50 | `4fab9622` | 2026-09-19 | G7 | chore: drop kalsallama.pin, document vendor/VERSIONS as source of truth |
| 51 | `54c99f14` | 2026-09-19 | G7 | refactor(vendor): delete the legacy flattened engine now that vendor/ supplies it |
| 52 | `6eea3f53` | 2026-09-19 | G10 | feat(vendor): catch manifest drift, assert named build sources exist |
| 53 | `739d7a54` | 2026-09-19 | G12 | fix(ios): include the governor header the way the framework build needs |
| 54 | `74836284` | 2026-09-19 | G7 | MERGE build(vendor): adopt upstream's vendor/ layout and re-apply the kalsa binding |
| 55 | `758a6966` | 2026-09-19 | G7 | fix(vendor): verify the cached clone URL and pin the build commit to 7 |
| 56 | `88e7eed5` | 2026-09-19 | G10 | fix(scripts): close three bypass holes in assert-kalsa-vendor |
| 57 | `91b258f6` | 2026-09-19 | G5 | test(slot): assert our should_use_mtp contract, not upstream's |
| 58 | `95c3493b` | 2026-09-19 | G7 | build(engine): kalsallama 2361be359 - the q4_K MoE OpenCL kernels build again |
| 59 | `a974a52b` | 2026-09-19 | G12 | fix(ios): guard the second framework-unsafe include, and widen the gate |
| 60 | `ab7c2e65` | 2026-09-19 | G7 | fix(scripts): close three holes in assert-kalsa-vendor before it gates the deletion |
| 61 | `afc82485` | 2026-09-19 | G7 | fix(binding): restore decode timings, token ids, governor sources |
| 62 | `bde3f975` | 2026-09-19 | G9 | fix(cmake): compile the whole OpenCL backend directory, not two named files |
| 63 | `d6d95ecc` | 2026-09-19 | G7 | build(vendor): union patches for common.{h,cpp} and the kalsa vendor guards |
| 64 | `dc205f56` | 2026-09-19 | G9 | feat: vendor bmoe_stream into llama.rn and un-gate kalsa CI |
| 65 | `f5fd027b` | 2026-09-19 | G7 | fix(binding): use upstream ggml_time_us and drop dead cpp/ggml-version.h |
| 66 | `0288dc27` | 2026-09-20 | G11 | build(engine): pin llama.cpp to 4ccef2f85 (checkpoint persistence + cache_salt) |

Group sizes, recomputed from the table: G1 6, G2 11, G3 6, G4 5, G5 12, G6 3, G7 10,
G8 1, G9 2, G10 5, G11 2, G12 3. Sum = 66. Duplicate hashes = 0; unassigned = 0
(checked with `sort`/`uniq -d`/`comm` over the 62 non-merge plus the 4 merges).

**UNMAPPED: none.** Every one of the 66 commits of ours lands in a group and on a plan
item, a migration step, an engine pin, or is explicitly reported as serving nothing in
the plan (noted per commit above).

Upstream-only commits, for the boundary of the map (14 non-merge, not ours, collapsed):
`95c69e87`, `286d8a6f`, `6cf681be`, `725c2dd7`, `18bbfd1c`, `794777b9`, `2d669962`,
`3ce48142`, `1f092c28`, `7bc8a485`, `4fd06f30`, `e694afca`, `8eeedfb9`, `2af674ad`.
The last four are the upstream line the migration merged; `2af674ad` is
`upstream/main` and the second parent of `74836284`.

---

## WHAT I COULD NOT VERIFY

1. **Whether the branch has been pushed as `Aspis0/kalsa.rn` under the new name.** I read
   the local remote URLs (`origin = https://github.com/Aspis0/kalsa.rn.git`) but did no
   network fetch of that URL. The rename is asserted by the remote config and the brief,
   not by a round trip.
2. **The CI results the messages cite.** Run ids such as `35307242869`, `35301310178`,
   `35360547883`, `35279390235`, `35565687271` appear only as prose. I did not query
   GitHub, so every "CI found X" claim is unverified except where the diff itself carries
   the fix.
3. **The engine repo's own contents beyond the two checks I ran.** I verified the
   6-path diff for `8537d097c..4ccef2f85` and `rev-list --count 2361be359..f6ba2786` = 208
   in `~/Projects/kalsallama`, whose HEAD is `8537d097c`. I did not verify that
   `f6ba2786d`, `e1866612d` or `4ccef2f85` are reachable from `origin/b11010-merge` in
   that clone, nor that the `kalsa-server-v1.0.0` tag peels to `4ccef2f85`.
4. **The non-vacuity proofs each gate commit claims.** Every gate commit
   (`88e7eed5`, `18f3ff33`, `11cc0f9f`, `ab7c2e65`, `6eea3f53`, `0f313bab`, `a974a52b`,
   `739d7a54`, and the G4 ladder) claims mutations were run and turned the check red. I
   read the diffs and the pattern logic; I did not execute the scripts.
5. **Whether `0288dc27`'s "1412 exported paths" is the count of exported files or a
   different denominator.** The number of files under `vendor/llama.cpp` at the tip is
   exactly 1412 (`git ls-tree -r origin/vendor-migration -- vendor/llama.cpp | wc -l`),
   which matches, but I did not re-run the manifest to confirm the sets are equal.
6. **The app-side line numbers in answer 7.** `GovernorBatteryModule.kt:62-66` and the
   `governorInputs.ts` line numbers are taken from the plan and confirmed only to the
   extent that the file exists at `~/Projects/kalsa/native/GovernorBatteryModule.kt` and
   `~/Projects/kalsa/android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt`.
   I did not open either file. The binding-side and engine-side lines in that table I read
   directly in this repo at the tip.
7. **Whether `bde3f975`'s "fifteen undefined ggml_opencl_* symbols" is the exact count.**
   The diff supports the mechanism (a third `.cpp` in the directory was not compiled); the
   count comes from the link log I do not have.
8. **The `android/.../CMakeLists.txt` OpenCL kernel-embedding path at the tip.** At the
   tip, `GGML_OPENCL_KERNEL_HEADERS` does not exist anywhere
   (`git grep` over CMake files at the tip returns empty), i.e. the vendored engine's own
   CMake handles kernel embedding. I did not trace how the Android target obtains the
   `.cl.h` files today, only that the pre-migration glob
   (`git show d6d95ecc:android/src/main/rnllama/CMakeLists.txt:269`) is gone.
9. **The `pnpm-lock.yaml` / `pnpm-workspace.yaml` untracked files in the checkout.** They
   are present, untracked, and not from any commit in the window. I did not investigate
   who wrote them.
10. **Whether `scripts/kalsa-patches/common.{cpp,h}.patch` are still consumed.** They
   exist at the tip but no deletion commit is recorded and `scripts/sync-kalsallama.sh`
   (their only reader) is gone. I did not trace whether anything else reads them; I
   report only that they are present and orphaned by the sync-script deletion.
11. **The migration record's "741 generated files" figure for the flattened `cpp/`.** It
   does not reproduce: `git ls-tree -r -- cpp/` gives 747 at `81a32498` and 777 at
   `95c3493b` and `d6d95ecc`. I report the measured values and mark the 741 as the
   reference document's own, unverified.
