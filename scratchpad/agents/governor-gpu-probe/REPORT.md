# Governor GPU probe - engine half (order of work step 2)

Slice: engine half of "GPU probe = real compilation + clean degradation", outcome
"no more exit(1) in-app". Reconnaissance: `governor-gpu-recon/REPORT.md` section 4,
whose contract is the specification followed here.

Repo: `/Users/marco/Projects/kalsallama` (`Aspis0/kalsallama`), local `main`, HEAD
`5c96b18dd-dirty`. No push, no tag. No change to `src/llama-governor-policy.cpp`
(`select_decode`, `admit_prefill`, the dead lanes), no change to
`tests/test-governor-v0-turns.cpp` or `tests/test-governor-v02-router.cpp`, no app
repo change.

## (a) What I changed, file:line and why

Three files, +331 / -10, all under `ggml/src/ggml-opencl/`.

### 1. No `exit(1)` on the bulk compile path

`build_program_from_source_ex` (`ggml-opencl.cpp:1353`) still contains
`if (fatal) exit(1);` at `:1368` and `:1394`, but after this change no caller passes
`fatal=true`:

- `ggml-opencl.cpp:1440` - `build_program_from_source` now calls
  `build_program_from_source_ex(..., /*fatal=*/false)`. Before: `true`. On a null
  program it sets `backend_ctx->kernel_build_failed = true` (`:1444`), records the
  verdict, and returns `nullptr`. This mirrors the two FA sites that already work
  this way (`:6028`, `:6512`).
- `grep 'fatal=*/true'` -> 0 matches (it used to be 1, the bulk site).

So the two reachable `exit(1)` sites on the compile path are now behind a `fatal`
flag no in-app caller sets. The other `exit(1)` sites (`:1463`, `:1474` binary
build, `:3753` subgroup size, `:6640`-`:6682` env-selected platform/device,
`:31103`) are the same not-reachable-in-app sites the recon listed.

### 2. Every non-fatal build site guards its null program

`build_program_from_source` has 187 call sites: 186 inside `load_cl_kernels`
(`:1546`-`:5597`) and 1 inside `load_cl_kernels_argsort` (`:1499`). Every one of the
187 statements is now immediately followed by

```cpp
if (backend_ctx->kernel_build_failed) { return; }
```

so no `nullptr` program can reach the 400+ `clCreateKernel` calls that come after
them, and `CL_CHECK` -> `GGML_ASSERT(0)` cannot turn a compile failure into
`SIGABRT`. The guard is set only inside `build_program_from_source` on a null
program, so it is equivalent to the existing `if (!prog) { return false; }` pattern
at the 12 FA sites, placed before every `clCreateKernel`. Structural check in (c).

Related:
- `ggml-opencl.cpp:1489` - `load_cl_kernels_argsort` also skips when the flag is set.
- `ggml-opencl.cpp:1546` - `load_cl_kernels` returns early when the flag is set, so
  a failed load is not retried on every allocation.
- `ggml-opencl.cpp:654` - new `bool kernel_build_failed = false;` in the backend
  context.

### 3. A failed compile poisons the (device, driver) pair, not the app

Recording (`ggml-opencl.cpp:1404-1426`, `ggml_opencl_record_verdict`): `vendor`
(queried with `clGetDeviceInfo(CL_DEVICE_VENDOR)`), `CL_DEVICE_NAME`,
`CL_DRIVER_VERSION`, `CL_DEVICE_GLOBAL_MEM_SIZE`, `cl_khr_integer_dot_product`
support, and `ok|fail`. Written on failure from `build_program_from_source`
(`:1444`) and on success at the end of `load_cl_kernels` (`:5596`).

Storage, beside the existing program cache (same directory, same identity key):
- `cl-program-cache.h:64-73` - `struct cl_program_cache_verdict` and the two
  declarations.
- `cl-program-cache.cpp:175-188` - `compute_verdict_key`, a SHA-256 over the
  cache's existing `key_suffix` (device name, driver version, device version,
  platform version, format version), so a driver update invalidates the verdict.
- `cl-program-cache.cpp:470-517` - `cl_program_cache_save_verdict` /
  `cl_program_cache_load_verdict`, path
  `<cache dir>/verdict-<sha256(key_suffix)>.txt`, atomic write like the binaries.
  Both are no-ops when the cache is disabled, as on an Android app context with no
  usable temp dir.

Suppression (the device reports itself unusable):
- `ggml-opencl.cpp:9503-9505` - `ggml_opencl_supports_op` returns false for every op
  while the flag is set, so the scheduler keeps the nodes on CPU.
- `ggml-opencl.cpp:14222-14224` - `ggml_backend_opencl_buffer_type_alloc_buffer`
  returns `nullptr` while the flag is set, so the load fails cleanly instead of
  running ops with null kernels.
