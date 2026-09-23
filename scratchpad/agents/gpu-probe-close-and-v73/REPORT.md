# Close the GPU-probe audit hole + give V73 the GPU prefill lane

Coder session. Two tasks, both small, in the order given:
1. close the audit's remaining hole and the two verdict gaps in the engine
   (`ggml/src/ggml-opencl/`), plus answer the round-trip test question;
2. put V73 into the GPU prefill lane in both repos, as one landing.

No commit, no push, no PR, no upstream action. No device work (no adb, no
phone, no install). Incremental sections below, one per response.

Repo A: `/Users/marco/Projects/kalsallama`, HEAD `5c96b18dd`.
Repo B: `/Users/marco/Projects/kalsa`, HEAD `e5788cf`.

## Section 0 - orientation and starting state

### 0.1 Repo A: HEAD and working tree

```
$ cd /Users/marco/Projects/kalsallama && git rev-parse --short HEAD
5c96b18dd
$ git branch --show-current
disk-tier-salt-restore
$ git log --oneline -1 main
5c96b18dd server : keep the cache namespace across a context shift
$ git log --oneline -1 disk-tier-salt-restore
5c96b18dd server : keep the cache namespace across a context shift
```

Deviation from the task brief, reported, not acted on: the checkout is not on
`main`, it is on the branch `disk-tier-salt-restore`, which points at the same
commit `5c96b18dd` as `main` at session start. Nothing is pushed from here
regardless.

