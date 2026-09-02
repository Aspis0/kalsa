# BigMoeOnEdge `e02b477` macOS uncached-read port

## Progress log

### Preflight — 2026-09-02

- Repository: `/Users/marco/Projects/kalsa-moe-experiments/BigMoeOnEdge`.
- `git status --porcelain=v1 --branch` was clean; checkout was detached at `9f2584f0db51647a22e5fb9ed2c13db2daa96420` (`build: point llama.cpp submodule at Aspis0/kalsallama...`).
- Confirmed the only configured remote is `origin` at `https://github.com/Aspis0/kalsa-forkbigmoeonedge.git`; no push will be performed.
- Read the full `git show e02b477` patch. It changes 13 files and implements Apple `F_NOCACHE`, `direct_`/`aligned_reads_` separation, effective per-shard `o_direct` telemetry, and related documentation.
- Reviewed recon report section 4: this is the intended small IO-layer port and should preserve the submodule repoint.
- Reviewed `40b7882`: it adds only a GitHub Actions `host-macos` build/smoke job in `.github/workflows/ci.yml`; it is not a local build prerequisite and is not being picked.

### Cherry-pick

- `git checkout -b kalsa/apple-nocache` succeeded from `9f2584f`.
- `git cherry-pick -x e02b477` required conflicts in `CHANGELOG.md`, `docs/community-benchmarks.md`,
  and `docs/limitations.md`.
  - `CHANGELOG.md`: local fork content retained; added the upstream Apple uncached-read entry.
  - `docs/limitations.md`: local fork content retained; added the upstream macOS and no-iOS notes.
  - `docs/community-benchmarks.md`: kept deleted/absent because it is absent at the fork's parent;
    restoring the upstream-only documentation would be unrelated to this port.
- Cleanly auto-merged: `README.md`, `core/include/bmoe/expert_source.h`,
  `core/src/engine/session.cpp`, `core/src/io/file_reader.cpp`, `core/src/io/file_reader.h`,
  `core/src/io/platform_io.cpp`, `core/src/io/platform_io.h`,
  `core/src/moe/expert_stream_source.cpp`, `core/src/moe/expert_stream_source.h`, and
  `docs/telemetry.md`.
- Result: local commit `e1123289b40134562beee99018cc554daff24d2d`, with the required
  `(cherry picked from commit e02b477f914101572a198a2633a75d011dce2ea0)` trailer. `git diff --check`
  passed, the worktree is clean, and no submodule entry changed.
- `40b7882` was not picked: it only adds a GitHub Actions macOS build job, not a host build
  prerequisite.

### macOS smoke

- Host configure: `cmake -S . -B build-macos-nocache -G Ninja -DCMAKE_BUILD_TYPE=Release
  -DBUILD_SHARED_LIBS=OFF -DBMOE_BUILD_TESTS=ON -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF
  -DLLAMA_CURL=OFF` — exit `0`.
- Host build: `cmake --build build-macos-nocache -j 8` reached `[271/271]` and linked
  `build-macos-nocache/cli/bmoe-cli`; the final incremental build check returned exit `0`
  (`ninja: no work to do`). The resulting CLI and test binaries are arm64 Mach-O executables.
- Full CTest returned exit `8`: the four dependency-free tests passed, while the three synthetic
  GGUF generators failed because this Mac lacks Python packages `gguf`/`numpy`; their three gates
  were consequently not run. Focused CTest for `chat_parse`, `think_control`, `config_validate`,
  and `ngram_draft` returned exit `0` with 4/4 passed.
- Enabled and built the standalone `bmoe-iobench` diagnostic, which links the same IO sources:
  configure exit `0`, target build exit `0`. On an explicitly created 32 MiB local test file,
  default direct mode returned exit `0` and printed `direct`; `--buffered` returned exit `0` and
  printed `BUFFERED`. This exercised `FileReader::open/read` on both arms and showed direct mode
  was effective according to the open result.
- `build-macos-nocache/cli/bmoe-cli --version` returned exit `0` and printed `0.19.0`.
- The Apple IO object and final CLI each retain an unresolved `_fcntl` symbol (`nm -u` check exit
  `0`), and the source contains the `__APPLE__` `fcntl(fd, F_NOCACHE, 1)` branch. Together with
  the direct `bmoe-iobench` result, this proves the Apple uncached-open path was compiled and its
  open reported success on the test file.
- Not proved: a full model generation, multi-shard telemetry, byte identity against a resident
  model, or a measured page-cache/performance effect. No GGUF model was available locally, and the
  fixture generators were skipped solely for the missing Python dependency.