- `ggml-opencl.cpp:7168-7178` - the cache init moved from `alloc_buffer` to
  `ggml_cl_init`, and the persisted verdict is read there. A failing verdict sets
  the flag before the scheduler's first `supports_op`, and logs
  `ggml_opencl: kernel set failed to build on '...' (driver '...'); device disabled,
  ops stay on CPU`.

Honest boundary, stated up front: on the *first* session in which a build fails,
the failure is discovered inside `alloc_buffer` (that call is what triggers
`load_cl_kernels`), i.e. after the scheduler has already chosen backends for that
graph. That session fails the buffer allocation and the process survives; the
recorded verdict makes the *next* session keep nodes on CPU from the first
`supports_op`. Making the first session fall back before allocation requires
compiling the bulk set at device init or inside `supports_op`, which undoes the
deliberate "delay kernel loading until the first buffer is created"
(`ggml-opencl.cpp:7120`). That is a second coherent change and is not in this slice.

## (b) The test, or why there cannot be one

No test that exercises the compile-failure path is buildable in this tree without a
GPU. The reasons, in order of what I actually verified:

1. The path is `clCreateProgramWithSource` / `clBuildProgram` inside
   `build_program_from_source_ex` (`ggml-opencl.cpp:1353`). It needs a usable
   `cl_context`/`cl_device_id`, which needs a device that passes
   `ggml_opencl_is_device_supported`, i.e. OpenCL C 2.0 or above.
2. The only OpenCL implementation on this host is Apple's OpenCL 1.2 (probe output
   in (c)). The backend rejects OpenCL < 2.0, so on this host no device is
   registered and the function is unreachable from any test binary.
3. The existing OpenCL test (`tests/test-opencl-moe-roundtrip.cpp`) needs a real
   device and skips without one; it cannot reach a compile failure either.
4. I did not add a file under `tests/`. AGENTS.md forbids new `tests/*` files
   without maintainer approval, and the failure path cannot be mocked without a
   fake `libOpenCL` and a fake `cl_device_id`, i.e. a new test subsystem, which is
   a bigger change than the fix.

So I did not fake a GPU-less test. Instead I ran (i) a structural check of the exact
invariant this slice is about - every one of the 187 non-fatal build sites is
guarded before any `clCreateKernel` - and (ii) the existing governor suite. Both are
in section (c).

### On-device proof (the exact lines that must appear)

The engine half is done when a phone with a broken kernel set no longer dies. The
proof is a scratch build with one deliberate error in a bulk kernel (for example an
unbalanced brace or a stray `#error` in `ggml/src/ggml-opencl/kernels/add.cl`),
installed with `adb install -r` only (never uninstall, never clear app data, never
benchmark while charging, leave the phone as found, never touch the S23 at
192.168.1.152), then a governor session with the GPU lane enabled.

Before this change, the process dies. logcat shows the compile error and then the
process is gone, because `exit(1)` runs inside the native backend, below any
`try`/`catch`:

```
ggml_opencl: kernel compile error (err=...):

<clBuildProgram program log, which names the offending source line>
```

then no more lines from the app process (`exit(1)` is a clean process exit, not a
catchable crash). The bulk path passes no tag to `build_program_from_source_ex`, so
that line does not name the kernel; the injected error identifies it.

After this change:

```
ggml_opencl: kernel compile error (err=...):

<clBuildProgram program log>
```

appears and the process **stays up**: the native call returns, the buffer
allocation fails or falls back, and nothing calls `exit(1)`. On the next launch,
with a writable cache directory (`GGML_OPENCL_KERNEL_CACHE_DIR` set, otherwise the
cache, and with it the verdict file, is disabled and only the in-process flag
applies):

```
ggml_opencl: kernel set failed to build on 'Adreno (TM) 750' (driver '<CL_DRIVER_VERSION>'); device disabled, ops stay on CPU
```

and that session runs on CPU from the first `supports_op`, with no per-op GPU
failure.

Both strings are literal in the code: the compile error at `ggml-opencl.cpp:1390`,
the verdict at `ggml-opencl.cpp:7175`.

NOT VERIFIED: I ran no phone for this slice. The S23 is owned by another session,
and a scratch GPU build + run is an on-device session of its own; nothing in this
report was observed on a device.

## (c) Commands and their output

### c1. The OpenCL backend compiles (Android arm64, `GGML_OPENCL=ON`)

This tree already has an OpenCL-enabled Android build (`build-android-ocl`, NDK
`/opt/homebrew/share/android-ndk`). `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` is OFF
there, matching the app build.

