# FIX-binding — matched HTP skels, skew gate, runtime fallback in kalsa.rn

Date: 2026-10-01. Repo: `Aspis0/kalsa.rn`, worktree
`~/Projects/llama.rn-kalsa-gov-platform`, branch `feat/governor-platform-status`.
Base `c8471449` (verified before starting; tree was clean). No device, no push,
no tags, no new branches. All work written in-session (no sub-agents).

Commits, one per step:

| step | commit | subject |
|---|---|---|
| 1 | `0d49c6a7b4190efd2ddb8100145f5efa60ecc638` | chore(vendor): bump kalsallama d07d0181b -> 61c909481 |
| 2 | `2c3e5236` (full: `git rev-parse 2c3e5236` → `2c3e5236dcc4b52c4e5dbefe4c546f5f689fbd39`) | build(htp): rebuild the four DSP skels from the vendored engine 61c909481 |
| 3 | `e1ea0ea9` | ci(vendor): gate the shipped HTP skels against the vendored engine sha |
| 4 | `7075128b` | feat(governor): degrade the HTP lane for the session on a runtime decode failure |
| fix | `1a47c48f` | fix(ci): the skel gate hashes with sha256sum on the ubuntu runner |

Final HEAD: `1a47c48f`; `git status --porcelain` clean at the end.

## 1. Vendor bump (0d49c6a7)

Procedure per `vendor/README.md`: edited `LLAMA_CPP_REF` in `vendor/VERSIONS`
to `61c9094811cb200fd475491f18f594fbde77634b`, `npm run sync:vendor`
(git-archive export + 21 patches + generated version files, build **11585** /
commit `61c9094`), `npm run build` for the lib/ gate. Both gates pass:
`assert-kalsa-vendor` (marker x1, kalsa_moe x1, governor src real, lib/
matches) and `assert-rnllama-sources` (41 paths, 18 framework-safe includes).

Vendored subset diff: **338 files, +45128/−27628** (the b11304 merge plus the
Hexagon bounded-wait series); `ggml/src/ggml-hexagon` alone is **59 files,
+13933/−7150**. Engine provenance: kalsallama main `61c909481` = upstream
b11304 + the runtime safety net (bounded batch wait
`GGML_HEXAGON_RSP_TIMEOUT_MS` default 30000 ms, decode returns −3 instead of
abort/hang on a DSP timeout/skew).

### Glue changes the bump required (all in 0d49c6a7)