Mid-session HEAD move (not caused by me): another session committed the
`tools/server/` cache-salt work as `833cde99b` ("server : stamp the cache
namespace on a restored slot", 4 files, server only) on this same branch. HEAD
for repo A is now `833cde99b`, and those 4 files are clean. That commit does not
touch any file of this task, and all 7 of my modified files remained uncommitted
throughout (`ggml/src/ggml-opencl/{CMakeLists.txt,cl-program-cache.cpp,cl-program-cache.h,ggml-opencl.cpp}`,
`src/llama-governor-policy.cpp`, `tests/CMakeLists.txt`,
`tests/test-opencl-moe-roundtrip.cpp`).

```
$ git status --short
 M ggml/src/ggml-opencl/cl-program-cache.cpp
 M ggml/src/ggml-opencl/cl-program-cache.h
 M ggml/src/ggml-opencl/ggml-opencl.cpp
 M tools/server/server-context.cpp
 M tools/server/server-context.h
 M tools/server/server-task.h
 M tools/server/tests/unit/test_cache_salt.py
?? .zcode/
?? CMakeUserPresets.json
?? pkg-snapdragon/
```

The 3 OpenCL files are the uncommitted change I am completing. The 4
`tools/server/` files are a different uncommitted change (the cache-salt work
matching the branch name); I do not touch them and do not revert them. The
untracked paths are pre-existing except `.zcode/`, which the audit already
identified as a session tooling artifact.

```
$ git diff --stat
 ggml/src/ggml-opencl/cl-program-cache.cpp  |  64 +++++++
 ggml/src/ggml-opencl/cl-program-cache.h    |  16 ++
 ggml/src/ggml-opencl/ggml-opencl.cpp       | 261 +++++++++++++++++++++++++++--
 tools/server/server-context.cpp            |  13 +-
 tools/server/server-context.h              |   2 +-
 tools/server/server-task.h                 |   1 +
 tools/server/tests/unit/test_cache_salt.py |  80 +++++++++
 7 files changed, 424 insertions(+), 13 deletions(-)
```

### 0.2 Repo B: HEAD and working tree

```
$ cd /Users/marco/Projects/kalsa && git log --oneline -1
e5788cf governor : supply the real plugged idle baseline (defect 5.2, app)
$ git status --short
 M AGENTS.md
 M src/engine/governorInputs.test.ts
 M src/engine/governorInputs.ts
?? local-artifacts/
```

The uncommitted `governorInputs.ts` change is the owner's V73 enablement in
`GPU_PREFILL_CORRECT` (line 24: `V73: true, // owner decision 2026-09-21 ...`).
It is the change I build on. `governorInputs.test.ts` is already updated for
that half (it moved V73 expectations to `enabled: true`); one assertion at
`governorInputs.test.ts:106` still says `gpu_prefill_measured: false` for an
SM8550 (V73) device and contradicts task 2b, so task 2d has to update it. I
do not revert any of this.

### 0.3 The exact anchors named by the task, read in place

- Engine audit hole, `ggml/src/ggml-opencl/ggml-opencl.cpp:9835-9839` (case
  `GGML_OP_ARGSORT`): calls `load_cl_kernels_argsort(backend_ctx)` then
  `backend_ctx->get_kernel_workgroup_size(backend_ctx->kernel_argsort_f32_i32)`
  with no check of `kernel_build_failed` or of a null kernel.
- Engine dead `exit(1)` sites: `:1368`, `:1394` are behind `fatal`, which no
  caller sets after the audited change (`grep -c 'fatal=*/true'` returns 0).
- Verdict key: `cl-program-cache.cpp:175-186` `compute_verdict_key` hashes
  `key_suffix` only; `compute_key_suffix` (`:238-252`) is
  `device_name + driver_version + device_version + platform_version + fmt=N`.
  No kernel-set identity, no timestamp, no expiry.
- Verdict file: `cl-program-cache.cpp:463-483` writer (text lines `ok=`,
  `vendor=`, `device_name=`, `driver_version=`, `global_mem_size=`,
  `has_integer_dot=`), `:485-517` reader, `write_atomic` at `:268-290`.
- Verdict read: `ggml-opencl.cpp:7168-7178` inside `ggml_cl_init` (defined
  `:6912`), sets `kernel_build_failed` on a persisted `ok=0`.
- Task 2a anchor: `src/llama-governor-policy.cpp:163-168` in
  `prefill_engine()`; the V73 `GPU_COOLMODE` lane is `:171-174` (the audit's
  ":168-171"; that is the third enumeration, see Section 3).
- Task 2b anchor: `src/engine/governorInputs.ts:134`.

### 0.4 Scope discipline for this session

- Two "land together" edits in two repos; the engine edit alone changes nothing
  for V73 unless the app sets the flag, and the app edit alone is inert unless
  the engine admits V73 on the measured lane.
- No new files under `tests/*` (AGENTS.md:87). No new test files anywhere.
- The shared engine build dir `build-android-ocl` is used serially and is not
  deleted or reconfigured.

Section 1 follows for task 1a and the verdict fixes.

## Section 1 - task 1: close the argsort hole, expire the verdict, key it on the kernel set

### 1.1 Task 1a - the argsort-only build failure no longer aborts

`ggml/src/ggml-opencl/ggml-opencl.cpp:9835-9840`, case `GGML_OP_ARGSORT`.

Before:

```cpp
        case GGML_OP_ARGSORT: {
            load_cl_kernels_argsort(backend_ctx);

            cl_kernel kernel = backend_ctx->kernel_argsort_f32_i32;
```

After:

```cpp
        case GGML_OP_ARGSORT: {
            load_cl_kernels_argsort(backend_ctx);
            if (backend_ctx->kernel_build_failed || backend_ctx->kernel_argsort_f32_i32 == nullptr) {
                return false;
            }

            cl_kernel kernel = backend_ctx->kernel_argsort_f32_i32;
```

One line plus its guard, same shape as the other non-fatal sites. The flag
check alone closes the audit's case; the null check also covers a state where
`kernels_loaded_argsort` is false and the kernel is null for any other reason,
and costs one compare on a path the scheduler calls once per graph plan.
`load_cl_kernels_argsort` (`:1480`) sets the flag via `build_program_from_source`
on a failed build, so the guard fires before `get_kernel_workgroup_size(nullptr)`
can reach its `CL_CHECK` -> `GGML_ASSERT(0)`.

Evidence (Android toolchain, direct compile with the build dir's own flags; see
1.3 for why the shared dir was not reconfigured):

```
=== 2) ggml-opencl.cpp (final) ===
7 warnings (all pre-existing: :1534, :8315, :8459, :9534, :13002, :13203, :13307)
exit=0
```

The three `unused variable 'err'` warnings sit at :13002/:13203/:13307 instead of
the audit's :12999/:13200/:13304 because the guard added 3 lines above them.
No warning points at an added line.

### 1.2 Task 1b - verdict key gets the kernel set, verdict gets an expiry

Both gaps are closed inside `cl-program-cache.{h,cpp}` plus the OpenCL
`CMakeLists.txt`; `ggml-opencl.cpp` did not need to change for this part.

#### 1.2.1 Kernel-set identity (audit D2)

Chosen: a CMake-computed SHA-256 over the kernel set, folded into the cache key
suffix, so it reaches the verdict key and the per-program keys alike.

`ggml/src/ggml-opencl/CMakeLists.txt:49-51` (inside `ggml_opencl_add_kernel`):

```cmake
    # Kernel-set identity for the build-verdict key (see cl-program-cache.h).
    # Hashing here makes a kernel fix invalidate a stale fail verdict; the
    # configure dependency keeps the hash current in embed builds too.
    file(SHA256 ${KERN_SRC} KERN_SRC_HASH)
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${KERN_SRC})
    set(GGML_OPENCL_KERNEL_SET "${GGML_OPENCL_KERNEL_SET}${KNAME}:${KERN_SRC_HASH};" PARENT_SCOPE)
```

`ggml/src/ggml-opencl/CMakeLists.txt:265-266`:

```cmake
string(SHA256 GGML_OPENCL_KERNEL_SET_ID "${GGML_OPENCL_KERNEL_SET}")
target_compile_definitions(${TARGET_NAME} PRIVATE GGML_OPENCL_KERNEL_SET_ID="${GGML_OPENCL_KERNEL_SET_ID}")
```

`ggml/src/ggml-opencl/cl-program-cache.cpp:251-256` (`compute_key_suffix`):

```cpp
    s += "fmt=" + std::to_string(CL_PROGRAM_CACHE_FORMAT_VERSION);
#ifdef GGML_OPENCL_KERNEL_SET_ID
    s += " kset=" GGML_OPENCL_KERNEL_SET_ID;
#else
    s += " kset=unknown";
#endif
    return s;
```

Why this and not the alternatives:

- A manually bumped constant is not honest here. The audit's complaint is exactly
  that a stale fail survives an update that fixes the kernels unless a human
  remembers to bump `CL_PROGRAM_CACHE_FORMAT_VERSION`; a second manual constant
  has the same failure mode with a new name.
- A runtime hash over the sources is not available. `load_cl_kernels` reads one
  hardcoded filename per site (187 sites, `read_file("add.cl")` etc.); there is
  no runtime list of the set, and `GGML_OPENCL_EMBED_KERNELS` builds have no
  `.cl` files on disk. CMake is the only place that already enumerates the set
  (`GGML_OPENCL_KERNELS`).
- Folding into `key_suffix` (rather than a separate verdict-only field) is one
  line, and the extra invalidation of per-program keys is not real: a kernel
  change already changes `source_bytes`, which is hashed into those keys.
- `CMAKE_CONFIGURE_DEPENDS` is what makes the value follow content in the embed
  path, where `add_custom_command DEPENDS` only rebuilds the generated header
  and would leave the configure-time hash stale.

Evidence. Host build `build-host-ocl` (see 1.3), generated define in
`ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/flags.make`:

```
-DGGML_OPENCL_KERNEL_SET_ID=\"abee49e211ef64fe76417b945435820be1afc3c4f23a0d51e9c61368b7d0f56a\"
```

Content sensitivity probe (append `// hash probe` to `kernels/abs.cl`, reconfigure,
revert, reconfigure):

```
AFTER EDIT: -DGGML_OPENCL_KERNEL_SET_ID="057d872311f795f66af796f27f2935a627ee80d2ce2cf27c7651a809470b0201"
reverted abs.cl
RESTORED:   -DGGML_OPENCL_KERNEL_SET_ID="abee49e211ef64fe76417b945435820be1afc3c4f23a0d51e9c61368b7d0f56a"
```

Reconfigure dependency in effect (`CMakeFiles/Makefile.cmake`, 185 kernel `.cl`
entries; `touch kernels/abs.cl` then `make cmake_check_build_system` re-ran cmake):

```
185
grep -m2 "kernels/abs.cl" -> .../kernels/abs.cl, .../kernels/add.cl
```

Risk, stated: the value is fixed at configure time. A build that compiles an
edited `.cl` without re-running CMake gets the old printed value. The configure
dependency makes CMake re-run, but a hand-crafted build that bypasses the
generated build files could still miss it. CMake is the only supported build
route for this backend, and the same bypass would already skip the generated
embedded headers.

#### 1.2.2 Expiry and the re-probe rule (audit D1)

Chosen rule: a recorded fail is trusted for `CL_PROGRAM_CACHE_VERDICT_FAIL_TTL_SECONDS`
(15 min); older than that (or missing a timestamp) it is treated as absent, so
the caller builds the kernel set again on this launch.

`ggml/src/ggml-opencl/cl-program-cache.h:55-59`:

```cpp
// A recorded fail is only trusted for this long. One transient build failure
// (for example CL_OUT_OF_HOST_MEMORY) must not disable a working device
// forever, so a stale fail is ignored and the kernel set is built again.
#define CL_PROGRAM_CACHE_VERDICT_FAIL_TTL_SECONDS (15 * 60)
```

`cl-program-cache.h:81` adds `uint64_t written = 0;` to
`cl_program_cache_verdict` (0 in the struct means "stamp at save time").
`cl-program-cache.cpp:487` writes it, `:521` parses it, and `:526-532` decides:

```cpp
    if (!verdict.ok) {
        const uint64_t now = (uint64_t) time(nullptr);
        if (verdict.written == 0 || now - verdict.written > CL_PROGRAM_CACHE_VERDICT_FAIL_TTL_SECONDS) {
            GGML_LOG_INFO("ggml_opencl: kernel cache: stale fail verdict ignored, rebuilding kernels\n");
            return false;
        }
    }
    return true;
```

Why a timestamp is enough at this scope, and why 15 minutes:

- The only decision is "is this fail old enough to be worth another compile".
  Nothing else is needed to bound the failure mode; a retry budget would add
  process-tracked state the audit did not ask for.
- Clock moving backwards: `now - written` underflows, the fail expires, the
  kernel set is rebuilt. That fails open toward availability, which is the
  direction the audit wanted. A monotonic clock would be tidier but does not
  exist across processes.
- 15 min is the tradeoff between two costs: a genuine driver-side failure costs
  one full kernel-set compile per window instead of never re-probing, and a
  transient failure strands the GPU for at most one window after an app restart.
  The old behavior stranded it until the cache was cleared.
- `written == 0` (a file from before this change) expires immediately, so an
  existing stale fail on disk from the previous build cannot outlive the upgrade.

Evidence the write path stamps and the read path round-trips: the extended
test prints `VERDICT_ROUNDTRIP=PASS` (1.3), and the stale-fail run prints
`ggml_opencl: kernel cache: stale fail verdict ignored, rebuilding kernels`.

### 1.3 Task 1c - the round-trip is testable, and it is now tested

Done by extending the EXISTING `tests/test-opencl-moe-roundtrip.cpp` (no new
file under `tests/*`), guarded so GGML_OPENCL=OFF builds are untouched.

- `tests/test-opencl-moe-roundtrip.cpp:13-15` - `#ifdef GGML_USE_OPENCL`,
  `#define CL_TARGET_OPENCL_VERSION 300`, include `cl-program-cache.h` (the
define silences a `cl_version.h` pragma message in the test TU; the test calls
no CL API).
- `tests/test-opencl-moe-roundtrip.cpp:25-86` - `run_verdict_roundtrip()`:
  creates a temp dir and a `cl_program_cache_state` by hand (no device, no
  context), saves an ok verdict and checks every field plus `written != 0`,
  then a fresh fail (must suppress), then the same fail with an old timestamp
  (must be ignored), then a fail under one key and a load under a different
  key (must not leak).
- `tests/test-opencl-moe-roundtrip.cpp:455-459` - the case runs first in `main`,
  before `find_opencl()`, and returns 1 on failure. A missing device still
  returns 2 as before, so the existing skip semantics are unchanged.
- `tests/CMakeLists.txt:333-337` - under `if (GGML_OPENCL)`, adds the backend
  header dir and `${OpenCL_INCLUDE_DIR}` to the test target.

Host build (new directory, `build-android-ocl` untouched and not reconfigured):

```
cmake -B build-host-ocl -S . -DCMAKE_BUILD_TYPE=Release -DGGML_OPENCL=ON \
  -DGGML_OPENCL_EMBED_KERNELS=ON -DLLAMA_BUILD_TESTS=ON -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=OFF -DGGML_METAL=OFF -DLLAMA_CURL=OFF \
  -DOpenCL_INCLUDE_DIR=/Users/marco/kalsa-opencl-deps/android-prefix/include
make -C build-host-ocl test-opencl-moe-roundtrip -j8   # exit 0
./build-host-ocl/bin/test-opencl-moe-roundtrip
```

Output:

```
ggml_opencl: kernel cache: stale fail verdict ignored, rebuilding kernels
ggml_opencl: selected platform: 'Apple'
ggml_opencl: device: 'Apple M1 Max (OpenCL 1.2 )'
ggml_opencl: unsupported GPU 'Apple M1 Max'.
ggml_opencl: drop unsupported device 'Apple M1 Max'.
no OpenCL backend
VERDICT_ROUNDTRIP=PASS
exit=2
```

`exit=2` is the pre-existing "no OpenCL backend" result: the host device is
Apple OpenCL 1.2 and `ggml_opencl_is_device_supported` rejects it at
`ggml-opencl.cpp:6862-6867`, then registration drops it (`:6744-6747`). The
verdict half ran and passed before that point.

Mutation check, so the PASS is not vacuous. I changed the expiry condition to
`if (false && (...))`, rebuilt, and ran:

```
verdict: fail older than the TTL was not expired
VERDICT_ROUNDTRIP=FAIL
exit=1
```

Then I restored the condition and re-ran: PASS, exit 2. The test detects the
exact regression it exists for.

Two host-build blockers I had to work around, with file:line, because they are
the honest answer to "is it runnable on this Mac":

1. `find_package(OpenCL)` on macOS sets `OpenCL_INCLUDE_DIR` to the framework
directory, and the engine includes `<CL/cl.h>` (`cl-program-cache.h:45`). The
framework has `Headers/cl.h`, not `CL/cl.h`, so a vanilla host configure fails
with `fatal error: 'CL/cl.h' file not found`. I pointed the host configure at
the Khronos CL 3.0 headers already on this machine
(`/Users/marco/kalsa-opencl-deps/android-prefix/include`) and left the repo
unchanged. This is a pre-existing portability limit of the backend, not of this
change.
2. Targeting 300 on host fails at link against Apple's 1.2 framework:
`_clCreateBufferWithProperties` (`ggml-opencl.cpp:14258`, guarded
`#if GGML_OPENCL_TARGET_VERSION >= 300`) and `_clGetKernelSubGroupInfo`
(`ggml-opencl.cpp:3723`, guarded `#if CL_TARGET_OPENCL_VERSION >= 210`).
Reconfiguring the host build with `-DGGML_OPENCL_TARGET_VERSION=200` compiles
both references out and links; the Android build keeps 300.

What the test does NOT cover: the compile-failure path itself stays unreachable
on this host (needs a device, blocked by the 2.0 gate at
`ggml-opencl.cpp:6862-6867`), and the test cannot prove that production
`compute_key_suffix` includes the kset - it only proves that different
`key_suffix` values do not share a verdict. The kset inclusion is evidenced by
the generated compile definition and the content probe in 1.2.1.

Android toolchain re-check after all edits (direct compiles, same flags as the
build dir, no reconfigure):

```
cl-program-cache.cpp  -> exit 0 (with -DGGML_OPENCL_KERNEL_SET_ID=...) and exit 0 without it (fallback branch)
ggml-opencl.cpp       -> exit 0, 7 pre-existing warnings
test-opencl-moe-roundtrip.cpp with the new include dirs -> exit 0, no warning
```

Size note: `tests/test-opencl-moe-roundtrip.cpp` grew from 430 to 512 lines.
The audit asked for this extension and AGENTS.md:87 forbids only new files under
`tests/*`; the 82 added lines are the case plus its includes. Flagged because it
is past the ~450-line guide.

### 1.4 Task 1d - the corrected boundary sentence

The previous coder report (governor-gpu-probe/REPORT.md, section (a), item 3)
said:

> "... on the *first* session in which a build fails, the failure is discovered
> inside `alloc_buffer` (that call is what triggers `load_cl_kernels`), i.e.
> after the scheduler has already chosen backends for that graph. That session
> fails the buffer allocation and the process survives ..."

Corrected, per the audit's finding B/H:

On the first session in which a build fails, the first OpenCL `alloc_buffer`
call is NOT a real allocation. It is the size-0 dummy buffer created inside
`weight_buft_supported` (`src/llama-model-loader.cpp:1051`), reached from
`select_weight_buft` (`:1060`) while the model weights are being assigned buffer
types, before any `llama_context` (and therefore any scheduler) exists. So the
failure does not land after backend selection and does not fail that session's
allocation: `alloc_buffer` returns null, `select_weight_buft` falls through to
the CPU fallback (each GPU device's buft list ends in CPU,
`src/llama-model.cpp:1478-1480`), the weights are routed to CPU during PLANNING,
and the session COMPLETES as a CPU-only load. The next launch reads the recorded
fail in `ggml_cl_init` and keeps ops on CPU from the first `supports_op`. The
exception path (`src/llama-model.cpp:1805-1808`, caught at `src/llama.cpp:374`)
is real code but is not what runs first in the app. And with task 1a fixed, the
argsort-only failure - the one place the audit found the process could still die
- no longer aborts.

Section 2 follows for task 2.

## Section 2 - task 2: V73 on the GPU prefill lane

### 2.1 Engine edit (repo A)

`src/llama-governor-policy.cpp:166-173`, in `llama_governor_policy::prefill_engine()`.

```diff
     // measured: ALIVE #38: 8 Elite GPU prefill, G ttft 1434/1470 ms vs
     // C 16476/14412 ms (>=9.8x); decode 25.3/24.2 t/s >= C's.
-    if ((params_.generation == llama_governor_generation::V75 ||
+    // V73 carries the owner's 2026-09-21 enablement decision, not a measurement.
+    // The generation list is duplicated in the app; the form refactor should carry it once.
+    if ((params_.generation == llama_governor_generation::V73 ||
+         params_.generation == llama_governor_generation::V75 ||
          params_.generation == llama_governor_generation::V79) &&
         params_.gpu_fit == llama_governor_fit::Fit && params_.gpu_prefill_measured) {
         return llama_governor_engine::GPU;
```

No other condition in that function changed. V73 still needs `gpu_fit == Fit`
and `gpu_prefill_measured` (which the app now sets), and the earlier thermal and
battery gates are unchanged.

### 2.2 App edit (repo B)

`src/engine/governorInputs.ts:131-137`, in `buildGovernorParams()`.

```diff
     model_kind: modelKind(modelEntry),
     gpu_fit: gpuFit(modelEntry, deviceProfile, memory),
-    gpu_prefill_measured: generation === "V75" || generation === "V79",
+    // V73 carries the owner's 2026-09-21 enablement decision, not a measurement.
+    // The generation list is duplicated in the engine; the form refactor should carry it once.
+    gpu_prefill_measured:
+      generation === "V73" || generation === "V75" || generation === "V79",
```

This builds on the already-present uncommitted owner change at
`src/engine/governorInputs.ts:24` (`V73: true, // owner decision 2026-09-21 ...`),
which I did not touch. `enabled` (the `GPU_PREFILL_CORRECT` gate) and
`gpu_prefill_measured` (the lane flag) are now both true for V73 in the app, and
the engine admits V73 on the measured lane.

The honesty requirement is met in both files: the comments say the value is the
owner's 2026-09-21 enablement decision, not a measurement, and name the
duplicated list as form-refactor debt (plan Part 9 step 7). No comment, code
path, or report here claims V73 was measured in-app, because it was not.

### 2.3 Test updates, old -> new

App, `src/engine/governorInputs.test.ts:106` (the only assertion that contradicted
the new flag):

```diff
     expect(buildGovernorParams(model, device("SM8550"), memory)).toMatchObject({
       enabled: true,
       generation: "V73",
-      gpu_prefill_measured: false,
+      gpu_prefill_measured: true,
     });
```

The `enabled: true` line in that same block, and the `enabled: false` /
`reason: "gpu-prefill-incorrect-V73"` removals at lines 124 and 141, are part of
the pre-existing uncommitted owner change, not mine.

Engine: no test asserts the old V73 behavior, so none was changed.

```
$ grep -rn "gpu_prefill_measured" tests/
tests/test-governor-v0-turns.cpp:143,232,338,410  -> all V75
tests/test-governor-v02-router.cpp:202 -> V75, :214 -> V79
tests/test-governor-v0-devices.cpp:117-155 -> V73, but only toggles bench_force_gpu_prefill
```

`test-governor-v0-devices.cpp:151-155` sets V73, `Fit`, `bench_force_gpu_prefill = false`
and expects CPU; it never sets `gpu_prefill_measured`, and it is one of the three
SKIPPED tests. `test-governor-v02-router.cpp:158` sets V73 + hot-plugged, expects
CPU via the `!hot_plugged_` COOLMODE guard, with `gpu_prefill_measured` default
false. Neither changed meaning under the edit. I did not add a new engine test
for the lane: AGENTS.md warns against new tests for small features, and the task
asked to update contradictory assertions, not to add coverage. Stated as a gap:
the new engine branch has no directly running unit test.

### 2.4 Test runs

App (repo B), after the edit:

```
$ npx tsc --noEmit
tsc_exit=0
$ npx jest --silent
Test Suites: 94 passed, 94 total
Tests:       1213 passed, 1213 total
jest_exit=0
```

Engine (repo A), governor targets rebuilt from the changed policy and then run:

```
$ make -C build -j8 test-governor-v0 test-governor-v0-shared-cells \
    test-governor-v0-mtp-hybrid test-governor-v0-commit test-governor-v0-turns \
    test-governor-v0-devices test-governor-v0-hybrid test-governor-v02-router
make_exit=0
$ stat -f "%Sm %N" src/llama-governor-policy.cpp build/src/CMakeFiles/llama.dir/llama-governor-policy.cpp.o
15:29:10 src/llama-governor-policy.cpp
15:29:39 build/src/CMakeFiles/llama.dir/llama-governor-policy.cpp.o
$ ctest --test-dir build -R governor
1/9 test-download-model .............. Passed
2/9 test-governor-v0 ................. Passed
3/9 test-governor-v0-shared-cells .... Passed
4/9 test-governor-v0-mtp-hybrid ...... Skipped
5/9 test-governor-v0-commit .......... Passed
6/9 test-governor-v0-turns ........... Passed
7/9 test-governor-v0-devices ......... Skipped
8/9 test-governor-v0-hybrid .......... Skipped
9/9 test-governor-v02-router ......... Passed
100% tests passed out of 9
ctest_exit=0
```

Counts: 8 governor targets, 5 passed, 3 skipped, plus the `test-download-model`
fixture. Identical to the audited baseline (governor-gpu-probe-audit, "Reproduced
builds and tests").

Note on the shared Android build dir: I did not run ninja in
`build-android-ocl`, because my `CMakeLists.txt` edit would make ninja re-run
CMake in that directory, and the contention rule forbids reconfiguring it. I
verified the Android-toolchain compile of the two changed backend translation
units and the test TU directly, with the flags from that directory's own
`compile_commands.json` (evidence in 1.1 and 1.3). Consequence, stated: the
`build-android-ocl` artifact is now stale with respect to the new define, and the
next `ninja ggml-opencl` there will re-run CMake with the existing cache (same
flags) and pick up `GGML_OPENCL_KERNEL_SET_ID`.

### 2.5 The third places that enumerate this lane (task 2c)

Found by grep, reported, not changed (none is both unreachable and required for
the order to work):

1. `src/llama-governor-policy.cpp:174-177` (repo A) - the V73 `GPU_COOLMODE`
   lane (the audit's ":168-171", shifted by my three comment lines). It already
   lists V73 and returns a different engine, `GPU_COOLMODE`, under different
   conditions (`model_kind == MoE`, `cool_prefill_eligible`, `!hot_plugged_`).
   It is reachable, and V73 is already there, so no change is needed or made.
2. `src/engine/governorInputs.ts:13-25` (repo B) - `GPU_PREFILL_CORRECT`, the
   enablement map for the same lane. It already carries `V73: true` from the
   owner's uncommitted change, so nothing to add.
3. `/Users/marco/Projects/kalsa/tmp/kalsallama-src/src/llama-governor-policy.cpp:163-164`
   - a gitignored scratch clone (`.gitignore:50`, `tmp/`; HEAD `134a35cf2`,
   Sep 17) that still has the V75/V79-only condition. It is not part of either
   tracked repo and is not referenced by the app build configuration, so I left
   it alone.

A fourth, load-bearing observation rather than an enumeration: the engine the
app actually ships is the pinned npm package, not repo A's working tree.

```
$ grep -n "llama.rn" package.json
49:    "llama.rn": "github:Aspis0/kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2",
$ grep -n "V75\|V79" node_modules/llama.rn/vendor/llama.cpp/src/llama-governor-policy.cpp
163:    if ((params_.generation == llama_governor_generation::V75 ||
164:         params_.generation == llama_governor_generation::V79) &&
```

So on-disk, the app's installed native engine still has the old condition. The
two source edits are now consistent in the two repos, but the owner's order has
no effect in an app build until the repo A change is published and the
`llama.rn` pin refreshed (or `node_modules` rebuilt from a package containing
it). This is a release-step dependency, not something I changed.

### 2.6 Coupling check

Both source edits are present in the working trees (uncommitted, as instructed):
engine `src/llama-governor-policy.cpp:166-173`, app
`src/engine/governorInputs.ts:131-137`. With only the engine edit, V73's flag is
false and the lane is not entered; with only the app edit, the engine still
excludes V73. Neither is pushed or committed.

Section 3 follows with risks and the NOT VERIFIED list.

## Section 3 - risks

1. Expiry cost. A device whose kernel set genuinely fails now pays one full
   failed kernel-set compile per 15-minute window at the next launch/init,
   instead of never re-probing. On a phone that is one failed `clBuildProgram`
   of 187 programs and its log output per window. That is the deliberate
   tradeoff for never permanently disabling a working device; the TTL is the
   single knob (`cl-program-cache.h:59`).
2. All cache keys change once. Folding the kset into `key_suffix` invalidates
   existing per-program binaries and verdict files on the first run after this
   change. One recompile, then steady state. Not a correctness risk.
3. Configure-time hash. `GGML_OPENCL_KERNEL_SET_ID` is computed at configure
   time (see 1.2.1). A build that compiles kernel sources without re-running
   CMake would keep the old printed value. The configure dependency covers the
   normal and embed paths; a hand-rolled build that bypasses the generated
   build files is the residual hole.
4. Host-build workarounds are not repo changes. The Khronos-header redirect and
   `GGML_OPENCL_TARGET_VERSION=200` are only in my `build-host-ocl` configure.
   `build-android-ocl` still targets 300 with the Android prefix headers. A
   vanilla macOS host configure still cannot build `ggml-opencl` for the two
   reasons in 1.3; I did not fix those, they are outside this task.
5. The app's shipped engine is the pinned `llama.rn` package (2.5). Until the
   repo A change is released into that package and the pin moves, the app binary
   keeps the old condition and the owner's V73 order has no effect on a device.
6. `build-android-ocl` is now stale by one configure: it does not have the new
   `GGML_OPENCL_KERNEL_SET_ID` define and `ggml-opencl.o` there predates the
   argsort guard. I did not touch it per the contention rule; the next
   `ninja ggml-opencl` in it re-runs CMake with the same cache and rebuilds.
7. The latent pre-existing scheduler hazard the audit found
   (`ggml-backend.cpp:1633` ignoring a failed reserve) is untouched. It is not
   reachable via `kernel_build_failed` in the app flow, and the audit did not
   charge it to this change.
8. The engine lane change has no directly running unit test (2.3). The one test
   that would exercise it (`test-governor-v0-devices`) is skipped on this host.

## Section 4 - NOT VERIFIED (explicit)

- No device work of any kind. No adb, no install, no phone. Every runtime claim
  about CPU rerouting, verdict suppression, and expiry on Android is traced in
  source or exercised by the device-free unit test, never observed on hardware.
- The argsort guard (1a) is compiled for aarch64 but was not executed on a
  device, and the argsort-only failure was not induced. Its correctness rests on
  reading `load_cl_kernels_argsort` and the guard.
- The Android build was not reconfigured or relinked, so
  `GGML_OPENCL_KERNEL_SET_ID` was not materialized in that build's flags. Only
  the host configure proves the CMake hash path; the same CMakeLists is used by
  both, and the host configure exercised the same embed + Adreno kernel list.
- The Android test translation unit was compiled, not linked (a link would need
  a full Android build of the test target).
- The verdict round-trip test proves persistence and the expiry rule. It does
  not prove production `compute_key_suffix` includes the kset; that rests on the
  generated define and the content probe in 1.2.1.
- Whether the Android app enables the OpenCL kernel cache directory is unchanged
  from the previous report: if it is off, verdict persistence is in-process only
  and the expiry logic never sees a file. Not re-checked here.
- The app's Jest run (1213 tests) covers the TypeScript flag; no app test builds
  the native engine, so the cross-repo coupling is a source-level check, not an
  integration test.

## Section 5 - bottom line

Task 1, in the order given:

- 1a: the last in-app abort path the audit found is closed at
  `ggml-opencl.cpp:9837-9839`. A device that compiles the bulk set but not
  argsort now returns `false` from `supports_op` instead of passing a null kernel
  to `CL_CHECK` -> `GGML_ASSERT(0)`.
- 1b: the verdict key now folds a CMake-computed SHA-256 over the kernel set
  (`GGML_OPENCL_KERNEL_SET_ID`), so a kernel fix invalidates a stale fail; a
  recorded fail now carries a unix timestamp and is retried after 15 minutes, so
  one transient failure cannot disable a working GPU forever. Both gaps the
  audit named (D1, D2) are closed without a policy engine.
- 1c: the round-trip is tested, in the existing `tests/test-opencl-moe-roundtrip.cpp`
  (no new file), under a host `GGML_OPENCL=ON` build. `VERDICT_ROUNDTRIP=PASS`;
  a mutation of the expiry rule flips it to FAIL. The compile-failure path
  itself stays untestable on this host (device gate), which the test comments do
  not hide.
- 1d: the boundary sentence is corrected above: the first failing session
  discovers the failure during weight-buft selection, before any scheduler, and
  COMPLETES CPU-only; it does not fail the buffer allocation.

Task 2, one landing:

- Engine `src/llama-governor-policy.cpp:166-173` now lists V73 on the measured
  GPU prefill lane; app `src/engine/governorInputs.ts:134-137` now sets
  `gpu_prefill_measured` true for V73. Both files carry the comment that this is
  the owner's 2026-09-21 enablement decision, not a measurement, and that the
  duplicated list is form-refactor debt.
- Tests updated where they contradicted the change (app
  `governorInputs.test.ts:106`, false -> true); engine tests had none to update.
  `npx tsc --noEmit` clean; `npx jest --silent` 94 suites / 1213 tests pass;
  engine `ctest -R governor` 9 run, 5 pass / 3 skip (+ fixture), same as the
  baseline.
- Third enumerations reported (engine COOLMODE lane, app `GPU_PREFILL_CORRECT`,
  the gitignored `tmp/kalsallama-src` clone) and left unchanged because none is
  both unreachable and required.
- Open risk the owner must know: the app ships the engine through the pinned
  `llama.rn` package, which still carries the old condition, so the order only
  takes effect once that pin moves.

Nothing was committed, pushed, or submitted. No device was touched.

