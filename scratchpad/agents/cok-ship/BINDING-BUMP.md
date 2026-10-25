# Binding bump — `_cok` f32 accumulator (delivery chain, link 1)

Repo: `~/Projects/llama.rn-kalsa`, branch `kalsarn-governor-engine`.
LOCAL ONLY. No push, no tag, no edit to the engine repo.

## New binding sha

```
e437b1af3de7af563526f5777dbf25d86f9b3215
build(engine): pin llama.cpp to 319b539 (_cok f32 accumulator for q4_K small-batch GEMM)
parent: 5b966218 (build(engine): pin llama.cpp to 1577495 (fast int8 default scale))
10 files changed, 61 insertions(+), 15 deletions(-)
```

`git status --porcelain` afterwards:

```
?? pnpm-lock.yaml
?? pnpm-workspace.yaml
```

The two pnpm files were never staged, added, or modified (`git add` was per-file
paths only; no `git add -A`). Lefthook pre-commit passed on commit (lint, types,
commitlint).

Pin values after the bump:

```
vendor/VERSIONS  LLAMA_CPP_REF=319b539377605f6c572e234b28678b74bd78deb5
                 LLAMA_CPP_COMMIT=319b539377605f6c572e234b28678b74bd78deb5
                 (both were 1577495b92096fca572f57a35b71607bacac85d5)
src/version.ts   BUILD_NUMBER 11201 -> 11202, BUILD_COMMIT 1577495 -> 319b539
```

The fix commit is on engine origin branch `kalsa-opencl-cok-fp32`
(`git branch -r --contains 319b53937...` lists it; upstream push stays disabled,
never touched).

## File shape (mirrors 5b966218 / b62be78f)

Committed files — same categories as both previous bumps:

```
lib/commonjs/version.js                            |  4 ++--
lib/module/version.js                              |  4 ++--
lib/typescript/version.d.ts                        |  4 ++--
src/version.ts                                     |  4 ++--
vendor/VERSIONS                                    |  4 ++--
vendor/llama.cpp/common/build-info.cpp             |  4 ++--
.../ggml-opencl/ggml-opencl.cpp                    | 26 +++++++++++++++++++++-
 .../ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl| 22 ++++++++++++++++++
vendor/llama.cpp/ggml/src/ggml-version.h           |  2 +-
vendor/llama.cpp/src/llama-version.h               |  2 +-
10 files changed, 61 insertions(+), 15 deletions(-)
```

Commit-message style matches the previous two: title
`build(engine): pin llama.cpp to <short> (<description>)`, body naming
`npm run sync:vendor` + `LLAMA_CPP_REF=`, trailer `Assisted-by: pi`.

## Sync run and exit codes

| Step | Command | Exit |
| --- | --- | --- |
| 1 | `npm run sync:vendor > /tmp/bump-sync.log 2>&1` | **1** |
| 2 | `npm run build` (bob, TS/JS only — no native), `> /tmp/bump-build.log` | **0** |
| 3 | `npm run sync:vendor > /tmp/bump-sync2.log 2>&1` (re-run) | **0** |
| 4 | `./scripts/assert-kalsa-vendor.sh` | **0** |
| 5 | `./scripts/assert-rnllama-sources.sh` | **0** |
| 6 | `npm run lint > /tmp/bump-lint.log 2>&1` | **0** |
| 7 | `npm run typecheck > /tmp/bump-tsc.log 2>&1` | **0** |
| 8 | `npm test -- --maxWorkers=2 --coverage > /tmp/bump-jest.log 2>&1` | **0** |

Run 1 exited 1 only at its final gate, after a clean sync + patch reapplication:

```
assert-kalsa-vendor: lib/commonjs/version.js disagrees with src/version.ts
(want 11202/319b539) -- run npm run build
```

`sync-vendor.sh` runs `assert-kalsa-vendor.sh` at its end; `src/version.ts` had
already been rewritten to 11202/319b539 but the committed `lib/` copies were
still 11201/1577495. `npm run build` regenerated them (exit 0). The re-run (3)
exited 0 end-to-end — fetch, all `scripts/patches/llama.cpp/*.patch`
reapplications, version regeneration, both asserts — and left the tree unchanged,
which per `vendor/README.md` is the patch-set completeness check.

Check details:

- lint: 0 errors, 1 pre-existing warning
  (`example/src/screens/TTSScreen.tsx:437 @typescript-eslint/no-shadow`).
- typecheck: `tsc --noEmit`, clean.
- jest: `Test Suites: 12 passed, 12 total; Tests: 43 passed, 43 total;
  Snapshots: 5 passed` (same CI invocation, `--maxWorkers=2 --coverage`).
  `coverage/` is not gitignored; the generated dir was removed after the run so
  the worktree stayed clean.
- No pnpm anywhere; node_modules is today's `npm ci` state.

## Vendored-diff proof

Engine diff `1577495b9..319b53937`:

```
$ git -C ~/Projects/kalsallama diff --stat 1577495b9 319b53937
 ggml/src/ggml-opencl/ggml-opencl.cpp               | 26 +++++++++++++++++++++-
 .../ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl | 22 ++++++++++++++++++
 2 files changed, 47 insertions(+), 1 deletion(-)
```

Binding's vendored diff over the same subtree:

```
$ git diff --stat -- vendor/llama.cpp/ggml/src/ggml-opencl/
 .../llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp | 26 +++++++++++++++++++++-
 .../ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl | 22 ++++++++++++++++++
 2 files changed, 47 insertions(+), 1 deletion(-)
```