```
$ cd /Users/marco/Projects/kalsallama
$ touch ggml/src/ggml-opencl/ggml-opencl.cpp ggml/src/ggml-opencl/cl-program-cache.cpp
$ cd build-android-ocl && ninja ggml-opencl
[1/3] Building CXX object ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/cl-program-cache.cpp.o
[2/3] Building CXX object ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/ggml-opencl.cpp.o
[3/3] Linking CXX static library ggml/src/ggml-opencl/libggml-opencl.a
exit=0
```

7 warnings, all in code this change did not touch (unused parameter at `:1534`,
two `-Wcast-qual` at `:8315`/`:8459`, the upstream TODO `#pragma` at `:9534`, three
unused `err` at `:12999`/`:13200`/`:13304`). No warning or error points at any added
line.

### c2. Governor test targets

```
$ cd /Users/marco/Projects/kalsallama/build && ctest -R "governor"
Test project /Users/marco/Projects/kalsallama/build
    Start 41: test-download-model
1/9 Test #41: test-download-model ..............   Passed    0.07 sec
    Start 57: test-governor-v0
2/9 Test #57: test-governor-v0 .................   Passed    0.09 sec
    Start 58: test-governor-v0-shared-cells
3/9 Test #58: test-governor-v0-shared-cells ....   Passed    0.05 sec
    Start 59: test-governor-v0-mtp-hybrid
4/9 Test #59: test-governor-v0-mtp-hybrid ......***Skipped   0.04 sec
    Start 60: test-governor-v0-commit
5/9 Test #60: test-governor-v0-commit ..........   Passed    0.05 sec
    Start 61: test-governor-v0-turns
6/9 Test #61: test-governor-v0-turns ...........   Passed    0.46 sec
    Start 63: test-governor-v0-devices
7/9 Test #63: test-governor-v0-devices .........***Skipped   0.01 sec
    Start 64: test-governor-v0-hybrid
8/9 Test #64: test-governor-v0-hybrid ..........***Skipped   0.01 sec
    Start 65: test-governor-v02-router
9/9 Test #65: test-governor-v02-router .........   Passed    0.01 sec

100% tests passed out of 9

The following tests did not run:
         59 - test-governor-v0-mtp-hybrid (Skipped)
         63 - test-governor-v0-devices (Skipped)
         64 - test-governor-v0-hybrid (Skipped)
```

Counts: 8 governor targets, 5 passed, 3 skipped, plus the `test-download-model`
fixture. This is unchanged from the previous cell's record (8 built, 5 pass / 3
skip). It did not change because nothing in this slice touches the governor policy
or the host build, which has `GGML_OPENCL=OFF`; the 3 skips are the model/device
dependent tests and the counts are stable across runs.

### c3. Every build site is guarded (structural check)

```
$ cd /Users/marco/Projects/kalsallama && python3 - <<'EOF'
... (parser over build_program_from_source call sites;
     asserts the next non-space token is the guard) ...
EOF
call sites: 187
unguarded: 0
guard lines: 187
```

Each call site's `)`-`;` end is immediately followed by
`if (backend_ctx->kernel_build_failed) { return; }`, with no `clCreateKernel` in
between.

### c4. No fatal compiler call remains

```
$ grep -c 'fatal=*/true' ggml/src/ggml-opencl/ggml-opencl.cpp
0
$ grep -n 'exit(1)' ggml/src/ggml-opencl/ggml-opencl.cpp
1368:            if (fatal) exit(1);
1394:            exit(1);
1463:        exit(1);
1474:        exit(1);
3753:            exit(1);
6640:            exit(1);
6658:                exit(1);
6669:            exit(1);
6682:                exit(1);
31103:        exit(1);
```

`:1368`/`:1394` are now behind `fatal`, which no caller sets; `:1463`/`:1474` are
`GGML_OPENCL_USE_ADRENO_BIN_KERNELS` only; `:3753` is the non-Adreno/non-Intel
subgroup path; `:6640`-`:6682` need `GGML_OPENCL_PLATFORM`/`GGML_OPENCL_DEVICE`,
which an Android app never sets.

### c5. The host has no usable OpenCL device

```
$ clang -o /tmp/oclprobe /tmp/oclprobe.c -framework OpenCL && /tmp/oclprobe
platforms=1
 platform 0: OpenCL 1.2 (Jul 31 2026 20:36:30) devices=1
   dev: Apple M1 Max | OpenCL 1.2
```

OpenCL 1.2 is below the backend's 2.0 requirement, which is why (b) says no host
test can reach the compile path. (`oclprobe.c` is a 20-line throwaway in `/tmp`,
not added to the repo.)

### c6. Working tree

