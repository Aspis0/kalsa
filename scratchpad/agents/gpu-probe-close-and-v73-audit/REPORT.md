# Independent audit: GPU probe close-out + V73 lane (second engine/gpu slice)

Auditor: independent reviewer, default verdict UNSUPPORTED until reproduced. Subject:
commit `1068eb03d` ("gpu: no exit(1) on the OpenCL compile path, verdict keyed on the
kernel set, V73 GPU prefill lane") on branch `kalsa-gpu-opencl-v73` in
`/Users/marco/Projects/kalsallama`, a single commit on top of `833cde99b`, 7 files,
+465/-13. The app half lives uncommitted in `/Users/marco/Projects/kalsa`
(`src/engine/governorInputs.ts` + test). Coder report:
`scratchpad/agents/gpu-probe-close-and-v73/REPORT.md` (728 lines). Previous audit this
slice answers: `scratchpad/agents/governor-gpu-probe-audit/REPORT.md` (432 lines).

Method notes:

- The repo A working tree is shared with another session and dirty. I verified
  `git diff 1068eb03d -- <the 7 files>` is EMPTY, i.e. the working tree content of all
  7 audited files is identical to the commit; every source quote below is from
  `git archive 1068eb03d` extracted to `/tmp/v73-audit` (a copy; the shared tree was
  never modified). Builds I ran use either that copy or pre-existing build dirs.
- Read-only on source throughout; no commit, push, or upstream action. The mutation
  checks (claims B, E) were done on the `/tmp` copy, never on the repo.

## Claim A - the argsort hole

### A.1 The fix exists

`ggml-opencl.cpp:9835-9839` in the commit (verbatim from the extract):

```cpp
        case GGML_OP_ARGSORT: {
            load_cl_kernels_argsort(backend_ctx);
            if (backend_ctx->kernel_build_failed || backend_ctx->kernel_argsort_f32_i32 == nullptr) {
                return false;
            }

            cl_kernel kernel = backend_ctx->kernel_argsort_f32_i32;
            int max_workgroup_size = backend_ctx->get_kernel_workgroup_size(kernel);
```

`load_cl_kernels_argsort` (:1480) is also hardened on both sides: entry
`if (!kernels_loaded_argsort && !kernel_build_failed)` (:1488) and, after
`build_program_from_source`, `if (kernel_build_failed) { return; }` (:1499) before the
`clCreateKernel` at :1502. A failed argsort build therefore sets the flag inside
`build_program_from_source` (:1443-1446), returns from the loader with the kernel
null, and the supports_op guard returns false before `get_kernel_workgroup_size` can
see a null. `get_kernel_workgroup_size` (:1168) wraps `clGetKernelWorkGroupInfo` in
CL_CHECK -> GGML_ASSERT(0), so this guard is exactly the one-line class of fix the
previous audit prescribed. CONFIRMED.

### A.2 Completeness - every null/failed-kernel abort path the app can reach

My own scan (fresh Python parse over the commit's ggml-opencl.cpp, not the coder's):

```
call sites of build_program_from_source(): 187
guards found within 4 lines: 187
unguarded (wider window 7 lines): []
kernel-use-before-guard: []
```

187/187 guarded, same numbers as the previous audit's independent scan. The commit's
only `fatal` change vs `833cde99b` is the wrapper flip
`build_program_from_source_ex(..., /*fatal=*/true -> false)` at :1440; no other
fatal/exit line changed (diff grep). exit(1) sites :1368/:1394 are behind `fatal`,
no caller passes true; :1463/:1474 (binary kernels) sit behind
`use_adreno_bin_kernels`, compile-time OFF (:1535 `#ifndef` branch); :3753/:31106
(sg_size < 0) need a gpu_family that is neither ADRENO nor INTEL, and the
registration gate unchanged in the commit (:6855-6867 rejects UNKNOWN family and
OpenCL < 2.0, :6746 drops the device). :6640-6682 need GGML_OPENCL_PLATFORM/DEVICE
env vars. All unreachable in-app, same as the previous audit found.

Lazy paths beyond the bulk set (the previous audit's hole class):

1. ARGSORT - the one hole; now guarded (A.1). `load_cl_kernels_argsort` has exactly
   one caller (:9836).
2. FA prepass (`ensure_fa_pre_kernels`, :5808-5828): `build_program_from_source_ex`
   fatal=false, `if (!prog_pre_f16) { return; }`, and each raw `clCreateKernel`
   checked `err != CL_SUCCESS` with full release-and-return. The bm/bn/wg_size map
   entries consumed later by `.at()` are set UNCONDITIONALLY before the compile
   (:5794-5798), so a prepass compile failure cannot leave them missing.
3. FA prefill-512 (:5843-5851): `if (!prog) { failed[...] = true; return false; }`,
   err-checked clCreateKernel.
4. FA variant loader (:6026+) and quant split override (:6510+): `if (!prog) return
   false;` before any clCreateKernel. Optional sub-kernels (k_split, *_vec, g8/c8
   variants) are only stored when `err == CL_SUCCESS` and `fits_wg` holds, and
   `fits_wg` (which calls get_kernel_workgroup_size) is called INSIDE the
   `err == CL_SUCCESS` block (:6066-6070 et al.), so no null reaches it.
5. supports_op FA case probes the base variant while the scheduler is still deciding
   (:9922-9951, with an explicit comment that dispatch uses `map::at()` so a compiler
   rejection must be handled in supports_op): `!ggml_opencl_ensure_fa_variant(...) ->
   return false`, and for DK=512 `!ensure_fa_f32_f16_prefill_512(...) -> return false`.
6. FA compute dispatch (:18933-19010) IGNORES the ensure return values for optional
   variants (SPLIT, quant overrides), but every downstream use of those variants is
   `count()`-guarded (`use_split_kernel`, `use_split_q8_0`, `use_split_q4_0`,
   `have_kv_pad`, `have_blk` at :19421-19424) and `.at()` is only applied to the
   base-variant maps, which supports_op's probe populated, or to maps set
   unconditionally (bm/bn/wg_size). I traced each `.at()` in the dispatch
   (:18973-18990, :19058-19130) to its populating site; none can be missing when an
   op reached compute, because the op only reached compute if the supports_op probe
   of that base variant succeeded.
7. `get_kernel_workgroup_size` callers (16 call sites): :8311, :8773/:8780, :8853,
   :14831, :15025, :15286, :16579, :16657, :16730, :16836, :17870, :19937, :22608,
   :29948, :30048, :30767 all use bulk-set kernels (e.g. :8853
   `kernel_rms_norm_mul_add`, :19937 `kernel_adreno_xmem_prepack_weight_f16`), which
   cannot be null when compute runs: a failed bulk set sets kernel_build_failed,
   supports_op returns false at :9503, and no OpenCL node is scheduled at all.
   :9842 is the argsort case, guarded. The FA fits_wg calls are err-guarded (point 4).

Residual abort exposure that remains, for completeness (not regressions of this
commit): `CL_CHECK(clCreateKernel(...))` on a successfully BUILT program whose kernel
name is missing would still abort (at the 187 bulk sites and the FA CL_CHECK sites).
That is the "program compiled but name wrong" class - a source-code bug, not a driver
compile failure; it is pre-existing, identical in shape upstream, and not what the
audit's hole was about (a null program/kernel from a FAILED compile). The latent
ggml-backend.cpp ignored-reserve hazard noted by the previous audit is untouched and
still unreachable via kernel_build_failed.

VERDICT A: CONFIRMED - the fix is present at :9836-9839 and I found no second hole of
the same class on app-reachable paths.

## Claim B - the kernel-set identity

### B.1 Coverage: does the hash cover the whole kernel set?

Three independent sets, computed by fresh scripts over the commit (not the coder's):

- CMake `GGML_OPENCL_KERNELS`: 183 base names + 2 conditional appends
  (`gemm_xmem_f16_f32_os8`, `sdpa_xmem_f32_f16_os8`, appended under the Adreno
  condition) = 185.
- On-disk `kernels/*.cl`: 185.
- Runtime set: every `read_file("<name>.cl")` plus every embedded
  `#include "<name>.cl.h"` in ggml-opencl.cpp = 185.

```
listed-but-not-on-disk: []
on-disk-but-not-listed: []
runtime-but-not-listed: []
listed-but-not-runtime: []
```

All three sets are EQUAL. The argsort kernel (`argsort.cl`) and all FA kernel
sources (`flash_attn_f16/f32/f32_f16/pre_f16/f32_q8_0/f32_q4_0.cl`, dispatched via
`ggml_opencl_fa_kernel_src` :5623) are in the list, so a change to any compiled
kernel source moves the id. Nothing is loaded from outside `kernels/`.

Not covered by the hash (stated residuals, not refutations of the claim as worded):
compile option strings (built in C++ in ggml-opencl.cpp) and the precompiled Adreno
`.cl.bin` binaries (that path is compile-time OFF in both the engine build and, per
the app's define list below, the app build). So an engine update that changes ONLY a
compile flag or C++ loader logic, with no .cl change, keeps a stale fail verdict.
Narrower than the original gap, but not zero.

### B.2 Where it is folded in

`compute_key_suffix` (:239-257) appends `kset=<id>` (or the constant `kset=unknown`
when the define is absent). The suffix is hashed into BOTH key families:
`compute_key` (:156, per-program cache entries, used by try_load :378 and try_save
:466) and `compute_verdict_key` (:176, verdict filename :489/:498). So yes, it
affects the compiled-program cache too. Is that a behaviour change? For program
entries keyed on source bytes, a kernel-source change already produced a new key
(the source is hashed); the kset addition is redundant there. The real effect is
ONE-TIME: every key changes when a build first carries `kset=`, orphaning all
previously cached programs and verdict files (they are simply not found under the
new names). One recompile per device, then steady state - the coder states this as
risk 2. Harmless, and it conveniently means pre-change fail verdicts (which lack
`written=`) can never be read.

### B.3 Does the app's Android build evaluate it? NO - and this is the finding.

How the app actually builds the native engine:

- `kalsa/package.json:49` pins `"llama.rn": "github:Aspis0/kalsa.rn#0288dc2..."`.
  The engine compiled into the app is `node_modules/llama.rn/vendor/llama.cpp` -
  the vendored copy inside the npm package. The vendored copy has NO trace of this
  slice: `grep GGML_OPENCL_KERNEL_SET_ID` in the vendored ggml-opencl CMakeLists ->
  empty; `grep kset|verdict` in the vendored cl-program-cache.{h,cpp} -> empty; the
  vendored `src/llama-governor-policy.cpp:163-164` still has the V75/V79-only
  condition. No patches/ directory, no patch mechanism in package.json.
- The app build does not use the engine's `ggml/src/ggml-opencl/CMakeLists.txt` at
  all (the only place that computes the id). `node_modules/llama.rn/cmake/
  rnllama-sources.cmake:82-87` GLOBS `ggml-opencl/*.cpp` itself ("The engine's own
  CMakeLists builds this whole directory" is a comment about why they glob), and
  `android/src/main/rnllama/CMakeLists.txt:164-166` embeds kernels with its OWN
  glob, `file(GLOB GGML_OPENCL_KERNELS ... kernels/*.cl)` - note the name
  collision: in the app build that variable holds FILE PATHS for the embed loop,
  not the engine's kernel-name list, and `ggml_opencl_add_kernel` never runs.
- The app target's compile definitions are exactly
  `-DGGML_USE_OPENCL -DGGML_OPENCL_USE_ADRENO_KERNELS -DGGML_OPENCL_EMBED_KERNELS
  -DGGML_OPENCL_SOA_Q -DGGML_OPENCL_TARGET_VERSION=300`
  (CMakeLists.txt:203-209). `GGML_OPENCL_KERNEL_SET_ID` is not among them.

Consequence, spelled out: even after someone refreshes the vendored engine copy
with this commit's sources, the app build compiles cl-program-cache.cpp WITHOUT the
define, so `compute_key_suffix` takes the `#else` branch and appends the CONSTANT
string `kset=unknown`. The verdict key then does not vary with kernel content
across app builds. The D2 fix the change was made for - "a kernel fix invalidates a
stale fail verdict" - is INERT in the app build; a stale fail survives an app
update that fixes the kernels, which is precisely the audit gap D2. The `#ifdef`
fallback makes the code compile and run, so nothing loudly reports the miss. The
fix is real only in builds made by the engine repo's own CMake (build-host-ocl,
build-android-ocl), which is not what ships in the app. To make it work in the app,
the id computation must also be added to llama.rn's android CMakeLists (or the app
build must consume the engine's CMakeLists).

### B.4 The mutation proof, reproduced independently

In my own configure of the commit copy (`/tmp/v73-audit/build-host`, same flags as
the coder's build-host-ocl):

```
baseline: GGML_OPENCL_KERNEL_SET_ID="abee49e211ef64fe76417b945435820be1afc3c4f23a0d51e9c61368b7d0f56a"
          (identical to the coder's reported value - same content, same hash)
after printf '// audit hash probe\n' >> kernels/abs.cl + reconfigure:
          GGML_OPENCL_KERNEL_SET_ID="50b7dffbedc45f3b94fc505600e0b8aa9506a4f163a647191b432b2621e05b30"
after restoring abs.cl + touch + reconfigure:
          GGML_OPENCL_KERNEL_SET_ID="abee49e211ef64fe76417b945435820be1afc3c4f23a0d51e9c61368b7d0f56a"
```

The CMAKE_CONFIGURE_DEPENDS reconfigure fired on both mutations (make
cmake_check_build_system re-ran cmake each time). One honest footnote from my run:
restoring abs.cl via `git archive | tar` preserved the file's OLD mtime, and make
then did NOT re-run cmake, leaving the mutated define in flags.make until a `touch`
fixed the mtime. That is a make-timestamp artifact, not a defect of the change -
git checkout and editor saves both set fresh mtimes - but it confirms the coder's
own risk 3 (the hash follows configure runs, which follow mtimes).

VERDICT B: PARTIAL. The mechanism works exactly as claimed and I reproduced the
mutation round-trip independently (B.1, B.2, B.4 CONFIRMED). But the claim's
decisive half fails where it matters: the app's Android build never evaluates the
id - GGML_OPENCL_KERNELS in that build is a path glob for embedding, the define is
never set, and the key suffix degrades to the constant `kset=unknown`. In the
shipped app the verdict is NOT keyed on the kernel set, so audit gap D2 is closed
in the engine repo's own builds only, not in the product.

## Claim C - the fail TTL

Code (commit line numbers): the verdict struct gains `uint64_t written = 0`
(cl-program-cache.h:81, with the comment that 0 means "stamp at save time" and an
unparsed 0 counts as expired); save stamps it
(cl-program-cache.cpp:486-487); parse reads it (:520); the decision is:

```cpp
// cl-program-cache.cpp:526-533
    if (!verdict.ok) {
        const uint64_t now = (uint64_t) time(nullptr);
        if (verdict.written == 0 || now - verdict.written > CL_PROGRAM_CACHE_VERDICT_FAIL_TTL_SECONDS) {
            GGML_LOG_INFO("ggml_opencl: kernel cache: stale fail verdict ignored, rebuilding kernels\n");
            return false;
        }
    }
    return true;
```

TTL = 900 s (cl-program-cache.h:59). The caller (ggml_cl_init, ggml-opencl.cpp
:7173-7177) sets kernel_build_failed only when load returns true AND !v.ok, so a
stale fail leaves the device enabled and the next allocation re-attempts the
build; a re-attempt that fails rewrites the fail with a fresh stamp
(ggml-opencl.cpp:1445), and a re-attempt that succeeds overwrites it with ok
(:5596, written unconditionally at the end of a full load_cl_kernels). The claimed
mechanism is all present.

The specific questions:

1. Device whose kernel genuinely cannot compile: yes, it re-probes forever, but
   precisely: one compile attempt per PROCESS LAUNCH that starts more than 15 min
   after the last fail write (there is no timer inside a running process; within
   one process the flag kills all further attempts). The attempt is not quite "a
   full kernel-set compile" as the coder's risk 1 says: with the program cache
   enabled, programs that previously compiled are loaded from cache, so the
   recurring cost is the cache loads plus one failed clBuildProgram for the
   failing program (plus log output). Without a cache dir, it is the full
   sequence up to the failing kernel. Either way: unbounded, no backoff, no retry
   budget - deliberate, and stated in the coder's report (1.2.2 rationale, risk
   1). I find that defensible at this scope; the 15-minute constant is the only
   knob.
2. OK verdict TTL'd? No - the expiry is inside `if (!verdict.ok)`. An ok verdict
   is trusted indefinitely, which is the required direction (nothing here may
   disable a working device). Correct.
3. Truncated file: handled, fail-open. Empty/short/foreign file fails the
   14-byte header compare (:504) -> treated as absent -> re-probe. Truncated
   AFTER the header parses with ok missing (defaults false) and written missing
   (defaults 0) -> `written == 0` -> stale -> re-probe. This is strictly better
   than the previous revision, where the same truncation read as a FRESH fail and
   disabled the device for 15 minutes; now it can only cost a compile attempt.
   (Truncation that keeps `ok=1` but drops `written` returns an ok verdict - the
   availability direction again, harmless.)
4. Clock forward jump: a fresh fail can expire early -> one extra re-probe.
   Availability direction, harmless. Clock backward jump: `now - written`
   underflows (both uint64_t; unsigned wrap is well-defined) -> huge -> expired ->
   re-probe. Fails open, exactly as claimed. A corrupt far-future `written` value
   behaves the same way (underflow at read time), i.e. it cannot wedge the device
   off permanently either.

What it only APPEARS to handle: nothing I found is merely cosmetic here - but two
boundaries deserve stating. First, `time(nullptr)` is wall clock; NTP-style
corrections after a rollback can re-trust a recent fail again (minor, bounded by
the window). Second, the 15-minute stamp is rewritten only when a re-probe
actually fails again, so a device left launched continuously never re-probes
(only new launches do); a long-running foreground session on a
genuinely-failing device stays on CPU until restart - which is fine, since the
device was disabled for that process anyway.

VERDICT C: CONFIRMED - the code does what the claim says on every sub-question
asked (genuine-failure loop: intended and stated; ok never TTL'd; truncation and
clock jumps fail open).

## Claim D - the V73 coupling, honesty included

### D.1 Both edits exist

Engine, committed in `1068eb03d`, `src/llama-governor-policy.cpp:166-173` (verbatim
from the extract):

```cpp
    // V73 carries the owner's 2026-09-21 enablement decision, not a measurement.
    // The generation list is duplicated in the app; the form refactor should carry it once.
    if ((params_.generation == llama_governor_generation::V73 ||
         params_.generation == llama_governor_generation::V75 ||
         params_.generation == llama_governor_generation::V79) &&
        params_.gpu_fit == llama_governor_fit::Fit && params_.gpu_prefill_measured) {
        return llama_governor_engine::GPU;
```

App, uncommitted in `/Users/marco/Projects/kalsa`, `src/engine/governorInputs.ts:134-137`:

```ts
    // V73 carries the owner's 2026-09-21 enablement decision, not a measurement.
    // The generation list is duplicated in the engine; the form refactor should carry it once.
    gpu_prefill_measured:
      generation === "V73" || generation === "V75" || generation === "V79",
```

plus the pre-existing owner line 24 in `GPU_PREFILL_CORRECT`:
`V73: true, // owner decision 2026-09-21: enabled in production, never measured in-app; ...`.
Nothing else in the lane condition changed (thermal/battery gates and `gpu_fit`
unchanged; the `measured: ALIVE #38 ...` comment above it documents the V75
measurement and predates this change).

### D.2 The wire, end to end

Traced in source, not inferred: `buildGovernorParams` (governorInputs.ts:120-144)
-> LlamaService.ts:2316 builds `governorLoad` when the governor feature is on,
thermo `sensor_valid`, `gpu_fit !== "NoFit"`, no mmproj, no streamExperts
(:2326-2338) -> embedded as `governor: governorLoad` in the context params
(:2414) -> parsed natively by `node_modules/llama.rn/cpp/rn-governor-params.cpp:136`
`params.gpu_prefill_measured = bool_or(governor, "gpu_prefill_measured", false)`
-> engine struct `llama_governor_params` (src/llama-ext.h:253) -> consumed at
llama-governor-policy.cpp:171. So the app flag and the engine condition do meet on
the wire, and with only one of the two edits the lane cannot fire (engine-only:
app sends false for V73; app-only: engine excludes V73) - the coupling claim is
correct AT SOURCE LEVEL.

### D.3 Honesty of the comments

Quoted in D.1. Both files carry the same two-line comment saying this is the
owner's 2026-09-21 enablement decision, not a measurement, and naming the
duplicated list as form-refactor debt. The app map comment additionally says
"never measured in-app". No comment, test, or report text claims a V73
measurement. Requirement met.

### D.4 Other enumerations of this lane

Greps over both repos (all hits listed, not a selection):

- Engine `src/`: llama-ext.h:201 (enum definition); policy :168-170 (the edit);
  policy :174 (the V73-only `GPU_COOLMODE` PREFILL lane, pre-existing in the
  base - the diff shows it as unchanged context - and already containing V73, so
  the coder's claim about :174-177 is verified); policy :246 (a V73-only DECODE
  `GPU_COOLMODE` lane gated on `cool_delta_measured`/`kexp_cool_scope` - a
  different lane with its own measured flag, not an enumeration of the
  V73/V75/V79 prefill list, so not a miss). `prefill_rule()` derives from
  `prefill_engine()` and enumerates nothing.
- App `src/`: governorInputs.ts:13-26 (`GPU_PREFILL_CORRECT`, V73: true from the
  owner's uncommitted change), :136-137 (the edit), :61-74 (`generationFor`, the
  SoC -> generation map upstream of both lists, includes the V73 SoCs); the test
  file; no other file mentions V75.
- `/Users/marco/Projects/kalsa/tmp/kalsallama-src/src/llama-governor-policy.cpp:163`
  still has the V75/V79-only condition - a gitignored scratch clone
  (.gitignore:50 `tmp/`), built by nothing, as the coder said.
- The fourth copy is the one that matters: `node_modules/llama.rn/vendor/llama.cpp/
  src/llama-governor-policy.cpp:163-164` STILL HAS THE OLD V75/V79-ONLY
  CONDITION, and that vendored copy is what the app compiles (see B.3). The coder
  reported this as risk 5; it is not a missed grep, but it is the difference
  between "the lane is wired in the sources" and "the lane fires on a device".

### D.5 What a V73 device additionally needs for the lane to fire

Engine side: `valid_schema`, profile present/valid, thermal state not
CRITICAL/Invalid/LOWBAT, battery >= 45, `gpu_fit == Fit`, `gpu_prefill_measured`
(or the `bench_force_gpu_prefill` bypass). App side: governor feature on, a
priced model, thermo `sensor_valid`, app-side `gpu_fit` not NoFit (needs
`kvBytesPerToken` from the model entry and the memory estimate), no mmproj, no
streamExperts, and `GPU_PREFILL_CORRECT.V73` true (owner's line 24). The
COOLMODE lane is not required (the measured lane is checked first and returns
GPU before COOLMODE is considered; no interference). Nothing else gates the
lane - but ALL of it only exists in the app once the llama.rn pin is refreshed
to an engine build containing `1068eb03d`, and the app-side TS edits are
themselves still uncommitted in the app repo.

### D.6 App-side verification I ran

```
npx jest src/engine/governorInputs.test.ts --silent
Test Suites: 1 passed, 1 total / Tests: 10 passed, 10 total
npx tsc --noEmit -> exit 0
```

The test asserts `gpu_prefill_measured: true` for the SM8550 (V73) device (the
false->true flip the coder made) and `enabled: true` for the V73 variants, and
both pass.

VERDICT D: CONFIRMED at source level in both repos (edits, wire, comments,
enumerations, conditions), with the decisive caveat - which the coder himself
states and I verified hard - that the app's shipped engine binary (pinned
llama.rn) still contains the old condition, so on a production build today the
lane does NOT fire for V73. It is fully wired only after the pin moves.

## Claim E - the test

### E.1 What the test is

The verdict round-trip lives in the EXISTING `tests/test-opencl-moe-roundtrip.cpp`
(no new file; grew 430 -> 512 lines), entirely inside `#ifdef GGML_USE_OPENCL`
(:13-95 in the commit): `run_verdict_roundtrip()` builds a `cl_program_cache_state`
by hand in a unique temp dir (no device, no context) and asserts, in order: an ok
verdict round-trips every field including a non-zero `written`; a fresh fail is
read back as suppressing; the same fail with `written = now - TTL - 1` is IGNORED
(load returns false); a fail saved under one key_suffix is invisible under another.
It runs FIRST in `main()` (:455-459), before `find_opencl()`, returning 1 on
failure; the pre-existing "no OpenCL backend -> exit 2" skip semantics are
untouched. `tests/CMakeLists.txt:333-337` adds the backend header dir and
`${OpenCL_INCLUDE_DIR}` to the test target only under `if (GGML_OPENCL)`; with
GGML_OPENCL=OFF the test builds exactly as before (the case compiles out).

### E.2 I built and ran it (my own configure, not the coder's build dir)

Configured `/tmp/v73-audit/build-host` (a copy of the commit; same flag set as the
coder's build-host-ocl: GGML_OPENCL=ON, EMBED_KERNELS=ON, tests on,
GGML_OPENCL_TARGET_VERSION=200, Khronos headers):

```
$ make -C build-host test-opencl-moe-roundtrip -j8   -> Built target
$ ./build-host/bin/test-opencl-moe-roundtrip
ggml_opencl: kernel cache: stale fail verdict ignored, rebuilding kernels
ggml_opencl: selected platform: 'Apple'
ggml_opencl: device: 'Apple M1 Max (OpenCL 1.2 )'
ggml_opencl: unsupported GPU 'Apple M1 Max'.
ggml_opencl: drop unsupported device 'Apple M1 Max'.
no OpenCL backend
VERDICT_ROUNDTRIP=PASS
exit=2
```

Identical to the coder's reported output, including exit=2 being the pre-existing
device gate (OpenCL 1.2 host, ggml-opencl.cpp:6864), not a test failure.

### E.3 The mutation check holds - I re-did it

On the copy only (repo untouched): changed the expiry condition to
`if (false && (verdict.written == 0 || ...))` (cl-program-cache.cpp:528), rebuilt,
ran:

```
verdict: fail older than the TTL was not expired
VERDICT_ROUNDTRIP=FAIL
exit=1
```

Restored the line (verified the file is byte-identical to the commit again),
rebuilt, ran: `VERDICT_ROUNDTRIP=PASS`, exit=2. The PASS is not vacuous - the test
detects exactly the regression it exists for. Minor coverage note, not a flaw: the
load-side `written == 0` expiry branch is never directly asserted (the save path
always stamps a non-zero `written`), so a hand-truncated fail file's behaviour
rests on code reading, not the test.

### E.4 The two host blockers are real, and the workaround does NOT leak

Blocker 1, reproduced: a vanilla macOS configure (no OpenCL_INCLUDE_DIR override)
finds the framework and sets
`OpenCL_INCLUDE_DIR=.../OpenCL.framework` - where the header is `Headers/cl.h`,
not `CL/cl.h` - and the build dies in THREE pre-existing translation units, not
just this change's files:

```
ggml-opencl-kalsa-diag.h:25: fatal error: 'CL/cl.h' file not found
cl-program-cache.h:45:    fatal error: 'CL/cl.h' file not found   (from cl-program-cache.cpp and ggml-opencl.cpp)
```

Blocker 2, reproduced: with Khronos headers but the default
`GGML_OPENCL_TARGET_VERSION=300` (ggml/CMakeLists.txt:269), the lib compiles and
dies at LINK against Apple's 1.2 framework, with exactly the two symbols the
coder named (and `nm` confirms both are absent from the framework):

```
Undefined symbols for architecture arm64:
  "_clCreateBufferWithProperties", referenced from ggml-opencl.cpp (call at :14258, #if TARGET >= 300)
  "_clGetKernelSubGroupInfo",     referenced from load_cl_kernels (call at :3723, #if CL_TARGET >= 210)
```

With TARGET=200 (my build-host) both calls compile out and everything links. Both
blockers are pre-existing portability limits of the backend, not of this change.

Leak check into the shipped Android build - four places, all clean:

- Tracked files at the commit: `git grep kalsa-opencl-deps|TARGET_VERSION=200` at
  `1068eb03d` -> nothing. The only TARGET_VERSION in-tree is the cache default
  "300" (ggml/CMakeLists.txt:269), untouched by the commit.
- `CMakeUserPresets.json` (untracked, predates this work): the android preset sets
  no TARGET_VERSION (inherits 300) and takes OpenCL from `$OPENCL_SDK_ROOT`; no
  200, no host paths.
- `build-android-ocl/CMakeCache.txt`: `GGML_OPENCL_TARGET_VERSION:STRING=300`,
  EMBED=ON, headers = the android prefix. The host workaround exists only in
  `build-host-ocl/CMakeCache.txt` (TARGET=200 + Khronos include) and my /tmp
  copies.
- The app's own build (llama.rn android CMakeLists:203-209) hardcodes
  `-DGGML_OPENCL_TARGET_VERSION=300`.

No leak. Not a finding.

VERDICT E: CONFIRMED - real test in the existing file, PASS reproduced in an
independent build, mutation flips it to FAIL and back, both host blockers
reproduced, workaround confined to the host test configure.

## Claim F - regression surface

Deltas of THIS commit over the previously audited revision (the previous audit
confirmed E for that revision; the commit = that revision plus the close-out
work), item by item:

- Per-call costs added by the NEW edits only: one flag/null compare in the
  ARGSORT case of supports_op (plan-time, only for argsort ops); one extra bool
  compare at load_cl_kernels_argsort entry plus one after its build; one constant
  string append in compute_key_suffix (once per process); one time(nullptr) plus
  one compare in load_verdict (once per process, and only when a fail verdict
  exists); ~10 extra bytes written per verdict file; one extra enum compare in
  prefill_engine. Nothing per-token, nothing per-graph beyond what the previous
  revision already added (the supports_op flag check, the 187 build guards, the
  verdict read at init and OK write at end of load - all previously audited).
- Consumed return values: none. Changed signatures: none. Error propagation: one
  new control-flow outcome (load_verdict returns false on a stale fail), which
  fails OPEN toward re-probing; alloc_buffer/ggml_cl_init behavior is identical to
  the previously audited revision.
- Behaviour deltas that are real but stated (not regressions): every cache key
  changes once because `kset=` appears in the suffix (one recompile per device
  after update; old verdict files are orphaned under new names - coder's risk 2);
  a fail verdict now expires and re-probes (the intended fix); the verdict file
  gained the `written=` line (an old-format fail would parse written=0 and be
  treated as stale - one re-probe, harmless, and no such files are shipped).
- Happy path (all kernels compile): same kernel set, same order, same CL_CHECKs,
  same program-cache try_load/try_save flow, same logs; the only new runtime
  artefact is the `written=` line in the verdict file and the kset substring in
  key names. Configure-time cost: 185 file(SHA256) calls - negligible.
- tests/CMakeLists.txt: include dirs added only under `if (GGML_OPENCL)`; the
  shared non-OpenCL host `build/` builds the test exactly as before (verified by
  the successful builds below).

Governor test run (shared host `build/`, working tree == commit for the policy
file, object verified newer than source: 15:29:10 -> 15:29:39):

```
$ ctest --test-dir build -R governor
1/9  test-download-model .............. Passed
2/9  test-governor-v0 ................. Passed
3/9  test-governor-v0-shared-cells .... Passed
4/9  test-governor-v0-mtp-hybrid ...... Skipped
5/9  test-governor-v0-commit .......... Passed
6/9  test-governor-v0-turns ........... Passed
7/9  test-governor-v0-devices ......... Skipped
8/9  test-governor-v0-hybrid .......... Skipped
9/9  test-governor-v02-router ......... Passed
100% tests passed out of 9
```

Identical counts to the coder's run and to the previous audit's baseline (8
governor targets: 5 pass / 3 skip, plus the download-model fixture). Note
test-governor-v0-devices - the one test that sets V73 - is among the skipped, so
the new engine branch still has no directly RUNNING unit test, exactly as the
coder stated (gap, not regression).

VERDICT F: CONFIRMED - happy path materially unchanged; costs are per-process or
plan-time single compares; no consumed returns; governor counts identical to
baseline.

## Per-claim verdict list

- A (argsort hole closed, and completely): CONFIRMED. Guard at :9836-9839; my own
  scan of the commit: 187/187 build sites guarded, 0 kernel-before-guard; all
  lazy FA/prepass/optional-variant paths null- and err-guarded, optional maps
  count()-guarded, `.at()` only on supports_op-probed base variants; no second
  hole found on app-reachable paths.
- B (kernel-set identity): PARTIAL - the refutation the task asked for is real.
  Coverage (185=185=185, argsort and FA included), fold-in point (both key
  families, one-time invalidation), and the mutation round-trip are CONFIRMED and
  independently reproduced (same baseline hash). But the app's Android build never
  evaluates the id: it globs kernels/*.cl itself and never defines
  GGML_OPENCL_KERNEL_SET_ID, so the suffix carries the constant `kset=unknown`
  and the verdict is NOT keyed on the kernel set in the shipped product. Gap D2
  is closed only in the engine repo's own builds.
- C (fail TTL): CONFIRMED on every sub-question: genuine-failure device re-probes
  once per launch >15 min after the last fail, forever, no backoff (intended and
  stated); OK verdicts are not TTL'd (correct); truncation/short/foreign files
  fail open to re-probe; clock rollback fails open via unsigned underflow.
- D (V73 coupling): CONFIRMED at source level - both edits, the full wire
  (governorInputs -> LlamaService governorLoad -> rn-governor-params.cpp:136 ->
  llama-ext.h:253 -> policy:171), honest comments verbatim as claimed, all other
  enumerations accounted for (COOLMODE lane :174 pre-existing with V73; :246 is
  a different lane; tmp clone stale; the llama.rn vendor copy is the one that
  matters and still has the old condition). On a production build today the lane
  does NOT fire; it needs the pin refresh (and the app-side edits are themselves
  uncommitted).
- E (the test): CONFIRMED - PASS reproduced independently, mutation flips FAIL and
  back, both host blockers reproduced exactly, no leak of the workarounds into any
  Android build (tracked files, presets, both engine caches, and llama.rn's own
  CMakeLists all clean; app build hardcodes 300).
- F (regression surface): CONFIRMED - per-process/plan-time costs only, no
  consumed returns, no propagation changes beyond the fail-open stale verdict,
  governor ctest identical to baseline (9 run, 5 pass, 3 skip, 100%).

## What I could not verify and why

- Everything on hardware: no device, no adb (audit rules). The argsort guard
  executing, the verdict TTL expiring on a phone, the CPU reroute, and the V73
  lane firing are all source- and host-test-level conclusions.
- The kset define materializing in the ANDROID engine build: build-android-ocl was
  left stale by the coder (contention rule) and I did not reconfigure it either;
  my proof of the CMake mechanism is a host configure of the same CMakeLists. The
  Android toolchain running the same code is highly likely but not executed.
- Whether the Android app enables the OpenCL cache directory at runtime (verdict
  persistence is a no-op without it) - unchanged open point from the previous two
  reports.
- Whether any production model graph contains GGML_OP_ARGSORT (affects how
  reachable the (now closed) argsort hole ever was).
- The full 94-suite/1213-test Jest run: I ran the governorInputs suite (10/10)
  and tsc (clean), not the whole app suite.
- The state of the upstream kalsa.rn repository beyond the installed
  node_modules copy (no network fetches were made).

## Bottom line

The previous audit's three residuals are dealt with as follows: the argsort
SIGABRT hole is genuinely and completely closed (I looked for a second hole of
the same class and did not find one), and the never-retry property is genuinely
fixed by the 15-minute fail TTL with correct fail-open behaviour on truncation
and clock jumps. The kernel-set keying, however, is only half-delivered: the
mechanism is real and I reproduced the mutation round-trip, but it is inert in
the only build that ships - the app's Android build compiles the OpenCL backend
from the pinned llama.rn vendor copy with its own kernel glob and never defines
GGML_OPENCL_KERNEL_SET_ID, so every app build hashes `kset=unknown` and a stale
fail verdict still survives kernel fixes in the product until llama.rn's Android
CMakeLists is taught to compute the id. The V73 lane is the same story one level
up: both source edits are present, coupled, honest ("owner's 2026-09-21
enablement decision, not a measurement" - verbatim in both files), and complete
against every other enumeration, but on an actual V73 device today the lane
cannot fire, because the engine the app ships still contains the old
V75/V79-only condition and the app-side TypeScript edits are uncommitted. In
short: the engineering is sound and honestly reported, the process-survival goal
of the slice is achieved, but both headline features of this commit are, in the
product sense, half-wired - each is one release step away (refresh the llama.rn
pin for V73; additionally compute the kernel-set id in llama.rn's Android build
for the verdict keying) from being live where it matters.

## End of report. The review was NOT interrupted; all claims A through F were
## checked and every verdict above is final.