Identical per-file counts and identical totals (47+/1-); only the path prefix
`vendor/llama.cpp/` differs. The whole vendored diff is these 2 engine files +
`vendor/VERSIONS` + the 4 generated identity files (`build-info.cpp`,
`ggml-version.h`, `llama-version.h`, `src/version.ts`) + the 3 `lib/` version
files = the 10 committed files. Nothing else in `vendor/` changed
(`git status` lists no other file). No patch in `scripts/patches/llama.cpp/`
touches either engine file (see the sync log's patch list), so the export is a
plain copy.

Byte-for-byte (`cmp`, exit 0 on every line; `git show <sha>:<path>` = engine at
that commit):

```
NEW ggml-opencl.cpp:                BYTE-IDENTICAL (engine 319b53937 == vendored worktree)
NEW gemm_noshuffle_q4_k_f32.cl:     BYTE-IDENTICAL (engine 319b53937 == vendored worktree)
OLD ggml-opencl.cpp:                BYTE-IDENTICAL (engine 1577495b9 == binding 5b966218 vendor/)
OLD gemm_noshuffle_q4_k_f32.cl:     BYTE-IDENTICAL (engine 1577495b9 == binding 5b966218 vendor/)

sha256:
5b26d632dcd726f44a284bf27eb869d39714e2ac9d8d615b5f47effe64ac77ed  engine@319b53937 ggml/src/ggml-opencl/ggml-opencl.cpp
5b26d632dcd726f44a284bf27eb869d39714e2ac9d8d615b5f47effe64ac77ed  vendor/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp
0d8dc8c12b2c5a81f28983bf8e16f20c48087ee8132bb5d6058d825e968fa5de  engine@319b53937 ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl
0d8dc8c12b2c5a81f28983bf8e16f20c48087ee8132bb5d6058d825e968fa5de  vendor/llama.cpp/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl
```

Old endpoints byte-identical + new endpoints byte-identical ⇒ the vendored diff
is exactly the engine diff. No extra hunks, no extra files. Nothing STOP-worthy
found.

## One deviation from a raw rebuild, disclosed

`npm run build` (step 2, unavoidable — the sync's assert demands it) also
regenerated three files **not** in either previous bump's file set:

```
lib/typescript/index.d.ts                  (onToken?: (...) => void  ->  onToken?: ((...) => void) | undefined)
lib/typescript/index.d.ts.map
lib/typescript/NativeRNLlama.d.ts.map
```

These are declaration-emit drift: `src/index.ts` did not change in this bump,
TypeScript is pinned at 5.1.6 in `package-lock.json`, and these three were last
written in `758a6966`, i.e. they predate the current toolchain output.
`assert-kalsa-vendor.sh` checks only the three `lib/` **version** files, so the
drift is invisible to CI's vendor job, and it is outside vendor/.

Decision: reverted to HEAD (`git checkout -- <3 files>`) and NOT committed, so
the commit mirrors `5b966218`/`b62be78f` exactly and the post-commit status
shows only the two pnpm files. If Marco wants the `lib/` declarations rebuilt
cleanly, that is a separate commit, not part of the pin.

## What CI must still verify

Cheap jobs (vendor asserts, lint, typecheck, jest) were run locally with the
exit codes above; CI will re-run them anyway. NOT run locally, CI is the
verifier:

- `build-android-from-source` — `npm run build:android`, the native NDK build
  (rnllama, arm64 dotprod+i8mm+hexagon+opencl, x86_64 variants). This is the
  build that compiles the bumped OpenCL kernels. Not run here (heavy native).
- `build-android-libs` — `npm run build:android-libs` (Hexagon HTP + OpenCL +
  Android libs). Not run here.
- `test` job's C++ unit tests — `tests/build_and_test.sh` + `run_tests.sh`
  (native compile). Not run here.
- `build-ios-from-source`, `build-ios-frameworks` — macOS + CocoaPods. Cannot
  run here.
- The setup action's `npm run bootstrap && npm run build` native parts (Hexagon
  SDK download, Metal embed). Not run: `action.yml` documents that bootstrap
  dirties tracked lockfiles and is CI-only unattended.

Reminder: CI only sees this commit after a push — which needs Marco's explicit
approval plus the DeepSeek audit, and the upstream push is disabled. Nothing
was pushed, no tag created (`git tag --points-at HEAD` is empty), the binding is
exactly 1 commit ahead of `origin/kalsarn-governor-engine`.

Engine repo `~/Projects/kalsallama`: untouched. Only read-only commands
(`log`/`diff`/`show`) were run there. Its worktree does show modified files
(`ggml-opencl/CMakeLists.txt`, `cl-program-cache.*`, `ggml-opencl.cpp`,
`llama-governor-policy.cpp`, `tests/*`) and untracked dirs, but all mtimes are
2026-09-21 15:24-15:31 and the reflog's last entry is 2026-09-21 15:53 —
pre-existing dirt from another session, nothing from this one (today is
2026-09-23). Its HEAD is `833cde99b` on `main`; irrelevant to the pin, which
uses explicit shas.

## Delivery chain status

- [x] engine commit `319b53937` on origin `kalsa-opencl-cok-fp32` (verified, untouched)
- [x] **binding bump `e437b1af` — this report (local, unpushed)**
- [ ] app `package.json` pin + `scripts/assert-engine-provenance.sh` must pass
- [ ] audit (DeepSeek reviewer), then push — Marco's call

## File stats
```
-rw-r--r--  1 marco  staff  9572 Sep 23 15:06 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/cok-ship/BINDING-BUMP.md
     212 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/cok-ship/BINDING-BUMP.md
```