```
$ git status --short
 M ggml/src/ggml-opencl/cl-program-cache.cpp
 M ggml/src/ggml-opencl/cl-program-cache.h
 M ggml/src/ggml-opencl/ggml-opencl.cpp
?? CMakeUserPresets.json      (pre-existing, untracked, not mine)
?? pkg-snapdragon/            (pre-existing, untracked, not mine)
$ git diff --stat
 ggml/src/ggml-opencl/cl-program-cache.cpp |  64 ++++++++
 ggml/src/ggml-opencl/cl-program-cache.h   |  16 ++
 ggml/src/ggml-opencl/ggml-opencl.cpp      | 261 ++++++++++++++++++++++++++++--
 3 files changed, 331 insertions(+), 10 deletions(-)
$ git diff --quiet tests/ && echo "tests/ untouched"
tests/ untouched
```

## (d) What I did NOT do, and what is NOT VERIFIED

Deliberately not done, per the order of work:

- No governor policy change. `src/llama-governor-policy.cpp` (`select_decode`,
  `admit_prefill`), the dead lanes 5.4/5.5/5.6, `src/llama-governor-runtime.cpp` and
  `src/llama-governor.cpp` are untouched.
- The two deliberately-green dead-lane tests (`tests/test-governor-v0-turns.cpp:293-297`,
  `tests/test-governor-v02-router.cpp:141-147`) are untouched; `tests/` has no diff.
- No app repo change, no binding (`cpp/`), no JSI, no `KALSA_GOVERNOR_FALLBACK`
  change, no `gpuFit` change.
- The `exit(1)` sites in `build_program_from_binary` and the env-selected
  platform/device probe are left as they were; they are not reachable in-app.
- The now-dead `if (fatal) exit(1)` branches in `build_program_from_source_ex` are
  kept, because `_ex` still has a `fatal` contract for hypothetical callers. Only
  the bulk wrapper stopped using it.
- I did not move the bulk compile to device init or `supports_op`, so the first
  failing session is not pre-emptively routed to CPU (see the boundary in (a)).

Known limitations of what I did build:

- The verdict has no expiry. A transient failure (for example
  `CL_OUT_OF_HOST_MEMORY` during the bulk build, which has no retry because
  `retry_queue` is null there) persists as a `fail` for that (device, driver) until
  the cache entry is cleared. The old behavior was `exit(1)` with no retry either,
  so this is not a regression, but it is new state. The cache lives in the temp dir
  and is evictable.
- The verdict file exists only when the program cache is enabled. If the app context
  has no usable temp dir, `cl_program_cache_init` disables the cache and the verdict
  is in-process only. The no-`exit(1)` behavior still holds; the cross-launch
  suppression does not.
- `cl-program-cache.cpp` grew from 453 to 517 lines, above the ~350-450 guide. The
  recon explicitly says to extend the existing cache rather than add a subsystem,
  and the file was already at 453 before this change.

NOT VERIFIED, explicitly:

- Nothing on a device. No phone was touched; the S23 belongs to another session.
- No test exercised the compile-failure path. The check in (c3) verifies the guard
  invariant, not runtime behavior.
- The scheduler interaction on a real failed load is NOT VERIFIED. I claim
  `alloc_buffer` returns `nullptr` and `supports_op` returns false, but I did not
  observe a graph being split to CPU.
- The persisted-verdict read in `ggml_cl_init` is NOT VERIFIED beyond compilation.
- `cl_program_cache_load_verdict` is NOT VERIFIED at runtime. There is no unit test
  for the writer/reader round-trip; the two share one format by construction.
- Whether the kernel cache is enabled in the Android app is NOT VERIFIED; the recon
  flags the same gap. If it is off, only the in-process half of item 3 is active.
- Whether the Android build defines `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` is taken
  from the recon (it is OFF); I did not rebuild the app to confirm.
- Vendor / `cl_khr_integer_dot_product` values in the record are NOT VERIFIED as
  read on a device; they are fields written from values the backend already has
  (plus one `CL_DEVICE_VENDOR` query).

## (e) What the app half still needs

The engine now survives a failed bulk kernel build and records the verdict; the app
still has to act on it. The binding must surface the verdict and driver version next
to the OpenCL device (`cpp/rn-common.hpp` `backend_devices_info`,
`cpp/jsi/RNLlamaJSI.cpp`), so `gpuFit` (`src/engine/governorInputs.ts:84-121`) can
return `NoFit` when the probe says the kernel set does not compile; `LlamaService`
already refuses `governorLoad` on `NoFit` (`src/engine/LlamaService.ts:2314-2327`)
and lands on its CPU-only path. The non-governor one-shot retry
(`KALSA_GPU_FALLBACK`, `src/engine/LlamaService.ts:2589-2615`) cannot fire on Android
today because `resolveBackendPolicy` returns `cpu-only` and `n_gpu_layers` is never
above 0, so it only becomes useful once the GPU lane is enabled at all. Until the
app consumes the verdict, the engine half's contribution is exactly two things: a
failed compile no longer kills the process, and the next launch can be routed to CPU
before the first allocation; the current launch either fails the buffer allocation
cleanly (governor path) or needs the app's own fallback to recover.
