# BUILD.md — kit-upstream (pure ggml-org/llama.cpp master)

Date: 2026-09-04. Worktree `/Users/marco/Projects/kalsallama-wt-upstream`.
Branch `kalsa/upstream-snapshot-2026-09-04` @ `64a155d242cb427766055ea9caea6f34df1ca94b`
(`sync : ggml (#28379)`). Pushed to `origin` (github.com/Aspis0/kalsallama) only. Push exit 0.
`kalsa/npu-judge-v79-mmapfix` was **not** pushed.

`git merge-base --is-ancestor 192067b72 HEAD` → 0 (#26501).
`git merge-base --is-ancestor 960dffab0 HEAD` → 0 (#28202).

kit-v7 from mmapfix was aborted (same source as kit-v6). Docker `3382245e7417` killed; no `kit-v7/` dir.

## Recipe (as run)

Image `ghcr.io/snapdragon-toolchain/arm64-android:v0.7`, `--platform linux/amd64`, `-u $(id -u):$(id -g)`, no `-it`.
Volume: worktree → `/workspace`. Hexagon SDK `/opt/hexagon/6.6.0.0`, Tools 19.0.07, NDK r29.

```
cp docs/backend/snapdragon/CMakeUserPresets.json .   # untracked; not committed
docker run --rm -u $(id -u):$(id -g) --volume <WT>:/workspace --platform linux/amd64 -w /workspace \
  ghcr.io/snapdragon-toolchain/arm64-android:v0.7 cmake --preset arm64-android-snapdragon-release -B build-snapdragon
# serial HTP (do not ninja the four skels in parallel)
for t in htp-v73 htp-v75 htp-v79 htp-v81; do cmake --build build-snapdragon --target $t; done
cmake --build build-snapdragon
cmake --install build-snapdragon --prefix pkg-snapdragon/llama.cpp
```

Preset dump (this tree’s `CMakeUserPresets.json`, **not** kit-v6 android-31):

```
ANDROID_ABI=arm64-v8a
ANDROID_PLATFORM=android-34          # kit-v6 was android-31; this tree’s preset
CMAKE_BUILD_TYPE=Release
CMAKE_C/CXX_FLAGS=-march=armv8.7a+fp16+dotprod+i8mm -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE
CMAKE_C/CXX_FLAGS_RELEASE=-O3 -DNDEBUG
CMAKE_TOOLCHAIN_FILE=/opt/android-ndk-r29/build/cmake/android.toolchain.cmake
GGML_HEXAGON=ON GGML_LLAMAFILE=OFF GGML_OPENCL=ON GGML_OPENMP=OFF
HEXAGON_SDK_ROOT=/opt/hexagon/6.6.0.0
HEXAGON_TOOLS_ROOT=/opt/hexagon/6.6.0.0/tools/HEXAGON_Tools/19.0.07
LLAMA_OPENSSL=OFF PREBUILT_LIB_DIR=android_aarch64
```

## Exit codes

| step | log | exit |
|---|---|---|
| cmake configure | `logs/upstream/01-cmake-configure.log` | 0 |
| htp-v73 | `logs/upstream/02-htp-v73.log` | 0 |
| htp-v75 | `logs/upstream/03-htp-v75.log` | 0 |
| htp-v79 | `logs/upstream/04-htp-v79.log` | 0 |
| htp-v81 | `logs/upstream/05-htp-v81.log` | 0 |
| host `cmake --build` first | `logs/upstream/06-host-build.log` | **1** |
| host retry (`docker wait 11a645275d5a` → 0) | `logs/upstream/06-host-build-retry.log` | 0 |
| cmake --install | `logs/upstream/07-install.log` | 0 |
| assemble kit | `logs/upstream/08-assemble.exit` | 0 |
| objdump v73 | `logs/upstream/09-objdump-v73.log` | 0 |
| `git push origin kalsa/upstream-snapshot-2026-09-04` | `logs/upstream/10-push.exit` | 0 |

First host failure: ninja `FAILED: .../mul_mm_q4_0_f32_l4_lm.cl.h` running `embed_kernel.py` (no stderr). Repro of that python command in docker: exit 0. Retry of `cmake --build` completed `[588/588] Linking CXX executable bin/test-backend-ops`. Transient parallel embed race under qemu; not a source error.

Serial wrapper `00-docker-serial.exit` = 1 because it stopped at the first host failure. HTP targets were already complete; retry did not rebuild skels (`ninja: no work to do`).

CMakeUserPresets.json, `build-snapdragon/`, `pkg-snapdragon/` left untracked (not on the snapshot commit).

## Kit

Path: `~/kalsa-qdc/npu-v79-cell/kit-upstream/`
Tar: `~/kalsa-qdc/npu-v79-cell/npu-kit-62-upstream.tgz`
sha256: `1baee5163128137cb5b12efbf5e9e5eb84f89e78993375b26a5dafedc52c627a`
SHA256SUMS: 45 entries (kit-v6 path shape: 5 bin + 20 lib-fix + 20 lib).
`lib/` and `lib-fix/` are byte-identical.
`bin/test-backend-ops-153f` copied from kit-v6 (historical; not rebuilt). New build produces `test-backend-ops` only.

`file`: host bins/libs = `ARM aarch64`; `libggml-htp-v{73,75,79,81}.so` = `QUALCOMM DSP6`. New ELFs are not stripped (this tree). 153f is stripped (from kit-v6).

## mmap_buf / objdump (`lib-fix/libggml-htp-v73.so`)

Source `htp/main.c` still has `#if __HVX_ARCH__ > 73` in `htp_mmap`/`htp_munmap` (lines 54–61, 74–78). v73 skel: `-T` lists `HAP_mmap` `*UND*`, no `HAP_mmap2`.

`mmap_buf` is a real symbol at `0x4710`. HAP_mmap @plt at `0x47b0` and `0x47c0` (2-try loop). On `va == -1`/`NULL` it jumps back without `abort` (FARF “will attempt defrag”, return false). Line constants in that function: `r2=#0x385` (901, success mmap log), `r2=#0x38a` (906, exceeded HTP_MAX_MMAPS, return false).

`abort@plt` still present:

- `0x2850`/`0x2870` in `htp_iface_mmap`: `r2=#0x3a` (58) = 2GB `HAP_mmap` size guard (`htp_mmap` FARF line 58, abort line 59).
- `0x48ac`/`0x48cc` in `mmap_buf`: same `r2=#0x3a` (58) 2GB guard, inlined.
- `0x468c`/`0x46b0` in `process_ops`: `r2=#0x3c0` (960) = `prep-bufs : mmap failed after defragmentation` then abort line 961.

So: **mmap_buf does not abort on the first HAP_mmap -1**; it returns false and `prep_op_bufs` defrags, then **still aborts if remap fails** (line 961). The kit-v6 v73 path aborted immediately at main.c:729.

Logs: `logs/upstream/09-objdump-v73.log`, `09-objdump-v73-ranges.log`.

## llama-bench flags vs #60 template T

Template T (`qdc-8g2-npu-mmapbudget-60/d_run.sh`):
`./bin/llama-bench -m olmoe.gguf -p 16 -n 8 -r 1 --no-warmup -dev HTP0 -v -o jsonl --mmap 0 -fa on --ubatch-size 1024` (+ `-ngl N`).

Grep `tools/llama-bench/llama-bench.cpp` (cannot run `--help` on Mac):

| flag | still parsed | notes |
|---|---|---|
| `-r` / `--repetitions` | yes L1049 / help L431 | |
| `-o jsonl` | yes L1067 / help L434 | jsonl still a valid format |
| `--no-warmup` | yes L1083 / help L439 | |
| `--ubatch-size` / `-ub` | yes L623 / help L463 | |
| `-ngl` | yes L719 / help L470 | |
| `-fa` | yes L860 / help L475 | |
| `-dev` / `--device` | yes L670 / help L476 | |
| `--mmap` / `-mmp` | yes L886 / help L479 | **DEPRECATED** in favour of `--load-mode`; still accepted |

Also still present: `-m` L555, `-p` L584, `-n` L591, `-v` L1079.