1. **Sync manifest**: upstream removed `ggml/src/ggml-cpu/iqp.{cpp,h}` and
   added `ggml/src/ggml-cpu/tiled/` (`ggml-cpu.c` now includes
   `"tiled/tiled.h"`). `scripts/sync-vendor.sh` swaps the two paths for the
   `ggml/src/ggml-cpu/tiled` dir; `cmake/rnllama-sources.cmake` globs
   `ggml-cpu/tiled/*.cpp` (the podspec's recursive `**/*` already covered it).
   First sync run failed loudly at `git archive` on the missing iqp.cpp
   (the manifest's removed-file trap working as designed).
2. **mtmd patch regenerated**: the binding's
   `scripts/patches/llama.cpp/mtmd-helper.cpp.patch` (logits_last plumbing)
   wrote `batch_embd.batch.logits[n_tokens-1]`; the new batch is an opaque
   `llama_batch_ext`. Now sets the wrapper's host-side `logits` vector, which
   upstream `decode_embd_batch::render()` translates into
   `llama_batch_ext_set_output_logits` per rendered slice. Regenerated via
   `scripts/update-patch.sh llama.cpp tools/mtmd/mtmd-helper.cpp` after an
   in-place edit of the vendored file.
3. **Speculative/MTP paths off the removed common helpers**:
   `common_batch_{clear,add}` are gone and `common_speculative_process` now
   takes `const common_batch &`. In `cpp/rn-completion.{h,cpp}` and
   `cpp/rn-slot.{h,cpp}` the `spec_batch` member becomes a `common_batch`;
   decode goes through a new `llama_rn_context::decode(llama_batch_ext *)`
   overload (`cpp/rn-llama.cpp`, `llama_process(ctx, LLAMA_PROCESS_TYPE_DECODE,
   batch)`) — governor mode refuses speculative at load, so the overload never
   runs with a governor attached. `llama_batch_init/free` bookkeeping deleted.
   `llama_rn_slot` gains an explicitly defaulted move ctor/assignment (its
   destructor suppressed the implicit move; `common_batch`'s unique_ptr
   suppressed the copy `vector::resize` fell back to).
4. `ggml-hexagon.cpp.patch` (the llama.rn session-probe at registry init)
   applied clean with a ~2000-line offset, verified in the right function
   (`ggml-hexagon.cpp:8078` post-patch).

Everything else in `cpp/` (governor glue, TTS, bmoe, JSI by grep) compiles
untouched against b11304.

## 2. Matched skels (2c3e5236)

All four shipped skels rebuilt FROM the vendored tree at
`61c9094811cb200fd475491f18f594fbde77634b` (the exact commit the host backend
builds from), container-archive method: `git archive HEAD` of
`vendor/llama.cpp/ggml/include` + the ggml root headers the htp sources
include (`ggml-common.h ggml-impl.h ggml-quants.h ggml-backend-impl.h
ggml-feats.h ggml-threading.h`) + `ggml/src/ggml-hexagon`, piped on stdin into
`ghcr.io/snapdragon-toolchain/arm64-android:v0.7` (linux/amd64, uid 501:20);
source never bind-mounted, artifacts dir mounted read-write at `/artifacts`.
Standalone htp project per `scripts/build-hexagon-htp.sh` flags
(`-DCMAKE_TOOLCHAIN_FILE=htp/cmake-toolchain.cmake -DDSP_VERSION=<v>
-DPREBUILT_LIB_DIR=toolv19_<v> -DHEXAGON_HTP_DEBUG=OFF
-DGGML_HEXAGON_FP32_QUANTIZE_GROUP_SIZE=128`, Release, Ninja), retry loop x3
per DSP armed but unused: **first attempt clean for every DSP**
(DOCKER_EXIT=0). Image env: Hexagon SDK **6.6.0.0**, tools **19.0.07**
(the same container the engine's matched `libggml-htp-v73.so 4b822b58…`
was built in). Build logs: `~/Projects/llama.rn-kalsa-htp-skels/0d49c6a7/`
(`container-build.sh`, `docker-run.log`, per-DSP conf/build/install logs;
the `attempt-2/3` logs there are stale leftovers of the first, header-less
archive run — attempt-1 + docker-run.log are the real ones).

Manifest `bin/arm64-v8a/HTP_SKELS` (committed):

| file | sha256 | size |
|---|---|---|
| libggml-htp-v73.so | `505d3bfcd05324e5462ef11d0efe0397fc67d35d80f3272e77d96a922249d246` | 919048 |
| libggml-htp-v75.so | `eca5b552fac8d542d050e2a1dd31d22ef88206c5b249002037214f428081c70d` | 864840 |
| libggml-htp-v79.so | `e6a8fc6d773bdf9f6750e449674f664e8dfecbd38baefbcfb95fa96aa29ead27` | 885416 |
| libggml-htp-v81.so | `25a0882d7f479eb354644132ff1e0a00198647eb53691b7cbfff466d11627279` | 914184 |

Plus `ENGINE_COMMIT=61c9094811cb200fd475491f18f594fbde77634b` and the
toolchain/image provenance lines. Binary sanity: the new v73 skel carries the
post-`eafe15a5e` protocol markers — `strings` mdev=15, fence=7, sync-wait=2
(the stale f81f95e9 skel: 0/0/0, per AUDIT-fix-engine-r3.md F8 table).
The QAIC host-stub pair was regenerated from the same run into the gitignored
`vendor/llama.cpp/ggml/src/ggml-hexagon/htp/v73/` (untracked by design; CI
regenerates on cache miss).

## 3. Skew gate (e1ea0ea9 + 1a47c48f)

`scripts/assert-htp-skels.sh` (runnable locally, wired into the unconditional
CI `vendor` job next to the two existing asserts). Fails when
`bin/arm64-v8a/HTP_SKELS` `ENGINE_COMMIT` != `vendor/VERSIONS`
`LLAMA_CPP_COMMIT` (full 40-sha compare), or when any shipped
`libggml-htp-*.so` sha256 differs from the manifest; also refuses unvouched
shipped skels, phantom manifest entries, and a missing/malformed manifest.
`1a47c48f` fixes runner portability: bare ubuntu has `sha256sum` but not
`shasum` (verified in an ubuntu:24.04 container).

Mutation proofs (each condition mutated → run → restore; all captured):

| mutation | result |
|---|---|
| manifest `ENGINE_COMMIT` zeroed | EXIT=1, "skel engine sha 0000000 != vendored engine sha 61c9094 -- the DSP skels were not rebuilt from the vendored tree" |
| manifest v75 sha zeroed | EXIT=1, "libggml-htp-v75.so sha256 eca5b552… != manifest 0000…" |
| one byte appended to committed v79 .so | EXIT=1, "libggml-htp-v79.so sha256 1edee3b0… != manifest e6a8fc6d…" |
| unlisted `libggml-htp-v99.so` dropped into bin/ | EXIT=1, "shipped skel(s) with no HTP_SKELS entry" |
| restore after each | EXIT=0, "ok (engine 61c9094, 4 skels match the manifest)" |

Also verified the script passes inside a bare ubuntu:24.04 container against
the real repo tree (UBUNTU_EXIT=0) and on macOS (LOCAL_EXIT=0).

## 4. Runtime fallback in the governor glue (7075128b)

Design (all in `cpp/rn-llama.cpp` unless noted):

- **Trigger**: the decode wrapper's one real-failure branch —
  `governor_decode_failed(result, governor->engine_failed()) && !was_failed`
  (`cpp/rn-llama.cpp:752-754`). Flow-control −2s never trip it; the engine
  now returns −3 there on a DSP timeout/skew instead of hanging.
- **Recorder**: `llama_rn_context::note_htp_runtime_fallback()`
  (`cpp/rn-llama.cpp:825-847`, declared `cpp/rn-llama.h:201-203`). Guard:
  fires only when the HTP lane engaged (`governor_npu_device != nullptr` —
  set by `load_governor_models` only when the plan resolved HTP0) and no
  reason is recorded yet. Records
  `governor_npu_fallback = KALSA_HTP_RUNTIME_FALLBACK`
  (`"htp-runtime-error"`, the shared constant lives at
  `cpp/rn-governor-params.h:53`) and `setenv("KALSA_HTP_FALLBACK",
  KALSA_HTP_RUNTIME_FALLBACK, overwrite=1)`.
- **Non-HTP routing for the rest of the session**: reuses the EXISTING
  machinery end to end — `decide_governor_prefill_device`
  (`cpp/rn-governor-params.cpp:177-192`) reads the env at every
  `load_governor_models` (`cpp/rn-llama.cpp:113`) and a non-empty reason
  means `use_device=false` → the loader keeps the caller's device list →
  engine implicit sweep → GPU if available, else CPU. Java writes
  `KALSA_HTP_FALLBACK` only during `loadNative`, so the native setenv sticks
  for the process: HTP is never retried this session; a fresh app process
  starts clean by design.
- **Surface**: `getGovernorStats` publishes `npu_fallback`
  (`cpp/jsi/RNLlamaJSI.cpp:924-926`) and the app's end-of-turn
  `KALSA_GOVERNOR` line carries it (`LlamaService.ts:1788`) — recording the
  field IS the surfacing; no new log vocabulary, and the existing
  `KALSA_GOVERNOR_FALLBACK` decode line fires unchanged right after.
- **Failed turn: fails cleanly to the caller — chosen, with justification.**
  The engine governor is sticky-failed by design (`rn-governor.h:17-19`,
  engine `decode_impl` refuses a failed governor), so no in-place retry or
  route flip exists on this context pair; `set_prefill_override` on it would
  be a dead write. The binding's contract assigns recreation to the app
  (`cpp/rn-llama.cpp:217-219`: "CPU retry belongs to LlamaService/S4"): the
  completion throws `"Governor decode failed: …"` (unchanged,
  `RNLlamaJSI.cpp:1361-1365`), the app's runtime-fallback retry recreates the
  context, and the env lands that reload on the non-HTP route. An in-binding
  retry would duplicate the app's machinery — the parallel path the brief
  forbids.
- **Dangling-pointer fix (required by this change)**: `load_governor_models`
  used to store the `getenv` pointer itself into `owner.governor_npu_fallback`;
  the recorder's `setenv` may reallocate environ and dangle it. Now the plan
  reason is copied into `owner.governor_npu_fallback_storage`
  (`cpp/rn-llama.h:186-191`, `cpp/rn-llama.cpp:118-125`) and the published
  pointer aims there.

## 5. Tests and full-run exit codes

- C++ host (tests/, the repo convention): `build_and_test.sh` **EXIT=0**
  (all four targets build); `run_tests.sh` **EXIT=1 overall**, split:
  governor_params_test **11/11 PASS** (incl. the new
  "runtime htp reason degrades the next load" case pinning
  `decide_governor_prefill_device(true, nullptr, "htp-runtime-error")` →
  `use_device=false`, `npu_device="GPU"`), chat_parse_utf8_test **18/18**,
  parallel_decoding_test **28/28**, rnllama_tests 2/6 — the 4 failures are
  all model-loading cases: `tests/tiny-random-llama.gguf` is an
  unmaterialized LFS pointer (133 bytes) and **git-lfs is not installed on
  this machine**, so they cannot pass locally; CI checks out with
  `lfs: true`. Not caused by this change (the file loads nothing either way).
- Source pins (jest, nativeSourceGuards convention): new
  `src/__tests__/governorHtpRuntimeFallback.test.ts` — 4 tests pinning the
  recorder's placement in the real-failure branch, the engaged-lane guard,
  the overwrite setenv + absence of any `set_prefill_override` write, and
  the fresh-getenv-per-load + storage-copy trap.
- Full `npm test`: **EXIT=0**, 18 suites / 71 tests passed.
- `npm run lint`: **EXIT=0** (one pre-existing warning in
  `example/src/screens/TTSScreen.tsx`, untouched by this work).
- `npm run typecheck`: **EXIT=0**.
- `rnllama_tests` whole-library build against the new vendor tree: EXIT=0
  (the b11304 compile arbiter).
- Skew gate: macOS EXIT=0, ubuntu:24.04 container EXIT=0 (after 1a47c48f).
- `assert-kalsa-vendor.sh` / `assert-rnllama-sources.sh`: both EXIT=0.
- Lefthook pre-commit (lint-staged + commitlint) passed on every commit; one
  intermediate rejection fixed two `unicorn/better-regex` escapes in the new
  jest file before the step-4 commit landed.

## 6. Not verified / open

- **No device**: nothing here proves the matched-skels fix on silicon — the
  coordinator's S23 arms (M1/M1b/M2 matched, S1/S2 stale) from FIX-engine.md
  remain the acceptance run; the binding side adds no device evidence.
- **CI workflow run**: the gate is verified locally (macOS + ubuntu
  container) but no GitHub Actions run was triggered (no push).
- `rnllama_tests` model-loading cases: blocked by the missing git-lfs on
  this machine (above).
- The vendored `vendor/llama.cpp` tree was verified by the repo's own gates
  and the host compile; the Android/iOS native builds themselves were not run
  (no NDK/CocoaPods run in this session) — the podspec's `**/*` glob covering
  `ggml-cpu/tiled` is verified by inspection, not by a pod install.
- Engine-side residuals F1/F2/F4-class notes (audit r3) live in the engine
  repo's scope; `61c909481` carries the F1/F3/F4/F7 fixes; F2 (unbounded
  teardown join) remains open upstream-side and is unchanged here.

## 7. Audit round (2026-10-01, second session)

Five commits on top of `1a47c48f`, one per audit item, all on
`feat/governor-platform-status` (verified `git branch --show-current` before
every commit; tree clean after each). No push, no tags, no new branches, no
device. Engine repo untouched at `61c909481` (verified `git status` there).

| item | commit | subject |
|---|---|---|
| F2 | `f83e6cef` | one reproducible in-repo skel recipe; CI never writes bin/ |
| F8 | `86c38bd0` | kill the HTP lane only on an HTP prefill compute failure |
| F9 | `7a2f8ea0` | surface htp-runtime-error on the log line the lab parses |
| F19+F16+F5 | `935e5b50` | honest skips, zero-fuzz patches, sync fails on fuzz |
| F1 | `fa8d83ef` | the skel binary names its engine; the gate reads it |

Final HEAD `fa8d83efdc76ba4ad28194dbc1adad7c40957259`.

### F2 — the recipe is in the repo now

`scripts/build-htp-skels.sh` (host driver) + `scripts/htp-skels-container.sh`
(container half) replace `build-hexagon-htp.sh` and `docker-build-wrapper.sh`
(both deleted, with every caller): the driver exports the engine sha from
`vendor/VERSIONS`, refuses uncommitted modifications of tracked vendor files,
`git archive`s HEAD's ggml headers + `ggml/src/ggml-hexagon` into the
container (never a bind-mounted checkout), the container half extracts at the
fixed path `/tmp/kalsa-htp/src` (baked into FARF/`__FILE__` strings, so every
rebuild carries the recipe's prefix), builds v73/v75/v79/v81 (Release, Ninja,
`HEXAGON_HTP_DEBUG=OFF`, per-DSP build retry x3), refreshes the QAIC v73 host
stub pair — now tracked; the writer's run and both rebuilds produce
byte-identical stubs — and rewrites the manifest digests before running the
gate as its self-check. CI: `bin/` cache and `rnllamaHtpArtifactsUpToDate`
removed, gradle `prepareHTP` verifies instead of builds, and the gate now runs
after the gradle build in `build-android-from-source` and before packaging in
the release job, in addition to the vendor job. Rebuild log
`/tmp/htp-rebuild-f2.log` REBUILD_EXIT=0 (all four DSPs first-attempt clean);
`strings` in all four shows only the recipe's paths, zero `/tmp/htp-skels`.

### F1 — the gate cannot be satisfied by editing text

`scripts/htp-skels-container.sh` generates a stamp TU
(`const char kalsa_htp_engine_stamp[] __attribute__((used)) =
"KALSA_HTP_ENGINE=<40-sha>"`) from the driver-exported
`KALSA_HTP_ENGINE_SHA` and appends it to the htp target **of the archive
copy** — the engine tree (repo or vendored) is never edited, so no engine-side
change was needed. `assert-htp-skels.sh` now fails unless every shipped skel
(1) is a QDSP6 ELF of plausible size (magic + 32-bit LE + e_machine 164 +
256 KB floor) and (2) carries exactly one `KALSA_HTP_ENGINE=` string equal to
`LLAMA_CPP_COMMIT`. Mutation proofs:

| mutation | result |
|---|---|
| pin `LLAMA_CPP_{REF,COMMIT}` -> fake sha AND manifest `ENGINE_COMMIT` edited to match, no rebuild | EXIT=1, all four "engine sha 61c9094 != vendored engine sha 0123456" (the audit's green run is now red) |
| v79 replaced with placeholder bytes, manifest sha recomputed to match | EXIT=1, "is not a QDSP6 ELF of plausible size" |
| restored | EXIT=0, "ok (engine 61c9094, 4 skels match the manifest, each names its engine)" |

Bare `ubuntu:24.04` container over the real tree: EXIT=0 (the byte check uses
`od`+`awk`+`grep -a`, no binutils; one portability fix was needed — `od`
wraps at 16 bytes, so the awk index accumulates across lines, first caught by
the gate failing on the freshly-built skels, then proven green).

New skel sha256s (stamped build, all four first-attempt clean,
`/tmp/htp-rebuild-f1.log` REBUILD_EXIT=1 then green after the gate fix —
the skels themselves were good, the check was wrong):

| file | sha256 | size |
|---|---|---|
| libggml-htp-v73.so | `9a3b17d7bb510c0e0f5819fea98b71b7e50070badf893e28ac1dd34889a3d015` | 919144 |
| libggml-htp-v75.so | `21d5faa3ae77cacde5a13cbd66e2f6b9ae0554234e4f834f86602e60c43b03b3` | 864936 |
| libggml-htp-v79.so | `225ce49a0b52a8256d7abdc96337cce44aa30afb4ab35a79275735d16c7a954b` | 885512 |
| libggml-htp-v81.so | `10b7f9dffb021cc40360a5d8d1a8ffb5daaf1f382add912cf080522a85e47b80` | 914280 |

### F8 — the fallback signal, with engine file:line

`note_htp_runtime_fallback` fires only through the pure helper
`htp_prefill_runtime_failure` (`cpp/rn-governor-params.cpp`), on all four of:

1. `batch.n_tokens > 1` — the engine's own `is_prefill`
   (`vendor/llama.cpp/src/llama-governor.cpp` `decode_impl`, "const bool
   is_prefill = batch.n_tokens > 1"). HTP only ever runs prefill.
2. `stats().prefill_engine == NPU` — stamped by the route latch for THIS
   batch (`vendor/llama.cpp/src/llama-governor-runtime.cpp:109-110`:
   `prefill_route_ = admission.engine == CPU ? ... ; stats_.prefill_engine =
   admission.engine`), refreshed per decode (`refresh_policy_stats`,
   `llama-governor-runtime.cpp:53-58`). A prefill the policy latched to CPU
   (LOWBAT/heat) reports CPU and cannot misattribute.
3. `rc == -3` — the engine's compute-failure map
   (`vendor/llama.cpp/src/llama-context.cpp:1935`: `case GGML_STATUS_FAILED:
   return -3;`). Alloc failure (-2) is memory pressure, not the DSP.
4. reason prefix `"llama_decode failed with rc="` — set only where
   `llama_decode(target, batch)` itself failed (`llama-governor.cpp`
   decode_impl); the host-side handoff failures (`"KV commit failed: %.80s"`,
   the OpenCL set_tensor OOM catch in `commit_side`,
   `llama-governor.cpp:122-133`; `"route Reject during phase handoff"`,
   `llama-governor.cpp:293-297`) never touch the DSP and keep the lane on.

Smallest signal available after the engine's -3, all already published by the
engine — no engine change. Known residual: with the governor policy disabled
the stat keeps its CPU default and real HTP failures are NOT attributed (the
lane stays on, the turn still fails loudly) — under-attribution only, and the
kalsa app always enables the policy with the lane.

### F9 — visible at failure time, comments tell the truth

The `KALSA_GOVERNOR_FALLBACK` line (the one surface that fires in the failing
branch — end-of-turn telemetry is skipped on the throwing turn, the retry's
reload suppresses the plan line) now carries `npu_fallback:"htp-runtime-error"`
(`cpp/rn-llama.cpp` decode wrapper). The env-mechanism comments are fixed in
all three places: the recorder's paragraph, `rn-governor-params.h`'s constant
doc, and `RNLlama.java` — which now states that the empty-clear at :185 is
safe only because `loadNative` short-circuits on `libsLoaded`, and that a
future re-extract path outside that guard would re-arm HTP into the recorded
hang. Stated position: the app's CPU-only retry reload IS the behaviour we
want — the recovery path must not re-enter a DSP that just failed its
compute; the env is for the next governor load, not the retry.

### F19 + F16 + F5

`parallel_decoding_test`'s 14 `[SKIP] -> return true` blocks now hard-FAIL
with a `git lfs pull` hint. CI materializes the model: the test job checks
out with `lfs: true` (`ci.yml:54-56`) and `tests/.gitattributes` carries the
LFS filter (audit F20 verified `git check-attr`), so a CI failure there is a
real defect. Locally the suite now honestly reports 14 failed instead of
28/28-with-14-hidden-skips. Three patches regenerated from pristine-at-pin vs
vendored (fuzz 1/2/1 -> 0; update-patch.sh kept their preambles); all 20
patches apply `--fuzz=0` clean (verified against a fresh archive export of
`61c909481`); `sync-vendor.sh` applies with `--fuzz=0`, and `npm run
sync:vendor` over the committed tree is a byte-exact no-op (SYNC_EXIT=0,
empty `vendor/` diff). F5: the dead `-DGGML_HEXAGON_FP32_QUANTIZE_GROUP_SIZE=128`
was DROPPED (with `f83e6cef`) — the option does not exist in the engine at
this pin; grep over the repo and the vendored tree finds zero references.

### Test exit codes (full runs)

- `npm test` (jest): EXIT=0 — 18 suites / 72 tests (one new F9 pin).
- `npm run lint`: EXIT=0 (one pre-existing TTSScreen warning, untouched).
- `npm run typecheck`: EXIT=0.
- `tests/build_and_test.sh`: EXIT=0 (all four targets build).
- `tests/run_tests.sh`: EXIT=1 overall, as expected locally —
  governor_params_test 12/12 (incl. the new attribution case),
  chat_parse_utf8_test 18/18, parallel_decoding_test 14/14 FAIL **by design**
  (the F19 hard-fail working: this machine has no git-lfs, the model is a
  133-byte pointer), rnllama_tests 2/6 (pre-existing: same missing model).
- `assert-htp-skels.sh`: macOS EXIT=0, ubuntu:24.04 EXIT=0;
  `assert-kalsa-vendor.sh` / `assert-rnllama-sources.sh`: EXIT=0;
  workflow YAML parses.
- Lefthook pre-commit passed on every commit (one
  `unicorn/better-regex` rejection fixed before F9 landed).

### What only CI / device can prove

- No GitHub Actions run was triggered (no push): the gate's new legs, the
  `prepareHTP` verify-only task, and the release-job gate are verified
  locally (macOS + ubuntu container), not on the runner.
- `rnllama_tests` model cases and the parallel_decoding_test bodies need the
  LFS object (CI) — locally they fail by design.
- The stamped skels on silicon: the S23 M1/M1b/M2 arms remain the acceptance
  run; this session adds no device evidence. The stamp string is verifiable
  on-device via `strings libggml-htp-v73.so | grep KALSA_HTP_ENGINE`.
- The F8 gate has never fired on a real HTP failure; the attribution is
  proven by the pure-function host test and the engine source lines, not by
  an on-device failure.
